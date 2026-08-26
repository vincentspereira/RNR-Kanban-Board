/**
 * In-memory board state engine ("the ground truth mirror").
 *
 * State sources, in order of authority:
 *   1. Lifecycle hook events   (push, immediate, authoritative transitions)
 *   2. `claude agents --json`  (pull, periodic, active/completed sessions)
 *   3. Transcript JSONL scans  (pull, startup rehydration + fallback discovery)
 *
 * Kanban mapping (per spec):
 *   todo        — discovered but idle / never-started sessions
 *   in_progress — activity seen within the activity window
 *   review      — agent needs input / permission (Amber Alert)
 *   done        — SessionEnd observed or CLI reports completed
 */
import { EventEmitter } from 'node:events';
import { CONFIG } from './config.js';
import { discoverTranscriptSessions } from './transcript-parser.js';

export const STATUSES = ['todo', 'in_progress', 'review', 'done'];

export class BoardStore extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} sessionId -> card */
    this.cards = new Map();
    this._emitTimer = null;
  }

  all() {
    return [...this.cards.values()].sort(
      (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
    );
  }

  get(id) {
    return this.cards.get(id);
  }

  _touch(card, patch = {}) {
    Object.assign(card, patch, { lastActivityAt: Date.now() });
    this._scheduleEmit();
  }

  upsert(record) {
    const existing = this.cards.get(record.id);
    if (existing) {
      // Hooks/CLI own status; passive sources must not downgrade it.
      const patch = { ...record };
      delete patch.status;
      this._touch(existing, patch);
      return existing;
    }
    const card = {
      ...record,
      status: record.status ?? 'todo',
      needsInputReason: record.needsInputReason ?? null,
      createdAt: Date.now(),
      lastActivityAt: record.fileModifiedAt ?? Date.now(),
    };
    this.cards.set(card.id, card);
    this._scheduleEmit();
    return card;
  }

  setStatus(id, status, reason = null) {
    if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
    const card = this.cards.get(id);
    if (!card) return null;
    this._touch(card, { status, needsInputReason: status === 'review' ? reason : null });
    return card;
  }

  removeStale(maxAgeMs) {
    const now = Date.now();
    let removed = false;
    for (const [id, card] of this.cards) {
      if (
        card.status === 'done' &&
        now - (card.lastActivityAt ?? 0) > maxAgeMs &&
        !card.pinned
      ) {
        this.cards.delete(id);
        removed = true;
      }
    }
    if (removed) this._scheduleEmit();
  }

  /**
   * Stall heartbeat (C1): flag In-Progress cards whose transcript has been
   * silent for longer than the threshold. This catches agents stuck waiting
   * even when no hook fired — the "Forgotten Agent Syndrome" tripwire.
   */
  flagStalled(thresholdMs) {
    const now = Date.now();
    let changed = false;
    for (const card of this.cards.values()) {
      const lastSeen = card.fileModifiedAt ?? card.lastActivityAt;
      const shouldStall =
        card.status === 'in_progress' &&
        typeof lastSeen === 'number' &&
        now - lastSeen > thresholdMs;
      if (card.stalled !== shouldStall) {
        card.stalled = shouldStall;
        changed = true;
      }
    }
    if (changed) this._scheduleEmit();
  }

  _scheduleEmit() {
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this.emit('change', this.all());
    }, 250);
    this._emitTimer.unref?.();
  }

  /** Apply a validated lifecycle-hook payload. */
  applyHookEvent(payload) {
    const { event, sessionId, projectId, message, timestamp } = payload;
    const ts = Number.isFinite(timestamp) ? timestamp : Date.now();

    const ensureCard = () => {
      const id = sessionId || `hook-${ts}`;
      return (
        this.cards.get(id) ??
        this.upsert({
          id,
          title: message?.slice(0, 120) || `Session ${id.slice(0, 8)}`,
          project: projectId || 'unknown',
          source: 'hook',
          fileModifiedAt: ts,
        })
      );
    };

    switch (event) {
      case 'session_start': {
        const card = ensureCard();
        this._touch(card, { fileModifiedAt: ts });
        this.setStatus(card.id, 'in_progress');
        break;
      }
      case 'tool_activity': {
        if (!sessionId) break;
        const card = ensureCard();
        this._touch(card, {
          toolUseCount: (card.toolUseCount ?? 0) + 1,
          // Tool activity proves liveness; clear stale amber state.
          status: card.status === 'review' ? 'in_progress' : card.status,
          needsInputReason: null,
          fileModifiedAt: ts,
        });
        break;
      }
      case 'needs_input': {
        if (!sessionId) break;
        const card = ensureCard();
        this._touch(card, {
          status: 'review',
          needsInputReason: message || 'Agent requires input',
          fileModifiedAt: ts,
        });
        break;
      }
      case 'session_end': {
        if (!sessionId) break;
        const card = ensureCard();
        this._touch(card, { fileModifiedAt: ts });
        this.setStatus(card.id, 'done', message || 'Session ended');
        break;
      }
      default:
        throw new Error(`Unsupported hook event: ${event}`);
    }
  }

  /**
   * Reconcile with `claude agents --json --all` output.
   * Tolerates any shape: unknown output never corrupts board state.
   */
  syncFromCli(sessions) {
    if (!Array.isArray(sessions)) return;
    for (const s of sessions) {
      const id =
        typeof s?.session_id === 'string'
          ? s.session_id
          : typeof s?.id === 'string'
            ? s.id
            : null;
      if (!id) continue;
      const statusRaw = String(s?.status ?? '').toLowerCase();
      const mapped =
        statusRaw.includes('complete') || statusRaw.includes('done')
          ? 'done'
          : statusRaw.includes('idle')
            ? 'todo'
            : statusRaw.includes('wait') || statusRaw.includes('input')
              ? 'review'
              : 'in_progress';

      const existing = this.cards.get(id);
      // Capture authority signal BEFORE upsert mutates the card's source.
      const wasHookSourced = existing?.source === 'hook';
      this.upsert({
        id,
        title:
          (typeof s?.title === 'string' && s.title) ||
          (typeof s?.task === 'string' && s.task) ||
          existing?.title ||
          `Session ${id.slice(0, 8)}`,
        project:
          (typeof s?.cwd === 'string' && s.cwd) ||
          (typeof s?.project === 'string' && s.project) ||
          existing?.project ||
          'unknown',
        source: 'cli',
        fileModifiedAt: existing?.fileModifiedAt ?? Date.now(),
      });
      // Only move forward to non-review states from CLI evidence when we have
      // no fresher hook-driven signal.
      if (!wasHookSourced || mapped === 'done') {
        this.setStatus(id, mapped);
      }
    }
  }

  /**
   * Rehydrate/discover sessions by scanning transcripts.
   * Status inference: recent file mtime -> in_progress, else todo.
   */
  syncFromTranscripts() {
    const found = discoverTranscriptSessions();
    for (const rec of found) {
      const isActive = Date.now() - rec.fileModifiedAt < CONFIG.activityWindowMs;
      const existing = this.cards.get(rec.id);
      this.upsert({ ...rec, status: existing?.status });
      const card = this.cards.get(rec.id);
      if (!existing) {
        card.status = isActive ? 'in_progress' : 'todo';
        this._scheduleEmit();
      } else if (
        (card.status === 'todo' || card.status === 'in_progress') &&
        isActive !== (card.status === 'in_progress')
      ) {
        // Passive inference only toggles between todo <-> in_progress and
        // never overrides review/done set by hooks or the user.
        card.status = isActive ? 'in_progress' : 'todo';
        this._scheduleEmit();
      }
    }
    return found.length;
  }
}

export const board = new BoardStore();

/** Validate + normalize an inbound webhook body. Throws on invalid input. */
export function normalizeHookPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Body must be a JSON object');
  }
  const event = typeof body.event === 'string' ? body.event.trim() : '';
  const allowedEvents = ['session_start', 'tool_activity', 'needs_input', 'session_end'];
  if (!allowedEvents.includes(event)) {
    throw new Error(`event must be one of: ${allowedEvents.join(', ')}`);
  }
  const str = (v, max = 300) =>
    typeof v === 'string' ? v.slice(0, max) : undefined;

  return {
    event,
    sessionId: str(body.session_id ?? body.sessionId, 128),
    projectId: str(body.project_id ?? body.projectId, 256),
    message: str(body.message),
    timestamp: Number.isFinite(body.timestamp) ? body.timestamp : undefined,
  };
}

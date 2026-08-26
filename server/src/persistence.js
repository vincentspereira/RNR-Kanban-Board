/**
 * Board-state persistence (A2).
 *
 * The transcripts remain the ground truth for session discovery, but manual
 * status overrides and hook-only sessions (which have no transcript) must
 * survive server restarts. We snapshot a slim projection of the board to a
 * JSON file (debounced, atomic-enough for single-writer local use) and merge
 * it back in at startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';

const STATE_FILE = path.join(PROJECT_ROOT, '.orchestrator-state.json');
let saveTimer = null;

/** Load previously persisted card projections. Returns [] on any problem. */
export function loadPersistedCards() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return Array.isArray(parsed?.cards) ? parsed.cards : [];
  } catch {
    return []; // first run or corrupted file — start fresh either way
  }
}

/** Restore persisted cards into the store without clobbering live data. */
export function restoreInto(board) {
  let restored = 0;
  for (const card of loadPersistedCards()) {
    if (!card || typeof card.id !== 'string') continue;
    if (board.cards.has(card.id)) continue; // live data wins
    board.upsert({
      id: card.id,
      title: typeof card.title === 'string' ? card.title : `Session ${card.id.slice(0, 8)}`,
      project: typeof card.project === 'string' ? card.project : 'unknown',
      source: typeof card.source === 'string' ? card.source : 'restored',
      status: card.status,
      needsInputReason: card.needsInputReason ?? null,
      toolUseCount: Number(card.toolUseCount) || 0,
      startedAt: card.startedAt,
      lastActivityAt: card.lastActivityAt,
      fileModifiedAt: card.fileModifiedAt,
    });
    restored += 1;
  }
  return restored;
}

/** Debounced save of a slim, secrets-free projection of the board. */
export function schedulePersist(cards) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const slim = cards.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      needsInputReason: c.needsInputReason ?? null,
      project: c.project,
      source: c.source,
      toolUseCount: c.toolUseCount ?? 0,
      startedAt: c.startedAt,
      lastActivityAt: c.lastActivityAt,
      fileModifiedAt: c.fileModifiedAt,
    }));
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ savedAt: Date.now(), cards: slim }));
    } catch (err) {
      console.error('[persist] save failed:', err.message);
    }
  }, 500);
  saveTimer.unref?.();
}

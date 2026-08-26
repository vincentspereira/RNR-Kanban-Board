/**
 * Terminal bridge: spawns interactive sessions attached to Kanban cards and
 * streams output to the browser with strict 16ms batching (60fps alignment).
 *
 * Security notes:
 *  - Process creation uses argv ARRAYS only (never `shell: true`), so no
 *    card title / session id can be interpreted as shell syntax.
 *  - Session ids are validated against a UUID pattern before being passed
 *    anywhere near a process argument.
 *  - node-pty is optional: if native compilation is unavailable we fall back
 *    to piped child_process (no raw-mode colors but still functional).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { CONFIG } from './config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertValidSessionId(id) {
  if (!UUID_RE.test(id)) throw new Error('Invalid session id');
  return id;
}

/** Lazily probe for a working node-pty install. */
async function loadPty() {
  try {
    const mod = await import('node-pty');
    return mod.default ?? mod;
  } catch (err) {
    console.warn(
      `[pty] node-pty unavailable (${err.code || err.message}). ` +
        'Falling back to piped child processes (non-raw terminal mode).',
    );
    return null;
  }
}

class PtyManager {
  constructor() {
    /** @type {Map<string, object>} sessionId -> session handle */
    this.sessions = new Map();
    this.ptyLib = null;
    this._probed = false;
    this.tickets = new Map();
  }

  async ensureProbed() {
    if (!this._probed) {
      this.ptyLib = await loadPty();
      this._probed = true;
    }
    return this.ptyLib;
  }

  get mode() {
    return this.ptyLib ? 'node-pty' : 'pipe';
  }

  has(sessionId) {
    return this.sessions.has(sessionId);
  }

  /**
   * Spawn (or return the existing) interactive session for a card.
   * command: executable name (e.g. 'claude'); args: fixed argv array.
   */
  async create(sessionId, { command = 'claude', args = [], cwd, cols = 100, rows = 30 }) {
    assertValidSessionId(sessionId);
    const existing = this.sessions.get(sessionId);
    if (existing && existing.alive) return existing;

    await this.ensureProbed();
    if (!command || /[^\w.\-]/.test(command)) {
      throw new Error('Invalid command');
    }

    const handle = {
      id: sessionId,
      alive: true,
      pending: [],
      flushTimer: null,
      onData: null, // set by websocket bridge
      history: '', // bounded scrollback replayed to new subscribers (C2)
      proc: null,
      pty: null,
      kill: null,
      write: null,
      resize: null,
    };

    const safeCwd = cwd && typeof cwd === 'string' ? cwd : undefined;

    if (this.ptyLib) {
      const pty = this.ptyLib.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: safeCwd,
        env: { ...process.env },
      });
      handle.pty = pty;
      handle.write = (data) => pty.write(String(data));
      handle.resize = ({ cols: c, rows: r }) => {
        const cc = Math.min(Math.max(Number(c) || 80, 2), 500);
        const rr = Math.min(Math.max(Number(r) || 24, 2), 300);
        try {
          pty.resize(cc, rr);
        } catch {
          /* window already gone */
        }
      };
      pty.onData((data) => this._enqueue(handle, data));
      pty.onExit(({ exitCode }) => {
        handle.alive = false;
        this._flush(handle);
        this.sessions.delete(sessionId);
        handle.onData?.(`\r\n\x1b[2m[session exited with code ${exitCode}]\x1b[0m\r\n`);
      });
      handle.kill = () => {
        try {
          pty.kill();
        } catch {
          /* ignore */
        }
      };
    } else {
      const child = spawn(command, args, {
        cwd: safeCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      handle.proc = child;
      handle.write = (data) => child.stdin.write(String(data));
      handle.resize = null; // no TTY to resize in pipe mode
      const pipeOut = (chunk) => this._enqueue(handle, chunk.toString('utf8'));
      child.stdout.on('data', pipeOut);
      child.stderr.on('data', pipeOut);
      child.on('error', (err) =>
        this._enqueue(handle, `\r\n[spawn error] ${err.message}\r\n`),
      );
      child.on('exit', (code) => {
        handle.alive = false;
        this._flush(handle);
        this.sessions.delete(sessionId);
        handle.onData?.(`\r\n\x1b[2m[session exited with code ${code}]\x1b[0m\r\n`);
      });
      handle.kill = () => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      };
    }

    this.sessions.set(sessionId, handle);
    return handle;
  }

  /** Buffer output chunks; flush at most once per flushIntervalMs (16ms). */
  _enqueue(handle, data) {
    if (!handle.alive) return;
    // Hard cap buffered output to prevent memory exhaustion from runaway agents.
    if (handle.pending.length > 512 * 1024) {
      handle.pending.splice(0, handle.pending.length - 256 * 1024);
    }
    handle.pending.push(data);
    if (!handle.flushTimer) {
      handle.flushTimer = setTimeout(() => {
        handle.flushTimer = null;
        this._flush(handle);
      }, CONFIG.flushIntervalMs);
      handle.flushTimer.unref?.();
    }
  }

  _flush(handle) {
    if (handle.flushTimer) {
      clearTimeout(handle.flushTimer);
      handle.flushTimer = null;
    }
    if (handle.pending.length === 0) return;
    const blob = handle.pending.join('');
    handle.pending = [];
    // Append to scrollback history with a hard cap (C2).
    handle.history =
      (handle.history + blob).slice(-CONFIG.terminalHistoryBytes);
    handle.onData?.(blob);
  }

  attach(sessionId, onData) {
    const handle = this.sessions.get(sessionId);
    if (!handle) return null;
    handle.onData = onData;
    return handle;
  }

  detach(sessionId) {
    const handle = this.sessions.get(sessionId);
    if (handle) handle.onData = null;
  }

  stop(sessionId) {
    const handle = this.sessions.get(sessionId);
    if (!handle) return false;
    handle.kill();
    return true;
  }

  stopAll() {
    for (const id of [...this.sessions.keys()]) this.stop(id);
  }

  /**
   * One-time, short-lived ticket for opening a terminal websocket. Prevents
   * a leaked ws URL from being replayed indefinitely.
   */
  mintTicket(ttlMs = 60_000) {
    const ticket = crypto.randomBytes(16).toString('hex');
    // Opportunistic cleanup of expired tickets.
    const now = Date.now();
    for (const [t, exp] of this.tickets) {
      if (exp < now) this.tickets.delete(t);
    }
    this.tickets.set(ticket, now + ttlMs);
    return ticket;
  }

  consumeTicket(ticket) {
    if (typeof ticket !== 'string' || !ticket) return false;
    const expiry = this.tickets.get(ticket);
    if (!expiry) return false;
    this.tickets.delete(ticket); // single-use
    return Date.now() <= expiry;
  }
}

export const ptyManager = new PtyManager();

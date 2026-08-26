/**
 * Central configuration for the orchestrator server.
 *
 * Security posture: this is a single-user LOCAL development tool.
 *  - The HTTP listener binds to loopback only (127.0.0.1) unless explicitly overridden.
 *  - A per-install shared secret token protects mutating endpoints (webhooks,
 *    terminal sockets) against CSRF-style abuse from other local processes or
 *    drive-by browser requests (see docs in README).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

export const CONFIG = {
  port: num(process.env.ORCH_PORT, 8080),
  // Loopback bind by default. Never expose this server off-machine.
  host: process.env.ORCH_HOST || '127.0.0.1',

  // Where Claude Code stores its append-only JSONL session transcripts.
  claudeDir: process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude'),

  // How often we reconcile board state with `claude agents --json --all`.
  pollIntervalMs: num(process.env.ORCH_POLL_MS, 10_000),

  // Transcript activity window (ms): sessions touched within this window are
  // considered actively "In Progress".
  activityWindowMs: num(process.env.ORCH_ACTIVITY_MS, 2 * 60_000),

  // Stall detection: In-Progress cards with no transcript writes for this
  // long are flagged as stalled ("Forgotten Agent Syndrome" tripwire).
  stallThresholdMs: num(process.env.ORCH_STALL_MS, 10 * 60_000),

  // Bytes read from the START of transcripts when extracting session titles.
  transcriptHeadBytes: num(process.env.ORCH_HEAD_BYTES, 32 * 1024),

  // Max terminal scrollback (bytes) replayed to newly attached clients.
  terminalHistoryBytes: num(process.env.ORCH_TERM_HISTORY, 64 * 1024),

  // Terminal output batching target: 16ms aligns with 60fps rendering.
  flushIntervalMs: num(process.env.ORCH_FLUSH_MS, 16),

  // Max bytes of a JSONL transcript tail we inspect when summarizing a session.
  transcriptTailBytes: num(process.env.ORCH_TAIL_BYTES, 256 * 1024),

  // Max request body size for webhook payloads.
  bodyLimit: '64kb',

  // Allowed origins for browser clients (the Vite dev server + built app).
  allowedOrigins: (process.env.ORCH_ALLOWED_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

/**
 * Shared secret token.
 * Precedence: ORCH_TOKEN env var -> previously generated token file -> generate new.
 * The token file is chmod 600 and gitignored; it is only ever served back to
 * loopback clients whose Host header matches the server (anti DNS-rebinding),
 * so the frontend can attach it to webhook/terminal calls.
 */
function loadOrCreateToken() {
  if (process.env.ORCH_TOKEN) return process.env.ORCH_TOKEN;
  const tokenFile = path.join(PROJECT_ROOT, '.orchestrator-token');
  try {
    const existing = fs.readFileSync(tokenFile, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* fall through to generation */
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  return token;
}

export const TOKEN = loadOrCreateToken();

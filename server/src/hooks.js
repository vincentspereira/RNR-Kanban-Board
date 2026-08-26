/**
 * Webhook receiver for Claude Code lifecycle hook events.
 *
 * Route: POST /hooks/notification
 * Auth:   shared secret (Bearer token or x-orchestrator-token header)
 * Body:   { event, session_id?, project_id?, message?, timestamp? }
 *
 * The body is strictly validated/whitelisted before it can influence board
 * state; unknown fields are dropped and sizes are capped by express.json().
 */
import { Router } from 'express';
import { requireToken } from './security.js';
import { board, normalizeHookPayload } from './state-store.js';

export const hooksRouter = Router();

hooksRouter.post('/hooks/notification', requireToken, (req, res) => {
  let payload;
  try {
    payload = normalizeHookPayload(req.body);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
    return;
  }

  try {
    board.applyHookEvent(payload);
  } catch (err) {
    console.error('[hooks] failed to apply event:', err.message);
    res.status(422).json({ error: 'Event rejected' });
    return;
  }

  res.status(202).json({ ok: true });
});

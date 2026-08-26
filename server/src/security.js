/**
 * HTTP hardening middleware for a loopback-bound, single-user dev tool.
 *
 * 1. Host pinning: rejects requests whose Host header is not a loopback form
 *    of the server address. This neutralizes DNS-rebinding attacks where a
 *    malicious website resolves a public hostname to 127.0.0.1 and then reads
 *    same-"origin" responses from our API (browsers enforce origin by host
 *    name, so pinning the expected host breaks the rebinding).
 * 2. Origin checking: for state-changing requests coming from a browser
 *    (presence of an Origin header), the origin must be explicitly allowlisted.
 * 3. Token auth: constant-time comparison of a bearer/shared secret for
 *    webhooks and terminal websockets.
 */
import crypto from 'node:crypto';
import { CONFIG, TOKEN } from './config.js';

const ALLOWED_HOSTS = new Set([
  `${CONFIG.host}:${CONFIG.port}`,
  `localhost:${CONFIG.port}`,
  `127.0.0.1:${CONFIG.port}`,
  `[::1]:${CONFIG.port}`,
]);

export function hostPin(req, res, next) {
  const host = req.headers.host || '';
  if (!ALLOWED_HOSTS.has(host.toLowerCase())) {
    res.status(403).json({ error: 'Forbidden host' });
    return;
  }

  const origin = req.headers.origin;
  if (
    origin &&
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    req.method !== 'OPTIONS' &&
    !CONFIG.allowedOrigins.includes(origin)
  ) {
    res.status(403).json({ error: 'Forbidden origin' });
    return;
  }

  next();
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Still burn comparable time to avoid trivial length oracles.
    crypto.timingSafeEqual(bb, bb);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-orchestrator-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  // Websockets cannot set custom headers easily; allow query param there.
  if (typeof req.query?.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

/** Express middleware enforcing the shared secret. */
export function requireToken(req, res, next) {
  const provided = extractToken(req);
  if (!provided || !safeEqual(provided, TOKEN)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/** Non-express helper used during the websocket upgrade handshake. */
export function isValidToken(token, expected) {
  return typeof token === 'string' && safeEqual(token, expected);
}

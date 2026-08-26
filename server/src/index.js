/**
 * RNR Kanban Orchestrator — backend entrypoint.
 *
 * Topology:
 *   - Express HTTP server (loopback-only) serving REST + SSE + built frontend.
 *   - WebSocket endpoint /terminals/<sessionId> bridging xterm.js <-> node-pty
 *     with 16ms server-side output batching.
 *   - Webhook receiver POST /hooks/notification for Claude Code lifecycle hooks.
 *   - Periodic reconciliation: `claude agents --json --all` + transcript scan.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';

import { CONFIG, TOKEN, PROJECT_ROOT } from './config.js';
import { hostPin } from './security.js';
import { board } from './state-store.js';
import { hooksRouter } from './hooks.js';
import { fetchAgentSessions } from './agents-cli.js';
import { ptyManager, assertValidSessionId } from './pty-manager.js';

const app = express();

// --- Global hardening & parsing -------------------------------------------
app.disable('x-powered-by');
app.set('trust proxy', false); // we are loopback; never trust forwarded headers
app.use(hostPin);
app.use(express.json({ limit: CONFIG.bodyLimit }));

// Minimal security headers for the served UI.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// --- REST API ---------------------------------------------------------------
const api = express.Router();

api.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ptyMode: ptyManager.mode });
});

/**
 * Client bootstrap info. The shared token is only ever handed to loopback
 * clients whose Host header passed hostPin — this is what lets the local UI
 * authenticate webhooks/terminals without manual copy-paste.
 */
api.get('/config', (req, res) => {
  res.json({
    token: TOKEN,
    ptyMode: ptyManager.mode,
    pollIntervalMs: CONFIG.pollIntervalMs,
    flushIntervalMs: CONFIG.flushIntervalMs,
  });
});

api.get('/sessions', (req, res) => {
  res.json({ sessions: board.all() });
});

/** Manual status override (drag & drop on the board). */
api.post('/sessions/:id/status', async (req, res) => {
  const { id } = req.params;
  if (!board.get(id)) {
    res.status(404).json({ error: 'Unknown session' });
    return;
  }
  try {
    const card = board.setStatus(id, String(req.body?.status || ''), req.body?.reason ?? null);
    res.json({ ok: true, card });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * Open an interactive terminal for a session.
 * Returns a one-time ticket used to authenticate the websocket connection.
 */
api.post('/sessions/:id/open-terminal', async (req, res) => {
  try {
    const id = assertValidSessionId(req.params.id);
    const card = board.get(id);
    if (!card) {
      res.status(404).json({ error: 'Unknown session' });
      return;
    }

    // Attach to the existing background session inside a fresh PTY.
    // argv array only — the session id can never break out of argument space.
    await ptyManager.create(id, {
      command: 'claude',
      args: ['--resume', id],
      cwd: typeof card.cwd === 'string' ? card.cwd : undefined,
      cols: Number(req.body?.cols) || 100,
      rows: Number(req.body?.rows) || 30,
    });

    const ticket = ptyManager.mintTicket();
    res.json({ ok: true, ticket });
  } catch (err) {
    console.error('[open-terminal]', err.message);
    res.status(400).json({ error: String(err.message || err) });
  }
});

api.post('/sessions/:id/stop', (req, res) => {
  try {
    const id = assertValidSessionId(req.params.id);
    const stopped = ptyManager.stop(id);
    board.setStatus(id, 'done', 'Stopped by user');
    res.json({ ok: true, stopped });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

api.post('/refresh', async (req, res) => {
  const cli = await fetchAgentSessions();
  if (cli) board.syncFromCli(cli);
  const count = board.syncFromTranscripts();
  res.json({ ok: true, cliSessions: cli ? cli.length : null, transcripts: count });
});

app.use('/api', api);
app.use(hooksRouter);

// --- Server-Sent Events: live board state -----------------------------------
const sseClients = new Set();

board.on('change', (sessions) => {
  const frame = `event: board\ndata: ${JSON.stringify({ sessions })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* cleaned up below */
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// --- Static frontend (production mode) --------------------------------------
const clientDist = path.join(PROJECT_ROOT, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('/', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// --- HTTP + WebSocket wiring --------------------------------------------------
const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    // Host pinning for the upgrade handshake too.
    const host = (req.headers.host || '').toLowerCase();
    if (
      ![
        `${CONFIG.host}:${CONFIG.port}`,
        `localhost:${CONFIG.port}`,
        `127.0.0.1:${CONFIG.port}`,
      ].includes(host)
    ) {
      socket.destroy();
      return;
    }

    const match = url.pathname.match(/^\/terminals\/([0-9a-f-]{36})$/i);
    if (!match) {
      socket.destroy();
      return;
    }

    // The one-time ticket (minted by open-terminal) doubles as the credential.
    if (!ptyManager.consumeTicket(url.searchParams.get('ticket'))) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, match[1]);
    });
  } catch {
    socket.destroy();
  }
});

wss.on('connection', (ws, req, sessionId) => {
  const handle = ptyManager.attach(sessionId, (blob) => {
    if (ws.readyState === ws.OPEN && blob) ws.send(blob);
  });

  if (!handle) {
    ws.close(4004, 'No such terminal session');
    return;
  }

  ws.on('message', (data) => {
    // Control frames are tiny JSON; data frames are raw keystrokes.
    const text = typeof data === 'string' ? data : data.toString('utf8');
    if (text.startsWith('{') && text.includes('"resize"')) {
      try {
        const msg = JSON.parse(text);
        if (msg.resize && handle.resize) handle.resize(msg.resize);
        return;
      } catch {
        /* fall through as keystrokes */
      }
    }
    if (!handle.alive) return;
    try {
      handle.write(text);
    } catch {
      /* stream closed */
    }
  });

  ws.on('close', () => ptyManager.detach(sessionId));
  ws.on('error', () => ptyManager.detach(sessionId));
});

// --- Background reconciliation loop ------------------------------------------
async function reconcile() {
  try {
    const cli = await fetchAgentSessions();
    if (cli) board.syncFromCli(cli);
    board.syncFromTranscripts();
    board.removeStale(24 * 60 * 60 * 1000); // prune done cards after a day
  } catch (err) {
    console.error('[reconcile]', err.message);
  }
}

// --- Startup / shutdown --------------------------------------------------------
server.listen(CONFIG.port, CONFIG.host, () => {
  console.log('┌──────────────────────────────────────────────────────────┐');
  console.log('│  RNR Kanban Orchestrator                                 │');
  console.log('└──────────────────────────────────────────────────────────┘');
  console.log(`  HTTP/SSE:  http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  Webhook:   POST http://127.0.0.1:${CONFIG.port}/hooks/notification`);
  console.log(`  PTY mode:  ${ptyManager.mode === 'node-pty' ? 'node-pty' : 'pipe (fallback)'}`);
  console.log('');
  console.log('  Register this Claude Code hook in ~/.claude/settings.json:');
  console.log(
    JSON.stringify(
      {
        hooks: {
          Notification: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `curl -s -X POST http://127.0.0.1:${CONFIG.port}/hooks/notification -H "Content-Type: application/json" -H "x-orchestrator-token: $ORCH_TOKEN" -d "$(cat)" >/dev/null`,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    )
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n'),
  );
  console.log(`\n  Shared token stored at: ${path.join(PROJECT_ROOT, '.orchestrator-token')}`);

  // Initial state rehydration, then periodic reconciliation.
  reconcile();
  setInterval(reconcile, CONFIG.pollIntervalMs).unref?.();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[${sig}] shutting down…`);
    ptyManager.stopAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref?.();
  });
}

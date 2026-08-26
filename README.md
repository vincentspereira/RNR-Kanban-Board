# RNR Kanban Orchestrator

A local-first Kanban control plane for parallel Claude Code agent sessions,
built to the specification in
[`Technical_Design_Specification_Visual_Kanban_Orchestrator_for_Claude_Code_Agents.md.md`](./Technical_Design_Specification_Visual_Kanban_Orchestrator_for_Claude_Code_Agents.md.md).

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Code hooks ──► POST /hooks/notification ─┐              │
│  JSONL transcripts ──► periodic scan ────────────┤              │
│  claude agents --json ──► periodic poll ─────────┤              │
│                                                  ▼              │
│                                        State engine (server)    │
│                                                  │              │
│                            SSE /api/events ──────┤              │
│                                                  ▼              │
│                     React + shadcn-style Kanban UI (client)     │
│                     xterm.js ◄──ws/16ms batching── node-pty     │
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **Four-column board** (To Do / In Progress / In Review / Done) mirroring real
  agent states — cards are *not* manually managed; they reflect telemetry.
- **Amber Alerts**: agents stuck on permission prompts float to the top of
  "In Review" with a pulsing highlight and a header counter badge.
- **Three telemetry sources**, reconciled automatically:
  1. lifecycle webhooks (`POST /hooks/notification`, token-authenticated)
  2. `claude agents --json --all` polling (tolerated as optional)
  3. JSONL transcript scanning under `~/.claude/projects/` (startup rehydration
     included — the board survives server restarts)
- **Inline terminals**: click ▶ Terminal on any card for an xterm.js session
  attached via `claude --resume <id>` through node-pty, with strict **16 ms
  server-side output batching** (60 fps alignment) and one-time socket tickets.
- **Drag & drop** status overrides (@dnd-kit), optimistic with server
  reconciliation over SSE.

## Running (WSL)

Requires Node ≥ 18 (nvm works fine) inside WSL.

```bash
# 1. Backend
cd server
npm install
npm install-scripts approve node-pty   # allow native build (optional but recommended)
npm rebuild node-pty                   # compile ConPTY/openpty bindings
npm start                              # http://127.0.0.1:8080

# 2. Frontend (dev mode)
cd ../client
npm install
npm install-scripts approve esbuild    # if npm blocks its postinstall
npm run dev                            # http://localhost:5173 (proxies to :8080)
```

Production mode: `cd client && npm run build`, then just run the server — it
serves `client/dist` at `http://127.0.0.1:8080`.

If node-pty cannot compile, the server automatically falls back to piped
child processes (`ptyMode: "pipe"`) — terminals still work, minus raw-mode
ANSI fidelity.

## Wiring up Claude Code hooks

The server prints a ready-made hook config at startup. Add this to
`~/.claude/settings.json` (set your token in the environment or inline):

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ORCH_TOKEN=<token> curl -s -X POST http://127.0.0.1:8080/hooks/notification -H 'Content-Type: application/json' -H \"x-orchestrator-token: $ORCH_TOKEN\" -d '{\"event\":\"needs_input\",\"session_id\":\"$CLAUDE_SESSION_ID\",\"message\":\"Agent requires input\"}' >/dev/null"
          }
        ]
      }
    ]
  }
}
```

Supported events: `session_start`, `tool_activity`, `needs_input`,
`session_end`. Even with **no hooks configured**, the board still works via
transcript scanning alone (activity-based status inference).

## Feature highlights (v0.2)

- **Stall detection** — In-Progress cards silent for >10 min get a ⏸ "Stalled"
  badge (`ORCH_STALL_MS` tunable), catching forgotten agents even without hooks.
- **State persistence** — manual moves & hook-only sessions survive server
  restarts via a debounced snapshot (`.orchestrator-state.json`, gitignored).
- **SSE reconnect resync** — the UI re-fetches a full board snapshot after any
  connection drop, so no state change is ever missed.
- **Desktop notifications + title badge** — OS notification when any agent
  enters In Review; browser tab shows `(n)` amber count.
- **Project tabs & search** — group the board by project directory, filter by
  title/branch/project substring.
- **Honest Stop button** — only appears on cards whose terminal process we
  actually control.
- **Token usage per card** — input+output token magnitude from transcripts.
- **Terminal scrollback** — reopening a terminal replays the last 64 KB of
  output instead of starting blank.
- **Worktree actions on Done cards** — one-click *Merge branch* into the main
  worktree and *Prune worktree* from disk (argv-array `git`, ref-name
  validation, main-worktree protection).
- **Resolve Grid** — one click summons every attention-needing agent into a
  balanced Windows Terminal pane grid (WSL paths auto-translated to UNC).
- **Keyboard accessible** — full keyboard drag & drop (Tab → Space → arrows →
  Space), ARIA roles/labels throughout.
- **Hooks setup modal** — header button shows your exact `settings.json` hook
  config with the real port/token baked in, ready to copy.

## Tests

```bash
cd server && npm test                # 19 unit tests (state engine, security, parser)
bash scripts/run-all-tests.sh        # units + HTTP smoke suite + feature checks
```

## Security model

This is a **single-user localhost tool**. Hardening included:

| Control | Purpose |
|---|---|
| Loopback-only bind (`127.0.0.1`) | Never exposed off-machine |
| Host-header pinning | Neutralizes DNS-rebinding against `localhost` |
| Shared secret token (constant-time compare) | Webhooks + terminal sockets reject unauthenticated callers |
| Origin allowlist on mutating requests | Blocks cross-site request forgery from browsers |
| Strict payload whitelisting + size caps | Malformed/hostile hook bodies can't corrupt state |
| Argv-array process spawning (no shell) | Session IDs/titles can never inject commands |
| UUID validation before PTY spawn | Only real session IDs reach `claude --resume` |
| One-time, 60 s terminal tickets | Leaked ws URLs can't be replayed |
| Output buffer caps (512 KB) | Runaway agents can't exhaust memory |

Override knobs: `ORCH_PORT`, `ORCH_HOST`, `ORCH_TOKEN`, `ORCH_POLL_MS`,
`ORCH_ACTIVITY_MS`, `ORCH_FLUSH_MS`, `CLAUDE_DIR`.

## Tests

```bash
bash server/scripts/smoke-test.sh   # auth, host-pinning, validation, board flow
bash server/scripts/sse-test.sh     # live SSE push verification
```

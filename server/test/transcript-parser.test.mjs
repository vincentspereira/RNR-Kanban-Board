/**
 * Unit tests for transcript parsing (A5) — including A4 head-title recovery
 * and C3 token accounting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeTranscript } from '../src/transcript-parser.js';
import { parseWorktrees } from '../src/worktree.js';

const SID = '12345678-abcd-abcd-abcd-123456789abc';

function makeTempTranscript(lines, { padToBytes = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
  const file = path.join(dir, `${SID}.jsonl`);
  let body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  if (padToBytes > Buffer.byteLength(body)) {
    // Pad with filler assistant entries so the tail window excludes the head.
    const filler = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'filler' }] },
      timestamp: '2026-01-01T00:00:00Z',
    });
    const padLines = Math.ceil((padToBytes - Buffer.byteLength(body)) / (Buffer.byteLength(filler) + 1));
    body =
      lines.map((l) => JSON.stringify(l)).join('\n') +
      '\n' +
      Array(padLines).fill(filler).join('\n') +
      '\n';
  }
  fs.writeFileSync(file, body);
  return file;
}

test('summarizeTranscript extracts title, tools and tokens', () => {
  const file = makeTempTranscript([
    { type: 'user', message: { content: 'Fix the login bug please' }, cwd: '/repo', gitBranch: 'feature/login' },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Edit' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      timestamp: '2026-01-01T00:00:01Z',
    },
  ]);
  const s = summarizeTranscript(file, '-repo');
  assert.ok(s, 'summary should parse');
  assert.equal(s.title, 'Fix the login bug please');
  assert.equal(s.toolUseCount, 1);
  assert.equal(s.totalTokens, 150);
  assert.equal(s.gitBranch, 'feature/login');
  assert.equal(s.cwd, '/repo');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('A4: titles survive when the first message scrolled out of the tail window', () => {
  const CONFIG_TAIL = 256 * 1024;
  const file = makeTempTranscript(
    [
      { type: 'user', message: { content: 'The very important original task title' }, cwd: '/repo' },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        timestamp: '2026-01-01T00:00:02Z',
      },
    ],
    { padToBytes: CONFIG_TAIL + 4096 },
  );

  const s = summarizeTranscript(file, '-repo');
  assert.equal(s.title, 'The very important original task title');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('summarizeTranscript skips corrupt lines without failing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
  const file = path.join(dir, `${SID}.jsonl`);
  const good = JSON.stringify({
    type: 'user',
    message: { content: 'valid title here' },
    cwd: '/x',
  });
  fs.writeFileSync(
    file,
    ['{broken json...', '', good, '{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}'].join('\n'),
  );
  const s = summarizeTranscript(file, '-x');
  assert.equal(s.title, 'valid title here');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('worktree porcelain parsing (B1 support)', () => {
  const sample = [
    'worktree /repo/main',
    'HEAD abcdef1234567890',
    '',
    'worktree /repo/worktrees/agent-1',
    'HEAD fedcba0987654321',
    'detached',
    '',
    'worktree /repo/bare-main',
    'bare',
    '',
  ].join('\n');

  const blocks = parseWorktrees(sample);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].path, '/repo/main');
  assert.equal(blocks[0].head, 'abcdef1234567890');
  assert.equal(blocks[1].detached, true);
  assert.equal(blocks[2].bare, true);

  // Also verify both modules agree on porcelain parsing.
  assert.equal(parseWorktrees(sample).length, 3);
});

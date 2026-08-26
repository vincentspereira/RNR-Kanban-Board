/**
 * Unit tests for the board state engine (A5).
 * Run: node --test test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardStore, normalizeHookPayload } from '../src/state-store.js';

function freshBoard() {
  return new BoardStore();
}

// Silence the debounced emitter timers in assertions by stubbing _scheduleEmit.
function quiet(board) {
  let changes = 0;
  board._scheduleEmit = () => {
    changes += 1;
  };
  board.changeCount = () => changes;
  return board;
}

test('normalizeHookPayload accepts a valid needs_input event', () => {
  const p = normalizeHookPayload({
    event: 'needs_input',
    session_id: 'abc',
    message: 'x'.repeat(5000), // oversized on purpose
    junk: 'dropped',
  });
  assert.equal(p.event, 'needs_input');
  assert.equal(p.sessionId, 'abc');
  assert.equal(p.message.length, 300); // capped
  assert.equal('junk' in p, false);
});

test('normalizeHookPayload rejects bad bodies', () => {
  assert.throws(() => normalizeHookPayload(null));
  assert.throws(() => normalizeHookPayload([1, 2]));
  assert.throws(() => normalizeHookPayload({}));
  assert.throws(() => normalizeHookPayload({ event: 'not_real', session_id: 'a' }));
  assert.throws(() => normalizeHookPayload({ event: 'needs_input; rm -rf /' }));
});

test('needs_input hook moves card to review with reason (amber)', () => {
  const b = quiet(freshBoard());
  b.applyHookEvent(normalizeHookPayload({
    event: 'needs_input',
    session_id: '11111111-1111-1111-1111-111111111111',
    message: 'Permission prompt: allow Bash',
  }));
  const card = b.get('11111111-1111-1111-1111-111111111111');
  assert.equal(card.status, 'review');
  assert.equal(card.needsInputReason, 'Permission prompt: allow Bash');
});

test('tool_activity clears stale amber state and counts tools', () => {
  const b = quiet(freshBoard());
  const id = '22222222-2222-2222-2222-222222222222';
  b.applyHookEvent(normalizeHookPayload({ event: 'needs_input', session_id: id }));
  b.applyHookEvent(normalizeHookPayload({ event: 'tool_activity', session_id: id }));
  const card = b.get(id);
  assert.equal(card.status, 'in_progress');
  assert.equal(card.needsInputReason, null);
  assert.equal(card.toolUseCount, 1);
});

test('session_end moves card to done', () => {
  const b = quiet(freshBoard());
  const id = '33333333-3333-3333-3333-333333333333';
  b.applyHookEvent(normalizeHookPayload({ event: 'session_start', session_id: id }));
  assert.equal(b.get(id).status, 'in_progress');
  b.applyHookEvent(normalizeHookPayload({ event: 'session_end', session_id: id }));
  assert.equal(b.get(id).status, 'done');
});

test('setStatus validates the status value', () => {
  const b = quiet(freshBoard());
  const id = '44444444-4444-4444-4444-444444444444';
  b.upsert({ id, title: 't' });
  const card = b.setStatus(id, 'review');
  assert.equal(card.status, 'review');
  assert.throws(() => b.setStatus(id, "'; DROP TABLE cards;--"));
});

test('syncFromCli maps CLI statuses and never overrides fresh amber hooks', () => {
  const b = quiet(freshBoard());
  const id = '55555555-5555-5555-5555-555555555555';

  // Hook says amber first.
  b.applyHookEvent(normalizeHookPayload({ event: 'needs_input', session_id: id }));

  // CLI reports it as working — must NOT downgrade the amber alert.
  b.syncFromCli([{ session_id: id, status: 'running', cwd: '/tmp/proj' }]);
  assert.equal(b.get(id).status, 'review');

  // CLI reporting completion DOES win.
  b.syncFromCli([{ session_id: id, status: 'completed' }]);
  assert.equal(b.get(id).status, 'done');

  // Unknown shapes are tolerated.
  b.syncFromCli([{ nonsense: true }, null, 'string-entry']);
  b.syncFromCli('garbage');
});

test('flagStalled marks only silent in-progress cards', () => {
  const b = quiet(freshBoard());
  const activeId = '66666666-6666-6666-6666-666666666666';
  const stalledId = '77777777-7777-7777-7777-777777777777';
  const doneId = '88888888-8888-8888-8888-888888888888';

  b.upsert({ id: activeId, title: 'active', fileModifiedAt: Date.now() });
  b.setStatus(activeId, 'in_progress');
  b.upsert({ id: stalledId, title: 'stale', fileModifiedAt: Date.now() - 30 * 60_000 });
  b.setStatus(stalledId, 'in_progress');
  b.upsert({ id: doneId, title: 'done long ago', fileModifiedAt: Date.now() - 30 * 60_000 });
  b.setStatus(doneId, 'done');

  b.flagStalled(10 * 60_000);
  assert.equal(b.get(activeId).stalled, false);
  assert.equal(b.get(stalledId).stalled, true);
  // Done cards are never flagged as stalled.
  assert.equal(b.get(doneId).stalled, false);
});

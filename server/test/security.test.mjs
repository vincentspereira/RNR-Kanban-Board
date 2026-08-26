/**
 * Unit tests for security helpers (A5).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidToken, extractToken } from '../src/security.js';

const TOKEN = 'unit-test-secret-token-0123456789abcdef';

// isValidToken(token, expected) uses timingSafeEqual under the hood.
test('isValidToken accepts exact match', () => {
  assert.equal(isValidToken(TOKEN, TOKEN), true);
});

test('isValidToken rejects wrong token', () => {
  assert.equal(isValidToken('wrong-token-aaaaaaaaaaaaaaaaaa', TOKEN), false);
});

test('isValidToken rejects non-string input', () => {
  assert.equal(isValidToken(undefined, TOKEN), false);
  assert.equal(isValidToken(null, TOKEN), false);
  // Object with toString — must not be coerced into an acceptance.
  assert.equal(isValidToken({ toString: () => TOKEN }, TOKEN), false);
});

function mockReq({ auth, header, query }) {
  return {
    headers: auth ? { authorization: auth } : header ? { 'x-orchestrator-token': header } : {},
    query: query ?? {},
  };
}

test('extractToken reads bearer authorization', () => {
  assert.equal(extractToken(mockReq({ auth: `Bearer ${TOKEN}` })), TOKEN);
});

test('extractToken reads x-orchestrator-token header', () => {
  assert.equal(extractToken(mockReq({ header: TOKEN })), TOKEN);
});

test('extractToken reads ws query param', () => {
  assert.equal(extractToken(mockReq({ query: { token: TOKEN } })), TOKEN);
});

test('extractToken returns null when absent', () => {
  assert.equal(extractToken(mockReq({})), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCredentials } from '../src/services/credentials';

test('restores a valid persisted Hue bridge credential', () => {
  const saved = JSON.stringify({ bridgeIp: '192.168.1.20', username: 'bridge-user-token' });

  assert.deepEqual(parseCredentials(saved), {
    bridgeIp: '192.168.1.20',
    username: 'bridge-user-token',
  });
});

test('rejects missing, malformed, and incomplete persisted credentials', () => {
  assert.equal(parseCredentials(null), null);
  assert.equal(parseCredentials('{not valid JSON'), null);
  assert.equal(parseCredentials(JSON.stringify({ bridgeIp: '192.168.1.20' })), null);
  assert.equal(parseCredentials(JSON.stringify({ bridgeIp: ' ', username: 'token' })), null);
});


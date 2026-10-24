import assert from 'node:assert/strict';
import test from 'node:test';

import { renameLight } from '../src/services/hue';

const credentials = { bridgeIp: '192.168.1.20', username: 'test-user' };

test('renames a lamp on the Hue Bridge using its light resource', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    assert.equal(url, 'http://192.168.1.20/api/test-user/lights/7');
    assert.equal(init?.method, 'PUT');
    assert.equal(init?.headers && (init.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init?.body as string), { name: 'Porch Light' });
    return new Response(JSON.stringify([{ success: { '/lights/7/name': 'Porch Light' } }]), { status: 200 });
  });

  await renameLight(credentials, '7', '  Porch Light  ');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('rejects empty and overlong names without contacting the bridge', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
  await assert.rejects(renameLight(credentials, '7', '  '), /Enter a lamp name/);
  await assert.rejects(renameLight(credentials, '7', 'a'.repeat(33)), /32 characters/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('surfaces Hue errors even if the response also contains a success', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
    { success: { '/lights/7/name': 'Porch Light' } },
    { error: { description: 'resource not available' } },
  ]), { status: 200 }));
  await assert.rejects(renameLight(credentials, '7', 'Porch Light'), /resource not available/);
});

test('does not report success without a confirmation from the bridge', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('[]', { status: 200 }));
  await assert.rejects(renameLight(credentials, '7', 'Porch Light'), /did not confirm/);
});
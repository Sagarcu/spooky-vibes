import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlaybackTarget, resolvePlaybackTarget, type PlaybackTarget } from '../src/services/playback-target';
import type { HueLight, HueLightGroup } from '../src/types/hue';

const lights: HueLight[] = [{
  id: '1', name: 'Desk', on: true, brightness: 80,
  colorCapable: false, colorTemperatureCapable: false, kind: 'dimmable',
}];
const groups: HueLightGroup[] = [{ id: '1', name: 'Living room', lightIds: ['1', 'offline'] }];

test('remember exactly one group or lamp, including targets with matching IDs', () => {
  for (const kind of ['group', 'light'] as const) {
    const target: PlaybackTarget = { kind, id: '1' };
    const restored = parsePlaybackTarget(JSON.stringify(target));
    assert.deepEqual(restored, target);
    assert.deepEqual(resolvePlaybackTarget(restored, groups, lights), {
      name: kind === 'group' ? 'Living room' : 'Desk', lightIds: ['1'],
    });
  }
});

test('a new installation has no implicit target even if lights and groups are available', () => {
  assert.equal(parsePlaybackTarget(null), null);
  assert.deepEqual(resolvePlaybackTarget(null, groups, lights), { name: 'None selected', lightIds: [] });
});

test('unavailable lamps remain remembered and resolve again when they return', () => {
  const target: PlaybackTarget = { kind: 'light', id: '1' };
  assert.deepEqual(resolvePlaybackTarget(target, groups, []), { name: 'Saved lamp unavailable', lightIds: [] });
  assert.deepEqual(target, { kind: 'light', id: '1' });
  assert.deepEqual(resolvePlaybackTarget(target, groups, lights), { name: 'Desk', lightIds: ['1'] });
});

test('deleted or unavailable groups never fall back to a lamp or a different group', () => {
  const target: PlaybackTarget = { kind: 'group', id: 'deleted' };
  assert.deepEqual(resolvePlaybackTarget(target, groups, lights), { name: 'Saved group unavailable', lightIds: [] });
  assert.deepEqual(resolvePlaybackTarget({ kind: 'group', id: '1' }, groups, []), {
    name: 'Living room', lightIds: [],
  });
});

test('invalid saved targets fail explicitly rather than silently choosing a target', () => {
  for (const raw of ['{', 'null', '[]', '{}', '42',
    '{"kind":"room","id":"1"}', '{"kind":"light","id":1}', '{"kind":"group","id":" "}',
  ]) assert.throws(() => parsePlaybackTarget(raw));
});

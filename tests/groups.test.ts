import assert from 'node:assert/strict';
import test from 'node:test';

import { createLightGroup, groupsForAvailableLights, saveLightGroup } from '../src/services/groups';
import type { HueLightGroup } from '../src/types/hue';

test('light groups trim names and remove duplicate light selections', () => {
  const group = createLightGroup('  Downstairs  ', ['1', '2', '1'], 'downstairs');

  assert.deepEqual(group, { id: 'downstairs', name: 'Downstairs', lightIds: ['1', '2'] });
});

test('light groups require a name and at least one light', () => {
  assert.throws(() => createLightGroup('   ', ['1']), /name/i);
  assert.throws(() => createLightGroup('Downstairs', []), /at least one/i);
});

test('unavailable lights are excluded from group sequence targets', () => {
  const available = groupsForAvailableLights([
    { id: 'downstairs', name: 'Downstairs', lightIds: ['1', 'missing', '2'] },
    { id: 'gone', name: 'Gone', lightIds: ['missing'] },
  ], ['2', '1']);

  assert.deepEqual(available, [{ id: 'downstairs', name: 'Downstairs', lightIds: ['1', '2'] }]);
});

const savedGroups = (): HueLightGroup[] => [
  { id: 'downstairs', name: 'Downstairs', lightIds: ['1', 'offline'] },
  { id: 'upstairs', name: 'Upstairs', lightIds: ['2'] },
];

test('editing replaces lamps and renames in place without changing the group ID or other groups', () => {
  const original = savedGroups();
  const updated = saveLightGroup(original, '  Lounge  ', ['3', 'offline', '3'], 'downstairs');

  assert.deepEqual(updated, [
    { id: 'downstairs', name: 'Lounge', lightIds: ['3', 'offline'] },
    original[1],
  ]);
  assert.deepEqual(original, savedGroups());
  assert.equal(updated[1], original[1]);
  assert.deepEqual(groupsForAvailableLights(updated, ['2', '3']).find(group => group.id === 'downstairs'), {
    id: 'downstairs', name: 'Lounge', lightIds: ['3'],
  });
});

test('saving unchanged membership retains unavailable lamps and permits the existing name', () => {
  assert.deepEqual(saveLightGroup(savedGroups(), 'Downstairs', ['1', 'offline'], 'downstairs'), savedGroups());
  assert.deepEqual(saveLightGroup(savedGroups(), 'DOWNSTAIRS', ['1'], 'downstairs')[0], {
    id: 'downstairs', name: 'DOWNSTAIRS', lightIds: ['1'],
  });
});

test('group edits reject empty membership, empty names, duplicate names, and missing groups', () => {
  const original = savedGroups();
  assert.throws(() => saveLightGroup(original, 'Downstairs', [], 'downstairs'), /at least one/i);
  assert.throws(() => saveLightGroup(original, ' ', ['1'], 'downstairs'), /name/i);
  assert.throws(() => saveLightGroup(original, ' UPSTAIRS ', ['1'], 'downstairs'), /already exists/i);
  assert.throws(() => saveLightGroup(original, 'Deleted group', ['1'], 'deleted'), /no longer exists/i);
  assert.deepEqual(original, savedGroups());
});

test('creation shares name validation without replacing an existing group', () => {
  const original = savedGroups();
  assert.throws(() => saveLightGroup(original, ' downstairs ', ['1']), /already exists/i);
  assert.throws(() => saveLightGroup(original, '', ['1']), /name/i);
  assert.throws(() => saveLightGroup(original, 'Kitchen', []), /at least one/i);
  const added = saveLightGroup(original, ' Kitchen ', ['3', '3']);
  assert.equal(added.length, 3);
  assert.deepEqual(added.slice(0, 2), original);
  assert.equal(added[2]?.name, 'Kitchen');
  assert.deepEqual(added[2]?.lightIds, ['3']);
  assert.ok(added[2]?.id);
  assert.deepEqual(original, savedGroups());
});

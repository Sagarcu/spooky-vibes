import assert from 'node:assert/strict';
import test from 'node:test';

import { createLightGroup, groupsForAvailableLights } from '../src/services/groups';

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


import assert from 'node:assert/strict';
import test from 'node:test';

import { inferLightCapabilities } from '../src/services/hue';

test('classifies an on/off Hue plug-in unit as a smart switch', () => {
  const result = inferLightCapabilities({
    type: 'On/Off plug-in unit',
    state: { on: false },
  });

  assert.deepEqual(result, {
    colorCapable: false,
    colorTemperatureCapable: false,
    kind: 'onoff-plug',
  });
});

test('classifies a dimmable Hue plug-in unit separately', () => {
  const result = inferLightCapabilities({
    type: 'Dimmable plug-in unit',
    state: { on: true, bri: 127 },
  });

  assert.deepEqual(result, {
    colorCapable: false,
    colorTemperatureCapable: false,
    kind: 'dimmable-plug',
  });
});


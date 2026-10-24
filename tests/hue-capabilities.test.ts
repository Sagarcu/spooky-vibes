import assert from 'node:assert/strict';
import test from 'node:test';

import { inferLightCapabilities } from '../src/services/hue';

test('classifies an RGB Hue lamp from its color gamut capability', () => {
  const result = inferLightCapabilities({
    type: 'Extended color light',
    state: { on: true, hue: 10_000, sat: 200, ct: 300 },
    capabilities: { control: { colorgamut: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]], ct: { min: 153, max: 500 } } },
  });

  assert.deepEqual(result, { colorCapable: true, colorTemperatureCapable: true, kind: 'color' });
});

test('classifies a tunable-white Hue lamp from its color temperature capability', () => {
  const result = inferLightCapabilities({
    type: 'Color temperature light',
    state: { on: true, ct: 366 },
    capabilities: { control: { ct: { min: 153, max: 454 } } },
  });

  assert.deepEqual(result, { colorCapable: false, colorTemperatureCapable: true, kind: 'tunable-white' });
});

test('classifies a brightness-only Hue lamp without color controls', () => {
  const result = inferLightCapabilities({ type: 'Dimmable light', state: { on: false } });

  assert.deepEqual(result, { colorCapable: false, colorTemperatureCapable: false, kind: 'dimmable' });
});


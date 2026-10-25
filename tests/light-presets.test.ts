import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestWhitePreset, whites } from '../src/services/light-presets';

test('white preset indicator matches exact presets and bridge temperature rounding', () => {
  for (const [, temperature] of whites) {
    assert.equal(nearestWhitePreset(temperature), temperature);
    const bridgeTemperature = Math.round(1_000_000 / Math.round(1_000_000 / temperature));
    assert.equal(nearestWhitePreset(bridgeTemperature), temperature);
  }
});

test('white preset indicator chooses the nearest temperature, preferring warmer on a tie', () => {
  assert.equal(nearestWhitePreset(2850), 2700);
  assert.equal(nearestWhitePreset(2851), 3000);
  assert.equal(nearestWhitePreset(3800), 4000);
  assert.equal(nearestWhitePreset(2000), 2200);
  assert.equal(nearestWhitePreset(6500), 5000);
});

test('white preset indicator has no selection when the bridge reports no temperature', () => {
  assert.equal(nearestWhitePreset(undefined), undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { hsvHex, wheelColorAt, WHEEL_RADIUS, WHEEL_SIZE } from '../src/services/color-wheel';

test('wheel preview converts HSV to RGB hex including saturation and brightness', () => {
  assert.equal(hsvHex(0, 100, 100), '#ff0000');
  assert.equal(hsvHex(120, 100, 100), '#00ff00');
  assert.equal(hsvHex(240, 100, 100), '#0000ff');
  assert.equal(hsvHex(0, 0, 100), '#ffffff');
  assert.equal(hsvHex(0, 100, 50), '#800000');
  assert.equal(hsvHex(360, 100, 100), '#ff0000');
});

test('wheel touch chooses angle and radial saturation; clamps outside and retains center hue', () => {
  const center = WHEEL_SIZE / 2;
  assert.deepEqual(wheelColorAt(center, center - WHEEL_RADIUS, 30), { hue: 0, saturation: 100 });
  assert.deepEqual(wheelColorAt(center + WHEEL_RADIUS, center, 30), { hue: 90, saturation: 100 });
  assert.deepEqual(wheelColorAt(center, center + WHEEL_RADIUS / 2, 30), { hue: 180, saturation: 50 });
  assert.deepEqual(wheelColorAt(center, center, 30), { hue: 30, saturation: 0 });
  assert.deepEqual(wheelColorAt(center - WHEEL_RADIUS * 2, center, 30), { hue: 270, saturation: 100 });
});

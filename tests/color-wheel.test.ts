import assert from 'node:assert/strict';
import test from 'node:test';
import { hsvHex, parseHexColor, wheelColorAt, WHEEL_RADIUS, WHEEL_SIZE } from '../src/services/color-wheel';

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

test('hex input accepts full and shorthand RGB codes with optional hash and surrounding whitespace', () => {
  assert.deepEqual(parseHexColor('#FF0000'), { hue: 0, saturation: 100, brightness: 100 });
  assert.deepEqual(parseHexColor('00ff00'), { hue: 120, saturation: 100, brightness: 100 });
  assert.deepEqual(parseHexColor(' #00f '), { hue: 240, saturation: 100, brightness: 100 });
  assert.deepEqual(parseHexColor('fff'), { hue: 0, saturation: 0, brightness: 100 });
  assert.deepEqual(parseHexColor('#000000'), { hue: 0, saturation: 0, brightness: 0 });
});

test('hex conversion preserves RGB color and brightness through an HSV round trip', () => {
  for (const hex of ['#123456', '#FF8800', '#808080', '#010203', '#FF0088', '#00FFFF', '#000001']) {
    const color = parseHexColor(hex);
    assert.ok(color);
    assert.equal(hsvHex(color.hue, color.saturation, color.brightness).toUpperCase(), hex);
  }
});

test('hex input rejects malformed, non-RGB, and incomplete codes', () => {
  for (const input of ['', '#', '12', '1234', '12345', '#12345678', 'red', '#GG8800', '##123456', 'FF 8800']) {
    assert.equal(parseHexColor(input), null);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { getLights, setLightState } from '../src/services/hue';

test('reads bridge color mode, XY coordinates, raw brightness and temperature for preview snapshots', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    '7': { name: 'Porch', type: 'Extended color light', state: { on: true, bri: 113, hue: 12000, sat: 130, ct: 290, colormode: 'xy', xy: [0.22, 0.33] } },
  }), { status: 200 }));
  const lights = await getLights({ bridgeIp: '192.168.1.20', username: 'test-user' });
  assert.equal(lights[0]?.brightnessRaw, 113);
  assert.equal(lights[0]?.colorTemperatureMired, 290);
  assert.equal(lights[0]?.colorMode, 'xy');
  assert.deepEqual(lights[0]?.xy, [0.22, 0.33]);
});

test('restores raw Hue brightness and XY without Kelvin or percentage rounding', async t => {
  const bodies: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string));
    return new Response(JSON.stringify([{ success: { '/lights/7/state/on': true } }]), { status: 200 });
  });
  const credentials = { bridgeIp: '192.168.1.20', username: 'test-user' };
  await setLightState(credentials, '7', { on: true, brightnessRaw: 113, xy: [0.22, 0.33], transitionTimeDeciseconds: 0 });
  await setLightState(credentials, '7', { on: false, brightnessRaw: 101, colorTemperatureMired: 290, transitionTimeDeciseconds: 0 });
  assert.deepEqual(bodies, [{ on: true, bri: 113, xy: [0.22, 0.33], transitiontime: 0 }, { on: false, bri: 101, ct: 290, transitiontime: 0 }]);
});

test('sends 500 ms transitions for smooth candlelight updates', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    assert.equal(url, 'http://192.168.1.20/api/test-user/lights/7/state');
    assert.equal(init?.method, 'PUT');
    assert.deepEqual(JSON.parse(init?.body as string), { on: true, bri: 25, ct: 455, transitiontime: 5 });
    return new Response(JSON.stringify([{ success: { '/lights/7/state/bri': 25 } }]), { status: 200 });
  });

  await setLightState({ bridgeIp: '192.168.1.20', username: 'test-user' }, '7', {
    on: true, brightness: 10, colorTemperature: 2200, transitionTimeDeciseconds: 5,
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('sends instant and faded Off commands, but omits the transition for legacy actions', async t => {
  const bodies: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string));
    return new Response(JSON.stringify([{ success: { '/lights/7/state/on': false } }]), { status: 200 });
  });
  const credentials = { bridgeIp: '192.168.1.20', username: 'test-user' };
  await setLightState(credentials, '7', { on: false, transitionTimeDeciseconds: 0 });
  await setLightState(credentials, '7', { on: false, transitionTimeDeciseconds: 15 });
  await setLightState(credentials, '7', { on: false });
  assert.deepEqual(bodies, [{ on: false, transitiontime: 0 }, { on: false, transitiontime: 15 }, { on: false }]);
});

test('sends timeline RGB colors and candle white as separate Hue state commands', async t => {
  const bodies: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string));
    return new Response(JSON.stringify([{ success: { '/lights/7/state/on': true } }]), { status: 200 });
  });
  const credentials = { bridgeIp: '192.168.1.20', username: 'test-user' };
  await setLightState(credentials, '7', { on: true, brightness: 60, hue: 50000, saturation: 254 });
  await setLightState(credentials, '7', { on: true, brightness: 25, colorTemperature: 2200 });
  assert.deepEqual(bodies, [{ on: true, bri: 152, hue: 50000, sat: 254 }, { on: true, bri: 64, ct: 455 }]);
});



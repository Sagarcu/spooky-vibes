import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultAmbianceSettings, isAmbianceSettings, parseSavedAmbiances, validateSavedAmbiance,
  type SavedAmbiance,
} from '../src/services/ambiance-settings';
import { ambianceLightState, configuredAmbianceSequence, createCandlelightStep, createHalloweenStormStep } from '../src/services/sequences';
import { createAmbiancePlayback, type AmbianceMode } from '../src/services/ambiance';
import { backgroundAmbianceRequest } from '../src/services/background-ambiance';
import type { HueLight, LightState } from '../src/types/hue';
import { hueStateBody } from '../src/services/hue-state';

const color: HueLight = { id: '1', name: 'Color', kind: 'color', on: false, brightness: 50, colorCapable: true, colorTemperatureCapable: true };
const white: HueLight = { ...color, id: '2', kind: 'tunable-white', colorCapable: false };
const dim: HueLight = { ...white, id: '3', kind: 'dimmable', colorTemperatureCapable: false };
const plug: HueLight = { ...dim, id: '4', kind: 'onoff-plug' };
const configuration = (): SavedAmbiance => ({
  id: 'candles', name: ' Living room candles ', sequenceId: 'candlelight',
  target: { kind: 'group', id: 'living' }, settings: defaultAmbianceSettings('candlelight'),
});

test('effect defaults preserve brightness ranges and RGB white temperatures', () => {
  assert.deepEqual(defaultAmbianceSettings('candlelight'), {
    minBrightness: 8, maxBrightness: 50, color: { mode: 'white', temperature: 2200 }, glowColor: { mode: 'white', temperature: 2200 },
    whiteColor: { mode: 'keep' }, glowWhiteColor: { mode: 'keep' },
  });
  assert.deepEqual(defaultAmbianceSettings('halloween-storm'), {
    minBrightness: 80, maxBrightness: 100, color: { mode: 'white', temperature: 6500 }, glowColor: { mode: 'white', temperature: 2200 },
    whiteColor: { mode: 'keep' }, glowWhiteColor: { mode: 'keep' },
  });
});

test('brightness ranges allow fixed levels but reject reversed, fractional and out-of-bounds limits', () => {
  const defaults = defaultAmbianceSettings('candlelight');
  for (const brightness of [1, 100]) {
    const settings = { ...defaults, minBrightness: brightness, maxBrightness: brightness };
    assert.equal(isAmbianceSettings(settings), true);
    assert.equal(createCandlelightStep(undefined, () => 0.99999, settings).state.brightness, brightness);
    const quiet = createHalloweenStormStep(undefined, () => 0, settings);
    assert.equal(createHalloweenStormStep(quiet, () => 0.99999, settings).state.brightness, brightness);
  }
  for (const [minBrightness, maxBrightness] of [[0, 50], [8, 101], [51, 50], [1.5, 50], [NaN, 50], [8, Infinity]] as const) {
    const settings = { ...defaults, minBrightness, maxBrightness };
    assert.equal(isAmbianceSettings(settings), false);
    assert.throws(() => configuredAmbianceSequence('candlelight', settings), /brightness limits/);
  }
  for (const color of [{ mode: 'white', temperature: 1999 }, { mode: 'color', hue: 65536, saturation: 254 }, { mode: 'color', hue: 1, saturation: -1 }, { mode: 'other' }]) {
    assert.equal(isAmbianceSettings({ ...defaults, color }), false);
  }
});

test('candlelight stays inside custom limits including smoothing from an out-of-range prior step', () => {
  const settings = { ...defaultAmbianceSettings('candlelight'), minBrightness: 20, maxBrightness: 35, color: { mode: 'color' as const, hue: 50000, saturation: 180 } };
  let previous = createCandlelightStep(undefined, () => 0, settings);
  for (let index = 0; index < 200; index++) {
    const step = createCandlelightStep(previous, () => index % 2 ? 0.999999 : 0, settings);
    assert.ok(step.state.brightness! >= 20 && step.state.brightness! <= 35);
    assert.equal(step.state.hue, 50000);
    assert.equal(step.state.saturation, 180);
    assert.equal(step.state.colorTemperature, undefined);
    assert.ok(step.state.transitionTimeDeciseconds! * 100 < step.durationMs);
    previous = step;
  }
  assert.equal(createCandlelightStep({ ...previous, state: { brightness: 1000 } }, () => 0, settings).state.brightness, 35);
});

test('storm colors and limits are separate from dark gaps and the 1% faint glow', () => {
  const settings = {
    ...defaultAmbianceSettings('halloween-storm'), minBrightness: 15, maxBrightness: 30,
    color: { mode: 'color' as const, hue: 50000, saturation: 254 },
    glowColor: { mode: 'color' as const, hue: 6500, saturation: 200 },
  };
  const dark = createHalloweenStormStep(undefined, () => 0, settings);
  assert.deepEqual(dark.state, { on: false, transitionTimeDeciseconds: 4 });
  const glow = createHalloweenStormStep(undefined, () => 0.999999, settings);
  assert.equal(glow.state.brightness, 1);
  assert.equal(glow.state.hue, 6500);
  assert.equal(glow.state.saturation, 200);
  assert.equal(glow.durationMs, 18000);
  const low = createHalloweenStormStep(dark, () => 0, settings);
  const high = createHalloweenStormStep(glow, () => 0.999999, settings);
  assert.equal(low.state.brightness, 15);
  assert.equal(high.state.brightness, 30);
  assert.equal(high.state.hue, 50000);
  assert.equal(high.durationMs, 3000);
  assert.equal(high.state.transitionTimeDeciseconds, 0);
});

test('RGB settings never recolor white or dimmable lamps; keep mode sends no color', () => {
  for (const setting of [{ mode: 'white' as const, temperature: 2700 }, { mode: 'color' as const, hue: 50000, saturation: 254 }, { mode: 'keep' as const }]) {
    const settings = { ...defaultAmbianceSettings('candlelight'), color: setting };
    const step = createCandlelightStep(undefined, () => 0, settings);
    for (const lamp of [white, dim]) {
      const state = ambianceLightState('candlelight', lamp, step);
      assert.equal(state.brightness, 8);
      assert.equal(state.on, true);
      assert.equal(state.colorTemperature, undefined);
      assert.equal(state.hue, undefined);
      assert.equal(state.saturation, undefined);
    }
    const state = ambianceLightState('candlelight', color, step);
    assert.equal(state.colorTemperature, setting.mode === 'white' ? 2700 : undefined);
    assert.equal(state.hue, setting.mode === 'color' ? 50000 : undefined);
  }
});

test('Candlelight keeps on/off plugs on; storm switches plugs by phase even for a 1% lightning burst', () => {
  assert.deepEqual(ambianceLightState('candlelight', plug, createCandlelightStep()), { on: true });
  const settings = { ...defaultAmbianceSettings('halloween-storm'), minBrightness: 1, maxBrightness: 1 };
  const dark = createHalloweenStormStep(undefined, () => 0, settings);
  const glow = createHalloweenStormStep(undefined, () => 0.999999, settings);
  const burst = createHalloweenStormStep(glow, () => 0, settings);
  assert.deepEqual(ambianceLightState('halloween-storm', plug, dark), { on: false });
  assert.deepEqual(ambianceLightState('halloween-storm', plug, glow), { on: false });
  assert.deepEqual(ambianceLightState('halloween-storm', plug, burst), { on: true });
  assert.equal(ambianceLightState('candlelight', { ...plug, kind: 'dimmable-plug' }, createCandlelightStep(undefined, () => 0)).brightness, 8);
});

test('white-only settings reject RGB colors and invalid temperatures independently', () => {
  const defaults = defaultAmbianceSettings('candlelight');
  for (const key of ['whiteColor', 'glowWhiteColor']) {
    for (const value of [null, {}, { mode: 'other' }, { mode: 'color', hue: 0, saturation: 254 },
      ...[1999, 6501, 2700.5, NaN, Infinity, '2700', undefined].map(temperature => ({ mode: 'white', temperature }))]) {
      const settings = { ...defaults, [key]: value };
      assert.equal(isAmbianceSettings(settings), false);
      assert.throws(() => parseSavedAmbiances(JSON.stringify([{ ...configuration(), settings }])));
    }
    for (const temperature of [2000, 6500]) {
      assert.equal(isAmbianceSettings({ ...defaults, [key]: { mode: 'white', temperature } }), true);
    }
  }
});

test('Candlelight applies independent white-only tones without recoloring RGB, fixed-white lamps or plugs', () => {
  const settings = {
    ...defaultAmbianceSettings('candlelight'),
    color: { mode: 'color' as const, hue: 50000, saturation: 254 },
    whiteColor: { mode: 'white' as const, temperature: 2700 },
  };
  const step = createCandlelightStep(undefined, () => 0, settings);
  const rgbState = ambianceLightState('candlelight', color, step, settings);
  assert.equal(rgbState.hue, 50000);
  assert.equal(rgbState.colorTemperature, undefined);
  const whiteState = ambianceLightState('candlelight', white, step, settings);
  assert.equal(whiteState.colorTemperature, 2700);
  assert.equal(whiteState.hue, undefined);
  assert.equal(whiteState.saturation, undefined);
  assert.equal(whiteState.brightness, 8);
  assert.equal(hueStateBody(whiteState).ct, 370);
  for (const lamp of [dim, plug, { ...plug, kind: 'dimmable-plug' as const },
    { ...plug, colorTemperatureCapable: true }, { ...plug, kind: 'dimmable-plug' as const, colorTemperatureCapable: true }]) {
    const body = hueStateBody(ambianceLightState('candlelight', lamp, step, settings));
    assert.equal(body.on, true);
    assert.equal(body.ct, undefined);
    assert.equal(body.hue, undefined);
    assert.equal(body.sat, undefined);
    if (lamp.kind === 'onoff-plug') assert.deepEqual(body, { on: true });
    else assert.equal(body.bri, 20);
  }
  const keepRgb = { ...settings, color: { mode: 'keep' as const } };
  const keepStep = createCandlelightStep(undefined, () => 0, keepRgb);
  assert.equal(ambianceLightState('candlelight', white, keepStep, keepRgb).colorTemperature, 2700);
  assert.equal(ambianceLightState('candlelight', color, keepStep, keepRgb).colorTemperature, undefined);
});

test('storm white-only lightning and glow are independent and never recolor dark gaps or plugs', () => {
  const settings = {
    ...defaultAmbianceSettings('halloween-storm'), minBrightness: 1, maxBrightness: 1,
    whiteColor: { mode: 'white' as const, temperature: 5000 },
    glowWhiteColor: { mode: 'white' as const, temperature: 2700 },
  };
  const dark = createHalloweenStormStep(undefined, () => 0, settings);
  const glow = createHalloweenStormStep(undefined, () => 0.99999, settings);
  const burst = createHalloweenStormStep(glow, () => 0, settings);
  for (const [step, temperature, rgbTemperature] of [[dark, undefined, undefined], [glow, 2700, 2200], [burst, 5000, 6500]] as const) {
    const whiteState = ambianceLightState('halloween-storm', white, step, settings);
    assert.equal(whiteState.colorTemperature, temperature);
    assert.equal(whiteState.brightness, step.state.brightness);
    assert.equal(whiteState.on, step.state.on);
    assert.equal(ambianceLightState('halloween-storm', color, step, settings).colorTemperature, rgbTemperature);
    assert.equal(ambianceLightState('halloween-storm', dim, step, settings).colorTemperature, undefined);
    assert.deepEqual(ambianceLightState('halloween-storm', plug, step, settings), { on: step.id === 'storm-burst' });
  }
  assert.equal(ambianceLightState('halloween-storm', white, burst, { ...settings, whiteColor: { mode: 'keep' } }).colorTemperature, undefined);
  assert.equal(ambianceLightState('halloween-storm', white, glow, { ...settings, glowWhiteColor: { mode: 'keep' } }).colorTemperature, undefined);
  assert.equal(ambianceLightState('halloween-storm', white, glow, { ...settings, whiteColor: { mode: 'keep' } }).colorTemperature, 2700);
});

test('legacy saved modes retain white tones; new white-only choices round trip independently', () => {
  const { minBrightness, maxBrightness, color, glowColor } = defaultAmbianceSettings('candlelight');
  const legacy = { ...configuration(), settings: { minBrightness, maxBrightness, color, glowColor } };
  const parsed = parseSavedAmbiances(JSON.stringify([legacy]))[0]!;
  assert.equal(isAmbianceSettings(parsed.settings), true);
  const step = createCandlelightStep(undefined, () => 0, parsed.settings);
  assert.equal(ambianceLightState('candlelight', white, step, parsed.settings).colorTemperature, undefined);
  const current = validateSavedAmbiance({
    ...configuration(),
    settings: { ...defaultAmbianceSettings('candlelight'),
      whiteColor: { mode: 'white', temperature: 3000 }, glowWhiteColor: { mode: 'white', temperature: 4000 } },
  });
  assert.deepEqual(parseSavedAmbiances(JSON.stringify([current])), [current]);
  assert.equal(current.settings?.color.mode, 'white');
  assert.deepEqual(current.settings?.whiteColor, { mode: 'white', temperature: 3000 });
  assert.deepEqual(current.settings?.glowWhiteColor, { mode: 'white', temperature: 4000 });
});

test('storm resumption during a dark gap never replays an earlier white-only temperature', async t => {
  const settings = {
    ...defaultAmbianceSettings('halloween-storm'),
    glowWhiteColor: { mode: 'white' as const, temperature: 2700 },
  };
  let apply!: (id: string, state: LightState) => Promise<void>;
  const calls: ReturnType<typeof hueStateBody>[] = [];
  const playback = createAmbiancePlayback(() => {}, () => assert.fail('Unexpected playback error'));
  t.after(() => playback.dispose());
  playback.start({ sequenceId: 'halloween-storm', name: 'Storm', targetName: 'White lamp', lightIds: [white.id] }, handler => {
    apply = handler;
    let finish!: () => void;
    return { done: new Promise<void>(resolve => { finish = resolve; }), cancel: () => finish() };
  }, async (_id, state) => { calls.push(hueStateBody(state)); });
  await new Promise<void>(resolve => setImmediate(resolve));
  await apply(white.id, ambianceLightState('halloween-storm', white, createHalloweenStormStep(undefined, () => 0.99999, settings), settings));
  assert.equal(calls[0]?.ct, 370);
  let finishHome!: () => void;
  const homeDone = new Promise<void>(resolve => { finishHome = resolve; });
  const foreground = playback.foreground([white.id], () => ({ done: homeDone, cancel: finishHome }));
  await new Promise<void>(resolve => setImmediate(resolve));
  await apply(white.id, ambianceLightState('halloween-storm', white, createHalloweenStormStep(undefined, () => 0, settings), settings));
  finishHome();
  await foreground.done;
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.on, false);
  assert.equal(calls[1]?.ct, undefined);
  await playback.stopAll();
});

test('saved modes round trip independently with names, targets and settings but no running state', () => {
  const one = validateSavedAmbiance(configuration());
  const two = { ...one, id: 'second', name: 'Another mood', settings: { ...one.settings!, minBrightness: 25 } };
  const timeline: SavedAmbiance = { id: 'timeline-mode', name: 'Timeline loop', sequenceId: 'timeline-1', target: null };
  const saved = parseSavedAmbiances(JSON.stringify([one, two, timeline]));
  assert.equal(saved[0]?.name, 'Living room candles');
  assert.equal(saved[1]?.settings?.minBrightness, 25);
  assert.equal(saved[0]?.settings?.minBrightness, 8);
  assert.deepEqual(saved[2], timeline);
  assert.equal(saved.some(item => 'running' in item), false);
  assert.deepEqual(parseSavedAmbiances(null), []);
});

test('malformed saved modes fail explicitly, including duplicate IDs and bad targets', () => {
  for (const raw of ['{', '{}', 'null', '[null]', JSON.stringify([configuration(), configuration()]),
    JSON.stringify([{ ...configuration(), target: null }]), JSON.stringify([{ ...configuration(), settings: undefined }]),
    JSON.stringify([{ ...configuration(), name: ' ' }]), JSON.stringify([{ ...configuration(), name: 'a'.repeat(61) }]),
    JSON.stringify([{ ...configuration(), target: { kind: 'room', id: '1' } }]),
  ]) assert.throws(() => parseSavedAmbiances(raw));
});

test('stopping and playback failure remove only runtime state, leaving reusable configurations untouched', async () => {
  const saved = [validateSavedAmbiance(configuration())];
  const persisted = JSON.stringify(saved);
  let modes: AmbianceMode[] = [];
  const playback = createAmbiancePlayback(next => { modes = next; }, () => {});
  const description = { sequenceId: 'candlelight', configurationId: saved[0]!.id, name: saved[0]!.name, targetName: 'Living room', lightIds: ['1'] };
  const play = () => {
    let resolve!: () => void;
    return { done: new Promise<void>(yes => { resolve = yes; }), cancel: () => resolve() };
  };
  const id = playback.start(description, play, async () => {});
  assert.equal(modes[0]?.configurationId, 'candles');
  await playback.stop(id);
  assert.equal(modes.length, 0);
  assert.equal(JSON.stringify(saved), persisted);
  const restarted = playback.start(description, play, async () => {});
  assert.notEqual(restarted, id);
  await playback.stopAll();
  playback.start(description, () => ({ done: Promise.reject(new Error('Bridge offline')), cancel: () => {} }), async () => {});
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(modes.length, 0);
  assert.deepEqual(parseSavedAmbiances(persisted), saved);
  playback.dispose();
});

test('native request includes per-mode settings, stable configuration ID and RGB capabilities', () => {
  const saved = validateSavedAmbiance(configuration());
  saved.settings = { ...saved.settings!, whiteColor: { mode: 'white', temperature: 3000 }, glowWhiteColor: { mode: 'white', temperature: 4000 } };
  const request = backgroundAmbianceRequest({
    sequenceId: saved.sequenceId, configurationId: saved.id, name: saved.name, targetName: 'Living room', lightIds: ['1', '2', '4'],
  }, { bridgeIp: 'bridge.local', username: 'placeholder' }, [color, white, plug], undefined, saved.settings);
  assert.equal(request.description.configurationId, saved.id);
  assert.deepEqual(request.settings, saved.settings);
  assert.deepEqual(JSON.parse(JSON.stringify(request)).settings.whiteColor, { mode: 'white', temperature: 3000 });
  assert.deepEqual(JSON.parse(JSON.stringify(request)).settings.glowWhiteColor, { mode: 'white', temperature: 4000 });
  assert.deepEqual(request.lights.map(lamp => lamp.colorCapable), [true, false, false]);
  assert.deepEqual(request.lights.map(lamp => lamp.colorTemperatureCapable), [true, true, false]);
  assert.deepEqual(request.description.lightIds, ['1', '2', '4']);
});

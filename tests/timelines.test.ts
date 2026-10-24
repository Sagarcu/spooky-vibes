import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineRunner, isValidAudioClip, validateTimeline } from '../src/services/sequences';
import { moveTimelineAction, snappedTimelineTime } from '../src/services/timeline-drag';
import type { HueLight, TimelineAudioClip, TimelineSequence } from '../src/types/hue';

const sequence = (): TimelineSequence => ({
  id: 'scene', name: ' Example ', groupId: 'group', durationMs: 1000,
  events: [
    { id: 'later', lightId: 'a', atMs: 30, state: { on: false } },
    { id: 'first', lightId: 'a', atMs: 0, state: { on: true, brightness: 42 } },
    { id: 'other', lightId: 'b', atMs: 0, state: { on: true, brightness: 70 } },
  ],
});
const colorLamp: HueLight = { id: 'a', name: 'RGB lamp', kind: 'color', on: true, brightness: 50, colorCapable: true, colorTemperatureCapable: true };
const whiteLamp: HueLight = { id: 'b', name: 'White lamp', kind: 'tunable-white', on: true, brightness: 50, colorCapable: false, colorTemperatureCapable: true };
const clip = (id: string, atMs = 0): TimelineAudioClip => ({ id, name: 'Creak.mp3', uri: `file:///audio-${id}.mp3`, atMs, durationMs: 2300, volume: 0.5 });

test('drag times snap to tenths of a second and stay inside the timeline', () => {
  assert.equal(snappedTimelineTime(1000, 24, 2000, 48), 1500);
  assert.equal(snappedTimelineTime(1000, -300, 2000, 48), 0);
  assert.equal(snappedTimelineTime(1000, 300, 2000, 48), 1900);
  assert.equal(snappedTimelineTime(0, 240, 1150, 48), 1100);
});

test('dragging a light action changes its time without changing other actions or allowing collisions', () => {
  const original = sequence();
  const moved = moveTimelineAction(original, 'later', 500);
  assert.equal(moved.events.find(event => event.id === 'later')?.atMs, 500);
  assert.equal(original.events[0]?.atMs, 30);
  assert.throws(() => moveTimelineAction(original, 'later', 0), /already an action/);
  assert.throws(() => moveTimelineAction(original, 'later', 1000), /outside the timeline/);
});

test('validates background and overlapping effects with measured durations even past the sequence end', () => {
  const original = { ...sequence(), events: [], backgroundAudio: clip('music'), audioEffects: [clip('creak'), clip('scream', 500)] };
  assert.equal(validateTimeline(original, ['a']).audioEffects?.[0]?.durationMs, 2300);
  assert.equal(isValidAudioClip(clip('creak', 1000), 1000), false);
  assert.throws(() => validateTimeline({ ...original, backgroundAudio: { ...clip('music'), durationMs: 0 } }, ['a']), /audio clip/);
  assert.throws(() => validateTimeline({ ...original, audioEffects: [clip('music')] }, ['a']), /unique IDs/);
  assert.throws(() => validateTimeline({ ...original, audioEffects: [{ ...clip('bad'), volume: 1.5 }] }, ['a']), /audio clip/);
});

test('audio and lights at the same time run together and cancelling prevents later effects', async () => {
  const original = sequence();
  const calls: string[] = [];
  const runner = createTimelineRunner({ ...original, backgroundAudio: clip('music'), audioEffects: [clip('late', 500)] }, async id => { calls.push(`light:${id}`); }, audio => { calls.push(`audio:${audio.id}`); });
  await new Promise(resolve => setTimeout(resolve, 50));
  runner.cancel();
  await runner.done;
  assert.ok(calls.includes('audio:music'));
  assert.ok(calls.includes('light:a'));
  assert.ok(!calls.includes('audio:late'));
});

test('validates and orders timeline actions without changing the original', () => {
  const original = sequence();
  const checked = validateTimeline(original, ['a', 'b']);
  assert.equal(checked.name, 'Example');
  assert.deepEqual(checked.events.map(event => event.id), ['first', 'other', 'later']);
  assert.equal(original.events[0]!.id, 'later');
});

test('timeline restore flag is optional, persists when enabled, and rejects malformed values', () => {
  assert.equal(validateTimeline(sequence(), ['a', 'b']).restoreAfterPlayback, undefined);
  assert.equal(validateTimeline({ ...sequence(), restoreAfterPlayback: true }, ['a', 'b']).restoreAfterPlayback, true);
  assert.equal(validateTimeline({ ...sequence(), restoreAfterPlayback: false }, ['a', 'b']).restoreAfterPlayback, false);
  assert.throws(() => validateTimeline({ ...sequence(), restoreAfterPlayback: 'yes' } as unknown as TimelineSequence, ['a', 'b']), /Restore-after-playback/);
});

test('rejects missing group lamps, duplicate timestamps and actions outside duration', () => {
  const original = sequence();
  assert.throws(() => validateTimeline(original, ['a']), /invalid lamp/);
  assert.throws(() => validateTimeline({ ...original, events: [original.events[1]!, { ...original.events[1]!, id: 'duplicate' }] }, ['a', 'b']), /Only one action/);
  assert.throws(() => validateTimeline({ ...original, events: [{ ...original.events[0]!, atMs: 1000 }] }, ['a', 'b']), /invalid lamp/);
  assert.throws(() => validateTimeline({ ...original, events: [{ ...original.events[0]!, state: { on: true, brightness: 0 } }] }, ['a', 'b']), /invalid lamp/);
  assert.throws(() => validateTimeline({ ...original, events: [] }, ['a', 'b']), /Add 1/);
});

test('power-only switch actions do not need a brightness value', () => {
  const original = sequence();
  const powerOnly = { ...original, events: [{ ...original.events[1]!, state: { on: true } }] };
  assert.equal(validateTimeline(powerOnly, ['a', 'b']).events[0]?.state.on, true);
});

test('timeline transitions request instant or smooth changes, including Off and legacy actions', async () => {
  const original = sequence();
  const events = [
    { ...original.events[1]!, state: { on: true, brightness: 42, transitionTimeDeciseconds: 0 } },
    { ...original.events[2]!, state: { on: true, brightness: 70, transitionTimeDeciseconds: 100 } },
    { ...original.events[0]!, state: { on: false, transitionTimeDeciseconds: 15 } },
  ];
  const checked = validateTimeline({ ...original, events }, ['a', 'b'], [colorLamp, whiteLamp]);
  const received: unknown[] = [];
  const runner = createTimelineRunner(checked, async (_id, state) => { received.push(state); });
  await runner.done;
  assert.deepEqual(received, events.map(event => event.state));
  const legacy: unknown[] = [];
  await createTimelineRunner(original, async (_id, state) => { legacy.push(state); }).done;
  assert.deepEqual(legacy, [
    { on: true, brightness: 42, transitionTimeDeciseconds: 0 },
    { on: true, brightness: 70, transitionTimeDeciseconds: 0 },
    { on: false, transitionTimeDeciseconds: 0 },
  ]);
  assert.equal(original.events[0]?.state.transitionTimeDeciseconds, undefined);
});

test('rejects malformed or unsupported timeline transitions', () => {
  const original = sequence();
  const withTransition = (transitionTimeDeciseconds: number) => ({ ...original, events: [{ ...original.events[0]!, state: { on: false, transitionTimeDeciseconds } }] });
  for (const value of [-1, 101, 1.5, NaN, Infinity]) {
    assert.throws(() => validateTimeline(withTransition(value), ['a', 'b']), /invalid lamp/);
  }
  assert.throws(() => validateTimeline({ ...original, events: [{ ...original.events[0]!, state: { on: false, transitionTimeDeciseconds: '0' } }] } as unknown as TimelineSequence, ['a', 'b']), /invalid lamp/);
  const plug: HueLight = { ...colorLamp, kind: 'onoff-plug', colorCapable: false, colorTemperatureCapable: false };
  assert.throws(() => validateTimeline(withTransition(0), ['a', 'b'], [plug]), /does not support/);
  assert.deepEqual(validateTimeline({ ...original, events: [{ ...original.events[0]!, state: { on: false } }] }, ['a', 'b'], [plug]).events[0]?.state, { on: false });
});

test('accepts RGB color and Candle white actions and retains their settings during playback', async () => {
  const original = sequence();
  const events = [
    { ...original.events[1]!, state: { on: true, brightness: 60, hue: 50000, saturation: 254 } },
    { ...original.events[2]!, state: { on: true, brightness: 25, colorTemperature: 2200 } },
  ];
  const checked = validateTimeline({ ...original, events }, ['a', 'b'], [colorLamp, whiteLamp]);
  const received: unknown[] = [];
  const runner = createTimelineRunner(checked, async (_id, state) => { received.push(state); });
  await runner.done;
  assert.deepEqual(received, events.map(event => ({ ...event.state, transitionTimeDeciseconds: 0 })));
});

test('rejects unsupported colors and malformed color values', () => {
  const original = sequence();
  const colored = { ...original.events[1]!, state: { on: true, brightness: 60, hue: 50000, saturation: 254 } };
  const withState = (state: typeof colored.state | { on: boolean; brightness?: number; hue?: number; saturation?: number; colorTemperature?: number }) => ({ ...original, events: [{ ...colored, state }] });
  assert.throws(() => validateTimeline(withState(colored.state), ['a', 'b'], [{ ...colorLamp, colorCapable: false }]), /does not support/);
  assert.throws(() => validateTimeline(withState({ on: true, colorTemperature: 2200 }), ['a', 'b'], [{ ...colorLamp, colorTemperatureCapable: false }]), /does not support/);
  assert.throws(() => validateTimeline(withState({ on: true, hue: 50000 }), ['a', 'b'], [colorLamp]), /invalid lamp/);
  assert.throws(() => validateTimeline(withState({ on: true, hue: 50000, saturation: 254, colorTemperature: 2200 }), ['a', 'b'], [colorLamp]), /invalid lamp/);
  assert.throws(() => validateTimeline(withState({ on: true, hue: 65536, saturation: 254 }), ['a', 'b'], [colorLamp]), /invalid lamp/);
  assert.throws(() => validateTimeline(withState({ on: false, hue: 50000, saturation: 254 }), ['a', 'b'], [colorLamp]), /invalid lamp/);
});

test('plays each action only on its own lamp, in timestamp order', async () => {
  const received: string[] = [];
  const runner = createTimelineRunner(sequence(), async (id, state) => { received.push(`${id}:${state.on}`); });
  await runner.done;
  assert.deepEqual(received, ['a:true', 'b:true', 'a:false']);
});

test('cancel stops future timeline actions without waiting for the full duration', async () => {
  const received: string[] = [];
  const original = sequence();
  const runner = createTimelineRunner({ ...original, durationMs: 2000, events: [{ ...original.events[0]!, atMs: 1500 }] }, async id => { received.push(id); });
  runner.cancel();
  await runner.done;
  assert.deepEqual(received, []);
});

test('bridge errors reject the timeline playback', async () => {
  const runner = createTimelineRunner(sequence(), async () => { throw new Error('Bridge offline'); });
  await assert.rejects(runner.done, /Bridge offline/);
});



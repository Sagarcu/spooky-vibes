import assert from 'node:assert/strict';
import test from 'node:test';

import { builtInSequences, candlelight, createCandlelightStep, createHalloweenStormStep, createSequenceRunner, createTimelineRunner } from '../src/services/sequences';
import type { LightingSequence, TimelineSequence } from '../src/types/hue';

test('sequence runner applies every step in order', async () => {
  const received: number[] = [];
  const sequence: LightingSequence = {
    id: 'test', name: 'Test', lightIds: ['1'],
    steps: [
      { id: 'one', label: 'One', durationMs: 0, state: { brightness: 10 } },
      { id: 'two', label: 'Two', durationMs: 0, state: { brightness: 20 } },
    ],
  };

  const runner = createSequenceRunner(sequence, async (_lightIds, state) => {
    received.push(state.brightness ?? 0);
  });
  await runner.done;
  assert.deepEqual(received, [10, 20]);
});

test('cancelling a sequence prevents later steps', async () => {
  const received: number[] = [];
  const sequence: LightingSequence = {
    id: 'test', name: 'Test', lightIds: ['1'],
    steps: [
      { id: 'one', label: 'One', durationMs: 100, state: { brightness: 10 } },
      { id: 'two', label: 'Two', durationMs: 0, state: { brightness: 20 } },
    ],
  };

  const runner = createSequenceRunner(sequence, async (_lightIds, state) => {
    received.push(state.brightness ?? 0);
  });
  runner.cancel();
  await runner.done;
  assert.deepEqual(received, [10]);
});

test('candlelight stays within 8 to 50 percent with variable timing and fades shorter than each step', () => {
  const low = createCandlelightStep(undefined, () => 0);
  const high = createCandlelightStep(undefined, () => 0.999999);
  assert.equal(low.state.brightness, 8);
  assert.equal(high.state.brightness, 50);
  assert.ok(createCandlelightStep(low, () => 0.999999).state.brightness! - low.state.brightness! > 30);
  assert.ok(high.state.brightness! - createCandlelightStep(high, () => 0).state.brightness! > 30);
  assert.equal(createCandlelightStep({ ...high, state: { brightness: 100 } }, () => 0.999999).state.brightness, 50);
  assert.equal(createCandlelightStep({ ...low, state: { brightness: 0 } }, () => 0).state.brightness, 8);
  assert.equal(low.durationMs, 600);
  assert.equal(high.durationMs, 2000);
  assert.equal(low.state.colorTemperature, 2200);
  assert.equal(low.state.transitionTimeDeciseconds, 2);
  assert.equal(high.state.transitionTimeDeciseconds, 8);
  assert.equal(low.state.on, true);
});

test('candlelight varies brightness, intervals and transitions independently over many steps', () => {
  let seed = 42;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const brightness: number[] = [], durations = new Set<number>(), transitions = new Set<number>();
  let step = createCandlelightStep(undefined, random);
  for (let i = 0; i < 200; i++) {
    brightness.push(step.state.brightness!);
    durations.add(step.durationMs);
    transitions.add(step.state.transitionTimeDeciseconds!);
    assert.ok(step.state.brightness! >= 8 && step.state.brightness! <= 50);
    assert.ok(step.durationMs >= 600 && step.durationMs <= 2000);
    assert.ok(step.state.transitionTimeDeciseconds! * 100 < step.durationMs);
    step = createCandlelightStep(step, random);
  }
  assert.ok(Math.max(...brightness) - Math.min(...brightness) >= 30);
  assert.ok(durations.size > 100);
  assert.ok(transitions.size >= 5);
});

test('candlelight repeats until cancelled and then stops sending commands', async () => {
  const received: number[] = [];
  const runner = createSequenceRunner({ ...candlelight, lightIds: ['1'], nextStep: previous => ({ ...createCandlelightStep(previous, () => 0.999999), durationMs: 0 }) }, async (_ids, state) => {
    received.push(state.brightness ?? 0);
    if (received.length === 4) runner.cancel();
  });
  await runner.done;
  assert.deepEqual(received, [50, 50, 50, 50]);
});

test('candlelight respects its minimum interval between request starts', async () => {
  const sentAt: number[] = [];
  const runner = createSequenceRunner({ ...candlelight, lightIds: ['1'], nextStep: previous => createCandlelightStep(previous, () => 0) }, async () => {
    sentAt.push(Date.now());
    if (sentAt.length === 2) runner.cancel();
  });

  test('Halloween storm alternates random dark or very dim gaps with seconds-long bright bursts', () => {
    const dark = createHalloweenStormStep(undefined, () => 0);
    assert.equal(dark.state.on, false);
    assert.equal(dark.durationMs, 4000);
    const glow = createHalloweenStormStep(undefined, () => 0.999999);
    assert.equal(glow.state.brightness, 1);
    assert.equal(glow.state.on, true);
    assert.equal(glow.durationMs, 18000);
    const burst = createHalloweenStormStep(dark, () => 0);
    assert.equal(burst.state.on, true);
    assert.equal(burst.state.brightness, 80);
    assert.equal(burst.state.colorTemperature, 6500);
    assert.equal(burst.state.transitionTimeDeciseconds, 0);
    assert.equal(burst.durationMs, 1000);
    const longBurst = createHalloweenStormStep(glow, () => 0.999999);
    assert.equal(longBurst.state.brightness, 100);
    assert.equal(longBurst.durationMs, 3000);
    assert.equal(createHalloweenStormStep(burst, () => 0).state.on, false);
  });

  test('built-in library keeps Candlelight, replaces Haunted Pulse with Halloween storm', () => {
    assert.deepEqual(builtInSequences.map(sequence => sequence.id), ['candlelight', 'halloween-storm']);
  });
  await runner.done;
  assert.equal(sentAt.length, 2);
  assert.ok(sentAt[0] !== undefined && sentAt[1] !== undefined && sentAt[1] - sentAt[0] >= 580);
});

test('continuous sequence exits when applying a state fails', async () => {
  const runner = createSequenceRunner({ ...candlelight, lightIds: ['1'] }, async () => { throw new Error('Bridge offline'); });
  await assert.rejects(runner.done, /Bridge offline/);
});

test('a synchronous audio failure drains light requests before releasing timeline playback', async () => {
  let finishRequest!: () => void, signalAudioFailure!: () => void;
  const request = new Promise<void>(resolve => { finishRequest = resolve; });
  const audioFailed = new Promise<void>(resolve => { signalAudioFailure = resolve; });
  const sequence: TimelineSequence = {
    id: 'test', name: 'Test', groupId: 'g', durationMs: 100,
    events: [{ id: 'lamp', atMs: 0, lightId: 'a', state: { on: true } }],
    audioEffects: [{ id: 'sound', name: 'Sound', uri: 'file://sound.wav', atMs: 1, durationMs: 10, volume: 1 }],
  };
  let settled = false;
  const runner = createTimelineRunner(sequence, async () => request, () => { signalAudioFailure(); throw new Error('Audio failed'); });
  const completion = assert.rejects(runner.done, /Audio failed/).then(() => { settled = true; });
  await audioFailed;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  finishRequest();
  await completion;
});

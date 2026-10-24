import assert from 'node:assert/strict';
import test from 'node:test';

import { candlelight, createCandlelightStep, createSequenceRunner } from '../src/services/sequences';
import type { LightingSequence } from '../src/types/hue';

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

test('candlelight steps fade for 500 ms and keep successive brightness changes gentle', () => {
  const low = createCandlelightStep(undefined, () => 0);
  const high = createCandlelightStep(undefined, () => 0.999999);
  assert.equal(low.state.brightness, 19);
  assert.equal(high.state.brightness, 31);
  assert.equal(createCandlelightStep(low, () => 0).state.brightness, 13);
  assert.equal(createCandlelightStep(high, () => 0.999999).state.brightness, 37);
  assert.equal(createCandlelightStep({ ...low, state: { brightness: 10 } }, () => 0).state.brightness, 10);
  assert.equal(createCandlelightStep({ ...high, state: { brightness: 40 } }, () => 0.999999).state.brightness, 40);
  assert.equal(low.durationMs, 600);
  assert.equal(high.durationMs, 600);
  assert.equal(low.state.colorTemperature, 2200);
  assert.equal(low.state.transitionTimeDeciseconds, 5);
  assert.equal(low.state.on, true);
});

test('candlelight repeats until cancelled and then stops sending commands', async () => {
  const received: number[] = [];
  const runner = createSequenceRunner({ ...candlelight, lightIds: ['1'], nextStep: previous => ({ ...createCandlelightStep(previous, () => 0.999999), durationMs: 0 }) }, async (_ids, state) => {
    received.push(state.brightness ?? 0);
    if (received.length === 4) runner.cancel();
  });
  await runner.done;
  assert.deepEqual(received, [31, 37, 40, 40]);
});

test('candlelight waits about 600 ms between request starts', async () => {
  const sentAt: number[] = [];
  const runner = createSequenceRunner({ ...candlelight, lightIds: ['1'] }, async () => {
    sentAt.push(Date.now());
    if (sentAt.length === 2) runner.cancel();
  });
  await runner.done;
  assert.equal(sentAt.length, 2);
  assert.ok(sentAt[0] !== undefined && sentAt[1] !== undefined && sentAt[1] - sentAt[0] >= 580);
});

test('continuous sequence exits when applying a state fails', async () => {
  const runner = createSequenceRunner({ ...candlelight, lightIds: ['1'] }, async () => { throw new Error('Bridge offline'); });
  await assert.rejects(runner.done, /Bridge offline/);
});


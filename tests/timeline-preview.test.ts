import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineRunner } from '../src/services/sequences';
import { createRestoringTimelinePreview, shouldRestoreHomePlayback, stateBeforePreview } from '../src/services/timeline-preview';
import type { HueLight, LightState, TimelineSequence } from '../src/types/hue';

const lamp = (id: string, changes: Partial<HueLight> = {}): HueLight => ({
  id, name: id, kind: 'color', on: true, brightness: 41, brightnessRaw: 105,
  colorCapable: true, colorTemperatureCapable: true, colorMode: 'ct', colorTemperatureMired: 333,
  hue: 25000, saturation: 150, xy: [0.24, 0.32], ...changes,
});
const timeline = (durationMs = 30): TimelineSequence => ({
  id: 'preview', name: 'Preview', groupId: 'group', durationMs,
  events: [{ id: 'event', lightId: 'a', atMs: 0, state: { on: true, brightness: 80 } }],
});

test('Home restores only if explicitly enabled; previews always restore regardless of the switch', async () => {
  assert.equal(shouldRestoreHomePlayback(), false);
  assert.equal(shouldRestoreHomePlayback(timeline()), false);
  assert.equal(shouldRestoreHomePlayback({ ...timeline(), restoreAfterPlayback: false }), false);
  assert.equal(shouldRestoreHomePlayback({ ...timeline(), restoreAfterPlayback: true }), true);
  for (const restoreAfterPlayback of [false, true]) {
    const calls: string[] = [];
    const preview = createRestoringTimelinePreview({ ...timeline(), restoreAfterPlayback }, async () => [lamp('a')], async (_id, state) => {
      calls.push(state.brightnessRaw !== undefined ? 'restore' : 'action');
    }, createTimelineRunner);
    await preview.done;
    assert.deepEqual(calls, ['action', 'restore']);
  }
});

test('preview preserves power, exact brightness and the active Hue color mode', () => {
  assert.deepEqual(stateBeforePreview(lamp('a')), { on: true, brightnessRaw: 105, colorTemperatureMired: 333, transitionTimeDeciseconds: 0 });
  assert.deepEqual(stateBeforePreview(lamp('a', { colorMode: 'xy' })).xy, [0.24, 0.32]);
  assert.deepEqual(stateBeforePreview(lamp('a', { colorMode: 'hs' })).hue, 25000);
  assert.deepEqual(stateBeforePreview(lamp('a', { on: false, kind: 'onoff-plug' })), { on: false, transitionTimeDeciseconds: 0 });
});

test('preview captures current bridge state, plays actions, then restores only touched lamps', async () => {
  const calls: { id: string; state: LightState }[] = [];
  let restoring = false;
  const preview = createRestoringTimelinePreview(timeline(), async () => [lamp('a'), lamp('untouched')],
    async (id, state) => { calls.push({ id, state }); }, createTimelineRunner, () => { restoring = true; });
  await preview.done;
  assert.equal(restoring, true);
  assert.deepEqual(calls.map(call => call.id), ['a', 'a']);
  assert.deepEqual(calls[0]?.state, { on: true, brightness: 80, transitionTimeDeciseconds: 0 });
  assert.deepEqual(calls[1]?.state, stateBeforePreview(lamp('a')));
});

test('preview retains action fade timing and restores instantly even after a faded Off action', async () => {
  const calls: LightState[] = [];
  const sequence = { ...timeline(), events: [{ ...timeline().events[0]!, state: { on: false, transitionTimeDeciseconds: 15 } }] };
  const preview = createRestoringTimelinePreview(sequence, async () => [lamp('a')], async (_id, state) => { calls.push(state); }, createTimelineRunner);
  await preview.done;
  assert.deepEqual(calls, [{ on: false, transitionTimeDeciseconds: 15 }, stateBeforePreview(lamp('a'))]);
});

test('stopping preview waits for in-flight lamp commands before restoring them', async () => {
  let releaseRequest: (() => void) | undefined;
  let startedRequest: (() => void) | undefined;
  const requestStarted = new Promise<void>(resolve => { startedRequest = resolve; });
  const inFlight = new Promise<void>(resolve => { releaseRequest = resolve; });
  const calls: string[] = [];
  const preview = createRestoringTimelinePreview(timeline(500), async () => [lamp('a', { on: false })], async (_id, state) => {
    calls.push(state.brightness === 80 ? 'action' : 'restore');
    if (state.brightness === 80) { startedRequest?.(); await inFlight; }
  }, createTimelineRunner);
  await requestStarted;
  preview.cancel();
  assert.deepEqual(calls, ['action']);
  releaseRequest?.();
  await preview.done;
  assert.deepEqual(calls, ['action', 'restore']);
});

test('preview attempts restoration even when an action fails', async () => {
  const calls: string[] = [];
  const preview = createRestoringTimelinePreview(timeline(400), async () => [lamp('a')], async (_id, state) => {
    calls.push(state.brightness === 80 ? 'action' : 'restore');
    if (state.brightness === 80) throw new Error('Bridge offline');
  }, createTimelineRunner);
  await assert.rejects(preview.done, /Bridge offline/);
  assert.deepEqual(calls, ['action', 'restore']);
});

test('a failed restore reports the error but still restores other affected lamps', async () => {
  const sequence: TimelineSequence = { ...timeline(), events: [timeline().events[0]!, { id: 'other', lightId: 'b', atMs: 0, state: { on: true } }] };
  const restored: string[] = [];
  const preview = createRestoringTimelinePreview(sequence, async () => [lamp('a'), lamp('b')], async (id, state) => {
    if (state.brightnessRaw !== undefined) {
      restored.push(id);
      if (id === 'a') throw new Error('Restore failed');
    }
  }, createTimelineRunner);
  await assert.rejects(preview.done, /Could not restore 1 lamp/);
  assert.deepEqual(restored.sort(), ['a', 'b']);
});



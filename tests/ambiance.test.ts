import assert from 'node:assert/strict';
import test from 'node:test';
import { createAmbiancePlayback, createRepeatingRunner, type AmbianceMode } from '../src/services/ambiance';
import { createSequenceRunner, createTimelineRunner } from '../src/services/sequences';
import { createRestoringTimelinePreview } from '../src/services/timeline-preview';
import type { HueLight, LightState, TimelineSequence } from '../src/types/hue';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function controlledRunner() {
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  return { done, cancel: () => finish(), finish };
}
const description = (lightIds = ['a', 'b']) => ({ sequenceId: 'candlelight', name: 'Candlelight', targetName: 'Living room', lightIds });

test('finite playback repeats, including audio-only timelines, until cancelled', async () => {
  const played: TimelineSequence[] = [];
  const sequence: TimelineSequence = {
    id: 'audio', name: 'Audio only', groupId: 'g', durationMs: 1, events: [],
    backgroundAudio: { id: 'clip', name: 'Clip', uri: 'file://example.wav', durationMs: 1, atMs: 0, volume: 1 },
  };
  let heard = 0;
  const runner = createRepeatingRunner(() => {
    played.push(sequence);
    return createTimelineRunner(sequence, async () => assert.fail('No light actions expected'), () => {
      heard++;
      if (heard === 3) runner.cancel();
    });
  });
  await runner.done;
  assert.equal(played.length, 3);
  assert.equal(heard, 3);
});

test('cancelling before startup does not create playback and failures do not restart a loop', async () => {
  let plays = 0;
  const cancelled = createRepeatingRunner(() => { plays++; return controlledRunner(); });
  cancelled.cancel();
  await cancelled.done;
  assert.equal(plays, 0);
  const failed = createRepeatingRunner(() => { plays++; return { done: Promise.reject(new Error('Bridge offline')), cancel: () => {} }; });
  await assert.rejects(failed.done, /Bridge offline/);
  assert.equal(plays, 1);
});

test('multiple modes run simultaneously, including overlapping lamps, and stop independently', async t => {
  const calls: string[] = [];
  let snapshot: AmbianceMode[] = [];
  const playback = createAmbiancePlayback(modes => { snapshot = modes; }, () => assert.fail('Unexpected playback error'));
  t.after(() => playback.dispose());
  const applies: ((id: string, state: LightState) => Promise<void>)[] = [];
  const play = (apply: (id: string, state: LightState) => Promise<void>) => { applies.push(apply); return controlledRunner(); };
  const one = playback.start(description(['a']), play, async id => { calls.push(`one:${id}`); });
  playback.start(description(['a', 'b']), play, async id => { calls.push(`two:${id}`); });
  await tick();
  await applies[0]!('a', { on: true });
  await applies[1]!('a', { on: false });
  await playback.stop(one);
  await applies[0]!('a', { on: true });
  await applies[1]!('b', { on: true });
  assert.deepEqual(calls, ['one:a', 'two:a', 'two:b']);
  assert.equal(snapshot.length, 1);
  assert.equal(playback.usesSequence('candlelight'), true);
  await playback.stopAll();
  assert.equal(snapshot.length, 0);
  assert.equal(playback.usesSequence('candlelight'), false);
});

test('foreground suppresses only affected lamps and immediately resumes their latest ambiance state', async t => {
  const calls: { id: string; state: LightState }[] = [];
  let snapshot: AmbianceMode[] = [];
  let apply!: (id: string, state: LightState) => Promise<void>;
  const playback = createAmbiancePlayback(modes => { snapshot = modes; }, () => assert.fail('Unexpected error'));
  t.after(() => playback.dispose());
  playback.start(description(), handler => { apply = handler; return controlledRunner(); }, async (id, state) => { calls.push({ id, state }); });
  await tick();
  await apply('a', { brightness: 10 });
  const home = controlledRunner();
  const foreground = playback.foreground(['a'], () => home);
  await tick();
  assert.deepEqual(snapshot[0]?.activeLightIds, ['b']);
  await apply('a', { brightness: 60 });
  await apply('a', { brightness: 70 });
  await apply('b', { brightness: 20 });
  assert.deepEqual(calls.map(call => [call.id, call.state.brightness]), [['a', 10], ['b', 20]]);
  home.finish();
  await foreground.done;
  assert.deepEqual(calls.map(call => [call.id, call.state.brightness]), [['a', 10], ['b', 20], ['a', 70]]);
  assert.deepEqual(snapshot[0]?.activeLightIds, ['a', 'b']);
});

test('foreground waits for already-sent ambiance commands; stop drains them and prevents resumption', async t => {
  const inFlight = controlledRunner();
  let apply!: (id: string, state: LightState) => Promise<void>;
  let sends = 0, startedHome = false, stopped = false;
  const playback = createAmbiancePlayback(() => {}, () => assert.fail('Unexpected error'));
  t.after(() => playback.dispose());
  const id = playback.start(description(['a']), handler => { apply = handler; return controlledRunner(); }, async () => {
    sends++;
    await inFlight.done;
  });
  await tick();
  const request = apply('a', { on: true });
  await tick();
  const home = controlledRunner();
  const foreground = playback.foreground(['a'], () => { startedHome = true; return home; });
  await tick();
  assert.equal(startedHome, false);
  const stopping = playback.stop(id).then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  inFlight.finish();
  await Promise.all([request, stopping]);
  await tick();
  assert.equal(startedHome, true);
  home.finish();
  await foreground.done;
  assert.equal(sends, 1);
});

test('resumption restores cumulative ambiance state while normal playback keeps partial actions unchanged', async t => {
  const calls: LightState[] = [];
  let apply!: (id: string, state: LightState) => Promise<void>;
  const playback = createAmbiancePlayback(() => {}, () => assert.fail('Unexpected error'));
  t.after(() => playback.dispose());
  playback.start(description(['a']), handler => { apply = handler; return controlledRunner(); }, async (_id, state) => { calls.push(state); });
  await tick();
  await apply('a', { on: true, hue: 50000, saturation: 200, brightness: 40 });
  await apply('a', { on: true, brightness: 25 });
  assert.deepEqual(calls[1], { on: true, brightness: 25 });
  const home = controlledRunner();
  const foreground = playback.foreground(['a'], () => home);
  await tick();
  await apply('a', { on: true, colorTemperature: 2200 });
  home.finish();
  await foreground.done;
  assert.deepEqual(calls[2], { on: true, brightness: 25, colorTemperature: 2200 });
  const nextHome = controlledRunner();
  const next = playback.foreground(['a'], () => nextHome);
  await tick();
  await apply('a', { on: true, hue: 6500, saturation: 254 });
  nextHome.finish();
  await next.done;
  assert.deepEqual(calls[3], { on: true, brightness: 25, hue: 6500, saturation: 254 });
});

test('cancelling foreground during acquisition skips Home playback and releases its lamps', async t => {
  const request = controlledRunner();
  let apply!: (id: string, state: LightState) => Promise<void>;
  let snapshot: AmbianceMode[] = [];
  const playback = createAmbiancePlayback(modes => { snapshot = modes; }, () => assert.fail('Unexpected error'));
  t.after(() => playback.dispose());
  playback.start(description(['a']), handler => { apply = handler; return controlledRunner(); }, async () => request.done);
  await tick();
  const pending = apply('a', { on: true });
  await tick();
  const home = playback.foreground(['a'], () => { assert.fail('Cancelled foreground must not start'); });
  home.cancel();
  request.finish();
  await Promise.all([pending, home.done]);
  assert.deepEqual(snapshot[0]?.activeLightIds, ['a']);
});

test('ambient modes started during foreground playback also yield and resume; nested reservations are independent', async t => {
  const calls: number[] = [];
  const playback = createAmbiancePlayback(() => {}, () => assert.fail('Unexpected error'));
  t.after(() => playback.dispose());
  const first = controlledRunner(), second = controlledRunner();
  const firstHome = playback.foreground(['a'], () => first);
  const secondHome = playback.foreground(['a'], () => second);
  let apply!: (id: string, state: LightState) => Promise<void>;
  playback.start(description(['a']), handler => { apply = handler; return controlledRunner(); }, async (_id, state) => { calls.push(state.brightness!); });
  await tick();
  await apply('a', { brightness: 25 });
  first.finish();
  await firstHome.done;
  assert.deepEqual(calls, []);
  second.finish();
  await secondHome.done;
  assert.deepEqual(calls, [25]);
});

test('Home retains priority through restoration, then ambiance resumes even after playback failure', async t => {
  const calls: string[] = [];
  const restoreGate = controlledRunner();
  const playback = createAmbiancePlayback(() => {}, () => assert.fail('Unexpected ambiance error'));
  t.after(() => playback.dispose());
  let apply!: (id: string, state: LightState) => Promise<void>;
  playback.start(description(['a']), handler => { apply = handler; return controlledRunner(); }, async () => { calls.push('ambiance'); });
  await tick();
  const lamp: HueLight = { id: 'a', name: 'A', on: true, brightness: 15, kind: 'dimmable', colorCapable: false, colorTemperatureCapable: false };
  const sequence: TimelineSequence = {
    id: 'home', name: 'Home', groupId: 'g', durationMs: 1,
    events: [{ id: 'event', atMs: 0, lightId: 'a', state: { on: true } }],
  };
  const foreground = playback.foreground(['a'], () => createRestoringTimelinePreview(sequence, async () => [lamp], async () => {
    calls.push('restore');
    await restoreGate.done;
  }, () => ({ done: Promise.reject(new Error('Home failed')), cancel: () => {} })));
  const rejected = assert.rejects(foreground.done, /Home failed/);
  await tick();
  await apply('a', { brightness: 50 });
  assert.deepEqual(calls, ['restore']);
  restoreGate.finish();
  await rejected;
  assert.deepEqual(calls, ['restore', 'ambiance']);
});

test('failure stops only the failed mode and surfaces errors without retry loops', async t => {
  const errors: string[] = [];
  let snapshot: AmbianceMode[] = [];
  const playback = createAmbiancePlayback(modes => { snapshot = modes; }, (name, error) => { errors.push(`${name}: ${String(error)}`); });
  t.after(() => playback.dispose());
  playback.start(description(['b']), () => controlledRunner(), async () => {});
  playback.start(description(['a']), apply => createSequenceRunner({
    id: 'test', name: 'Test', lightIds: ['a'], steps: [{ id: 'one', label: 'One', durationMs: 0, state: { on: true } }],
  }, async (ids, state) => apply(ids[0]!, state)), async () => { throw new Error('Bridge offline'); });
  await tick();
  await tick();
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /Bridge offline/);
  assert.equal(snapshot.length, 1);
  assert.deepEqual(snapshot[0]?.lightIds, ['b']);
});

test('resume errors are visible and stop a mode; disposal prevents later foreground resumption', async () => {
  let apply!: (id: string, state: LightState) => Promise<void>;
  let errors = 0, sends = 0;
  const playback = createAmbiancePlayback(() => {}, () => { errors++; });
  playback.start(description(['a']), handler => { apply = handler; return controlledRunner(); }, async () => { sends++; throw new Error('Resume failed'); });
  const home = controlledRunner();
  const foreground = playback.foreground(['a'], () => home);
  await tick();
  await apply('a', { on: true });
  home.finish();
  await foreground.done;
  await tick();
  assert.equal(errors, 1);
  assert.equal(sends, 1);
  const secondHome = controlledRunner();
  const second = playback.foreground(['a'], () => secondHome);
  playback.start(description(['a']), handler => { apply = handler; return controlledRunner(); }, async () => { sends++; });
  await tick();
  await apply('a', { on: true });
  playback.dispose();
  secondHome.finish();
  await second.done;
  assert.equal(sends, 1);
});

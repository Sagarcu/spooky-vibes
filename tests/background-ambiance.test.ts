import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backgroundAmbianceRequest, createBackgroundAmbiancePlayback,
  type BackgroundAmbiancePort, type BackgroundSnapshot,
} from '../src/services/background-ambiance';
import { createPlatformAmbiancePlayback } from '../src/services/ambiance-platform';
import type { AmbianceMode } from '../src/services/ambiance';
import type { HueLight, TimelineSequence } from '../src/types/hue';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const credentials = { bridgeIp: 'bridge.local', username: 'placeholder' };
const description = { sequenceId: 'saved', name: 'Saved mood', targetName: 'Room', lightIds: ['1', '2', '1'] };
const lamp: HueLight = {
  id: '1', name: 'Color', on: true, brightness: 50, kind: 'color',
  colorCapable: true, colorTemperatureCapable: true,
};
const white: HueLight = { ...lamp, id: '2', kind: 'dimmable', colorCapable: false, colorTemperatureCapable: false };
const mode: AmbianceMode = { ...description, id: 'native-mode', lightIds: ['1', '2'], activeLightIds: ['1', '2'], stopping: false };
const request = backgroundAmbianceRequest({ ...description, sequenceId: 'candlelight' }, credentials, [lamp, white]);
const noPlay = () => assert.fail('Android must not start a UI-owned runner');
const noApply = async () => assert.fail('Android must not send Hue requests from JavaScript');

function nativePort() {
  let listener: ((event: { snapshot: string }) => void) | undefined;
  let snapshot: BackgroundSnapshot = { revision: 0, modes: [], errors: [] };
  const calls: string[] = [];
  let received: string | undefined;
  const port: BackgroundAmbiancePort = {
    requestNotificationPermission: async () => ({ granted: true }),
    start: async json => { received = json; calls.push('start'); return 'native-mode'; },
    stop: async id => { calls.push(`stop:${id}`); },
    stopAll: async () => { calls.push('stopAll'); },
    reserve: async token => { calls.push(`reserve:${token}`); },
    release: async token => { calls.push(`release:${token}`); },
    getSnapshot: async () => JSON.stringify(snapshot),
    addListener: (_, handler) => {
      listener = handler;
      return { remove: () => { listener = undefined; calls.push('unsubscribe'); } };
    },
  };
  return {
    port, calls, received: () => received,
    update: (next: BackgroundSnapshot) => { snapshot = next; listener?.({ snapshot: JSON.stringify(next) }); },
  };
}

test('native request captures targets, capabilities, timeline times, audio and supported Hue states', () => {
  const sequence: TimelineSequence = {
    id: 'saved', name: 'Saved mood', groupId: 'g', durationMs: 1000, restoreAfterPlayback: true,
    events: [
      { id: 'later', lightId: '2', atMs: 500, state: { on: true, brightness: 50, colorTemperature: 2200 } },
      { id: 'first', lightId: '1', atMs: 0, state: { on: true, hue: 65000, saturation: 254, transitionTimeDeciseconds: 3 } },
    ],
    backgroundAudio: { id: 'bg', uri: 'file://background.wav', name: 'Background', atMs: 0, durationMs: 2000, volume: 0.4 },
    audioEffects: [{ id: 'fx', uri: 'file://effect.wav', name: 'Effect', atMs: 250, durationMs: 100, volume: 1 }],
  };
  const payload = backgroundAmbianceRequest(description, credentials, [lamp, white, { ...lamp, id: '3' }], sequence);
  assert.deepEqual(payload.description.lightIds, ['1', '2']);
  assert.deepEqual(payload.lights.map(light => light.id), ['1', '2']);
  assert.deepEqual(payload.timeline?.events, [
    { lightId: '1', atMs: 0, state: { on: true, hue: 65000, sat: 254, transitiontime: 3 } },
    { lightId: '2', atMs: 500, state: { on: true, bri: 127, transitiontime: 0 } },
  ]);
  assert.deepEqual(payload.timeline?.audio, [sequence.backgroundAudio, ...sequence.audioEffects!]);
  assert.equal('restoreAfterPlayback' in payload.timeline!, false);
  assert.equal(sequence.events[0]?.id, 'later');
});

test('audio-only timelines remain repeatable native requests and built-ins do not invent audio', () => {
  const sequence: TimelineSequence = {
    id: 'audio', name: 'Audio', groupId: 'g', durationMs: 1000, events: [],
    audioEffects: [{ id: 'fx', uri: 'file://effect.wav', name: 'Effect', atMs: 500, durationMs: 100, volume: 0 }],
  };
  assert.equal(backgroundAmbianceRequest(description, credentials, [lamp, white], sequence).timeline?.audio.length, 1);
  assert.equal(request.timeline, undefined);
});

test('native start forwards the request without JS playback and denied permissions fail explicitly', async () => {
  const native = nativePort();
  const playback = createBackgroundAmbiancePlayback(() => native.port, () => {}, () => assert.fail('Unexpected error'));
  assert.equal(await playback.start(request, noPlay, noApply), 'native-mode');
  assert.deepEqual(JSON.parse(native.received()!), JSON.parse(JSON.stringify(request)));
  native.port.requestNotificationPermission = async () => ({ granted: false });
  await assert.rejects(playback.start(request, noPlay, noApply), /Allow notifications/);
  assert.deepEqual(native.calls, ['start']);
  native.port.requestNotificationPermission = async () => ({ granted: true });
  native.port.start = async () => { throw new Error('Battery optimization must be disabled'); };
  await assert.rejects(playback.start(request, noPlay, noApply), /Battery optimization/);
});

test('reconnect recovers live modes and background errors, rejects stale snapshots and does not stop service on disposal', async () => {
  const native = nativePort();
  const initial = deferred<string>();
  native.port.getSnapshot = () => initial.promise;
  let modes: AmbianceMode[] = [];
  const errors: string[] = [];
  const playback = createBackgroundAmbiancePlayback(() => native.port, next => { modes = next; },
    (name, error) => errors.push(`${name}: ${error instanceof Error ? error.message : error}`));
  playback.attach();
  const snapshot = { revision: 2, modes: [mode], errors: [{ id: 'error-1', name: 'Storm', message: 'Bridge offline' }] };
  native.update(snapshot);
  initial.resolve(JSON.stringify({ revision: 1, modes: [], errors: [] }));
  await tick();
  assert.deepEqual(modes, [mode]);
  native.update(snapshot);
  assert.deepEqual(errors, ['Storm: Bridge offline']);
  playback.dispose();
  assert.deepEqual(native.calls, ['unsubscribe']);
  native.update({ revision: 3, modes: [], errors: [] });
  assert.deepEqual(modes, [mode]);
  native.port.getSnapshot = async () => JSON.stringify({ ...snapshot, revision: 4 });
  playback.attach();
  await tick();
  assert.deepEqual(modes, [mode]);
  assert.deepEqual(errors, ['Storm: Bridge offline']);
  playback.dispose();
});

test('timeline save/delete guards query native state even before the initial subscription snapshot arrives', async () => {
  const native = nativePort();
  native.update({ revision: 1, modes: [mode], errors: [] });
  const playback = createBackgroundAmbiancePlayback(() => native.port, () => {}, () => {});
  assert.equal(await playback.usesSequence('saved'), true);
  assert.equal(await playback.usesSequence('another'), false);
  await playback.stop(mode.id);
  await playback.stopAll();
  assert.deepEqual(native.calls, ['stop:native-mode', 'stopAll']);
});

test('Home waits for the native reservation barrier and releases it after success, failure or cancellation', async () => {
  for (const outcome of ['finish', 'fail', 'cancel'] as const) {
    const native = nativePort();
    const barrier = deferred<void>();
    let acquired = '';
    let released = '';
    native.port.reserve = async token => { acquired = token; await barrier.promise; };
    native.port.release = async token => { released = token; };
    let started = false;
    let cancelled = false;
    const active = deferred<void>();
    const playback = createBackgroundAmbiancePlayback(() => native.port, () => {}, () => {});
    const home = playback.foreground(['1'], () => {
      started = true;
      return { done: active.promise, cancel: () => { cancelled = true; active.resolve(); } };
    });
    assert.equal(started, false);
    if (outcome === 'cancel') home.cancel();
    barrier.resolve();
    await tick();
    assert.equal(started, outcome !== 'cancel');
    if (outcome === 'fail') {
      active.reject(new Error('Home failed'));
      await assert.rejects(home.done, /Home failed/);
    } else {
      active.resolve();
      await home.done;
    }
    assert.ok(acquired);
    assert.equal(released, acquired);
    assert.equal(cancelled, false);
  }
});

test('native reservation failures prevent Home from starting and still release their token', async () => {
  const native = nativePort();
  native.port.reserve = async () => { throw new Error('Could not reserve lamps'); };
  const playback = createBackgroundAmbiancePlayback(() => native.port, () => {}, () => {});
  await assert.rejects(playback.foreground(['1'], noPlay).done, /Could not reserve/);
  assert.ok(native.calls[0]?.startsWith('release:'));
});

test('cancelling active Home playback forwards cancellation and waits before releasing its lamps', async () => {
  const native = nativePort();
  const active = deferred<void>();
  const playback = createBackgroundAmbiancePlayback(() => native.port, () => {}, () => {});
  let cancelled = false;
  const home = playback.foreground(['1'], () => ({
    done: active.promise, cancel: () => { cancelled = true; },
  }));
  await tick();
  home.cancel();
  assert.equal(cancelled, true);
  assert.equal(native.calls.length, 1);
  active.resolve();
  await home.done;
  assert.equal(native.calls.length, 2);
  assert.equal(native.calls[1]?.replace('release:', ''), native.calls[0]?.replace('reserve:', ''));
});

test('service sync and stop failures remain visible rather than reporting success', async () => {
  const native = nativePort();
  native.port.getSnapshot = async () => { throw new Error('Service unavailable'); };
  native.port.stopAll = async () => { throw new Error('Could not stop service'); };
  const errors: unknown[] = [];
  const playback = createBackgroundAmbiancePlayback(() => native.port, () => {}, (_, error) => errors.push(error));
  playback.attach();
  await tick();
  assert.match((errors[0] as Error).message, /Service unavailable/);
  await assert.rejects(playback.usesSequence('saved'), /Service unavailable/);
  await assert.rejects(playback.stopAll(), /Could not stop service/);
  playback.dispose();
});

test('Expo Go fails Android ambiance explicitly but retains Home and no-op stop-all support', async () => {
  const playback = createBackgroundAmbiancePlayback(() => null, () => {}, () => assert.fail('Unexpected error'));
  playback.attach();
  await assert.rejects(playback.start(request, noPlay, noApply), /custom Spooky Vibes build/);
  let played = false;
  await playback.foreground(['1'], () => { played = true; return { done: Promise.resolve(), cancel: () => {} }; }).done;
  assert.equal(played, true);
  assert.equal(await playback.usesSequence('saved'), false);
  await playback.stopAll();
  playback.dispose();
});

test('non-Android facade preserves local ambiance and its timeline mutation guards', async () => {
  let modes: AmbianceMode[] = [];
  const playback = createPlatformAmbiancePlayback(next => { modes = next; }, () => assert.fail('Unexpected error'));
  const done = deferred<void>();
  playback.attach();
  const id = await playback.start(request, () => ({ done: done.promise, cancel: () => done.resolve() }), async () => {});
  assert.equal(modes.length, 1);
  assert.equal(await playback.usesSequence('candlelight'), true);
  await playback.stop(id);
  assert.equal(modes.length, 0);
  playback.dispose();
});

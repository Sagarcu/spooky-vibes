import type { LightState } from '../types/hue';
import type { SequenceRunner } from './sequences';

type ApplyState = (lightId: string, state: LightState) => Promise<void>;
type Play = (apply: ApplyState) => SequenceRunner;

export type AmbianceMode = {
  id: string;
  configurationId?: string;
  sequenceId: string;
  name: string;
  targetName: string;
  lightIds: string[];
  activeLightIds: string[];
  stopping: boolean;
};

type Mode = Omit<AmbianceMode, 'activeLightIds'> & {
  apply: ApplyState;
  desired: Map<string, LightState>;
  pending: Map<string, Set<Promise<void>>>;
  runner: SequenceRunner;
  done: Promise<void>;
  failed: boolean;
};

function stateAfter(previous: LightState | undefined, state: LightState): LightState {
  const next = { ...previous, ...state };
  if (state.brightness !== undefined) delete next.brightnessRaw;
  if (state.brightnessRaw !== undefined) delete next.brightness;
  if (state.hue !== undefined || state.saturation !== undefined || state.xy !== undefined) {
    delete next.colorTemperature;
    delete next.colorTemperatureMired;
    if (state.xy !== undefined) { delete next.hue; delete next.saturation; }
    else delete next.xy;
  }
  if (state.colorTemperature !== undefined || state.colorTemperatureMired !== undefined) {
    delete next.hue;
    delete next.saturation;
    delete next.xy;
    if (state.colorTemperature !== undefined) delete next.colorTemperatureMired;
    else delete next.colorTemperature;
  }
  return next;
}

export function createRepeatingRunner(play: () => SequenceRunner): SequenceRunner {
  let cancelled = false;
  let active: SequenceRunner | undefined;
  const done = (async () => {
    // Let the owner register the runner before playback starts.
    await Promise.resolve();
    while (!cancelled) {
      active = play();
      await active.done;
    }
  })();
  return { done, cancel: () => { cancelled = true; active?.cancel(); } };
}

export function createAmbiancePlayback(onChange: (modes: AmbianceMode[]) => void, onError: (name: string, error: unknown) => void) {
  const modes = new Map<string, Mode>();
  const reservations = new Map<symbol, Set<string>>();
  let nextId = 0;
  let disposed = false;
  const blocked = (id: string) => [...reservations.values()].some(ids => ids.has(id));
  const snapshot = () => [...modes.values()].map(mode => ({
      id: mode.id, sequenceId: mode.sequenceId, name: mode.name, targetName: mode.targetName,
      configurationId: mode.configurationId,
      lightIds: mode.lightIds, activeLightIds: mode.lightIds.filter(id => !blocked(id)), stopping: mode.stopping,
    }));
  const publish = () => {
    if (!disposed) onChange(snapshot());
  };
  const fail = (mode: Mode, error: unknown) => {
    if (mode.failed) return;
    mode.failed = true;
    mode.stopping = true;
    mode.runner.cancel();
    if (!disposed) onError(mode.name, error);
    publish();
  };
  const send = async (mode: Mode, id: string, state: LightState, resume = false): Promise<void> => {
    if (mode.stopping || blocked(id)) return;
    let pending = mode.pending.get(id);
    if (!pending) { pending = new Set(); mode.pending.set(id, pending); }
    const previous = [...pending];
    const request = (async () => {
      await Promise.allSettled(previous);
      if (!mode.stopping && !blocked(id) && (!resume || mode.desired.get(id) === state)) await mode.apply(id, state);
    })();
    pending.add(request);
    try { await request; }
    finally { pending.delete(request); }
  };
  const pendingFor = (ids: Set<string>) => [...modes.values()].flatMap(mode =>
    [...mode.pending].filter(([id]) => ids.has(id)).flatMap(([, pending]) => [...pending]));

  const start = (description: Pick<AmbianceMode, 'sequenceId' | 'name' | 'targetName' | 'lightIds' | 'configurationId'>, play: Play, apply: ApplyState) => {
    if (disposed) throw new Error('Ambiance playback is no longer available.');
    const id = `ambiance-${++nextId}`;
    const runner = createRepeatingRunner(() => play(async (lightId, state) => {
      mode.desired.set(lightId, stateAfter(mode.desired.get(lightId), state));
      await send(mode, lightId, state);
    }));
    const mode: Mode = {
      ...description, lightIds: [...new Set(description.lightIds)], id, stopping: false, failed: false,
      desired: new Map(), pending: new Map(), apply, runner, done: Promise.resolve(),
    };
    modes.set(id, mode);
    mode.done = (async () => {
      try { await runner.done; }
      catch (error) { fail(mode, error); }
      finally {
        await Promise.allSettled([...mode.pending.values()].flatMap(pending => [...pending]));
        modes.delete(id);
        publish();
      }
    })();
    publish();
    return id;
  };
  const stop = async (id: string) => {
    const mode = modes.get(id);
    if (!mode) return;
    mode.stopping = true;
    mode.runner.cancel();
    publish();
    await mode.done;
  };
  const stopAll = async () => { await Promise.all([...modes.keys()].map(stop)); };
  const foreground = (lightIds: string[], play: () => SequenceRunner): SequenceRunner => {
    const token = Symbol('foreground');
    const ids = new Set(lightIds);
    reservations.set(token, ids);
    publish();
    let cancelled = false;
    let active: SequenceRunner | undefined;
    const done = (async () => {
      try {
        // Reserve first, then drain requests already sent before giving Home control.
        await Promise.allSettled(pendingFor(ids));
        if (!cancelled) { active = play(); await active.done; }
      } finally {
        reservations.delete(token);
        publish();
        await Promise.all([...modes.values()].flatMap(mode => [...mode.desired]
          .filter(([id]) => ids.has(id) && !blocked(id))
          .map(async ([id, state]) => {
            try { await send(mode, id, state, true); }
            catch (error) { fail(mode, error); }
          })));
      }
    })();
    return { done, cancel: () => { cancelled = true; active?.cancel(); } };
  };
  return {
    start, stop, stopAll, foreground,
    getModes: async () => snapshot(),
    usesSequence: (id: string) => [...modes.values()].some(mode => mode.sequenceId === id),
    dispose: () => { disposed = true; void stopAll(); },
  };
}

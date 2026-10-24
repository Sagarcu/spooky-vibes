import type { HueLight, LightState, TimelineSequence } from '../types/hue';
import type { SequenceRunner } from './sequences';

/** Legacy sequences and the built-in presets keep their final state unless explicitly opted in. */
export const shouldRestoreHomePlayback = (sequence?: TimelineSequence): boolean => sequence?.restoreAfterPlayback === true;

/** Capture only fields supported by this lamp and preserve the active Hue color mode. */
export function stateBeforePreview(light: HueLight): LightState {
  const state: LightState = { on: light.on, transitionTimeDeciseconds: 0 };
  if (light.kind === 'onoff-plug') return state;
  if (light.brightnessRaw !== undefined) state.brightnessRaw = light.brightnessRaw;
  else state.brightness = light.brightness;
  if (light.colorMode === 'ct' && light.colorTemperatureCapable && light.colorTemperatureMired !== undefined) {
    state.colorTemperatureMired = light.colorTemperatureMired;
  } else if (light.colorCapable && light.colorMode === 'xy' && light.xy) {
    state.xy = light.xy;
  } else if (light.colorCapable && light.hue !== undefined && light.saturation !== undefined) {
    state.hue = light.hue;
    state.saturation = light.saturation;
  } else if (light.colorTemperatureCapable && light.colorTemperatureMired !== undefined) {
    state.colorTemperatureMired = light.colorTemperatureMired;
  }
  return state;
}

export function createRestoringTimelinePreview(
  sequence: TimelineSequence,
  captureLights: () => Promise<HueLight[]>,
  apply: (lightId: string, state: LightState) => Promise<void>,
  play: (sequence: TimelineSequence, apply: (lightId: string, state: LightState) => Promise<void>) => SequenceRunner,
  onRestoring?: () => void,
): SequenceRunner {
  let cancelled = false;
  let active: SequenceRunner | undefined;
  const done = (async () => {
    const affectedIds = [...new Set(sequence.events.map(event => event.lightId))];
    const before = affectedIds.length ? await captureLights() : [];
    if (cancelled) return;
    const originals = affectedIds.map(id => {
      const lamp = before.find(item => item.id === id);
      if (!lamp) throw new Error('A timeline lamp is unavailable. Restore it before previewing.');
      return lamp;
    });

    let playbackError: unknown;
    try {
      active = play(sequence, apply);
      await active.done;
    } catch (error) { playbackError = error; }

    // A Hue request already in flight may finish after Stop. The runner's done
    // promise settles those requests before we send the original state back.
    onRestoring?.();
    const outcomes = await Promise.allSettled(originals.map(lamp => apply(lamp.id, stateBeforePreview(lamp))));
    const restoreErrors = outcomes.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason);
    if (restoreErrors.length) throw new AggregateError(playbackError ? [playbackError, ...restoreErrors] : restoreErrors, `Could not restore ${restoreErrors.length} lamp(s). Refresh the lamps and check the Hue Bridge.`);
    if (playbackError) throw playbackError;
  })();
  return { done, cancel: () => { cancelled = true; active?.cancel(); } };
}


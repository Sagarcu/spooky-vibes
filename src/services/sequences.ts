import type { HueLight, LightState, LightingSequence, SequenceStep, TimelineAudioClip, TimelineEvent, TimelineSequence } from '../types/hue';
import { defaultAmbianceSettings, isAmbianceSettings, type AmbianceColor, type AmbianceEffectSettings } from './ambiance-settings';
import { isWhiteOnlyLight, supportedLightState } from './hue-state';

export type SequenceRunner = {
  done: Promise<void>;
  cancel: () => void;
};

type ApplyState = (lightIds: string[], state: LightState, step: SequenceStep) => Promise<void>;

function colorState(color: AmbianceColor): LightState {
  return color.mode === 'keep' ? {} : color.mode === 'white' ? { colorTemperature: color.temperature } : { hue: color.hue, saturation: color.saturation };
}

export function createCandlelightStep(previousStep?: SequenceStep, random = Math.random, settings = defaultAmbianceSettings('candlelight')): SequenceStep {
  const { minBrightness, maxBrightness } = settings;
  const target = minBrightness + Math.floor(random() * (maxBrightness - minBrightness + 1));
  const brightness = Math.max(minBrightness, Math.min(maxBrightness, Math.round(target * 0.85 + (previousStep?.state.brightness ?? target) * 0.15)));
  const durationMs = 600 + Math.floor(random() * 1401);
  const transitionTimeDeciseconds = 2 + Math.floor(random() * Math.min(7, Math.floor(durationMs / 100) - 1));
  return {
    id: 'flicker', label: 'Candle flicker',
    durationMs,
    state: { on: true, brightness, ...colorState(settings.color), transitionTimeDeciseconds },
  };
}

export const candlelight: LightingSequence = {
  id: 'candlelight',
  name: 'Candlelight',
  lightIds: [],
  steps: [],
  nextStep: createCandlelightStep,
};

export function createHalloweenStormStep(previousStep?: SequenceStep, random = Math.random, settings = defaultAmbianceSettings('halloween-storm')): SequenceStep {
  if (previousStep?.id === 'storm-quiet') {
    return {
      id: 'storm-burst', label: 'Lightning',
      durationMs: 1000 + Math.floor(random() * 2001),
      state: { on: true, brightness: settings.minBrightness + Math.floor(random() * (settings.maxBrightness - settings.minBrightness + 1)), ...colorState(settings.color), transitionTimeDeciseconds: 0 },
    };
  }
  const glow = random() >= 0.55;
  return {
    id: 'storm-quiet', label: glow ? 'Faint glow' : 'Darkness',
    durationMs: 4000 + Math.floor(random() * 14001),
    state: glow
      ? { on: true, brightness: 1, ...colorState(settings.glowColor), transitionTimeDeciseconds: 4 }
      : { on: false, transitionTimeDeciseconds: 4 },
  };
}

export const halloweenStorm: LightingSequence = {
  id: 'halloween-storm',
  name: 'Halloween storm',
  lightIds: [],
  steps: [],
  nextStep: createHalloweenStormStep,
};

export const builtInSequences = [candlelight, halloweenStorm];

export function configuredAmbianceSequence(sequenceId: string, settings: AmbianceEffectSettings): LightingSequence {
  if (!isAmbianceSettings(settings)) throw new Error('Use valid ambiance brightness limits and colors.');
  const sequence = builtInSequences.find(item => item.id === sequenceId);
  if (!sequence) throw new Error('Choose an available ambiance effect.');
  return {
    ...sequence,
    nextStep: previous => sequenceId === candlelight.id
      ? createCandlelightStep(previous, Math.random, settings)
      : createHalloweenStormStep(previous, Math.random, settings),
  };
}

export function ambianceLightState(sequenceId: string, light: HueLight, step: SequenceStep, settings?: AmbianceEffectSettings): LightState {
  if (light.kind === 'onoff-plug') return { on: sequenceId === candlelight.id || step.id === 'storm-burst' };
  const state = { ...step.state };
  if (!light.colorCapable) {
    delete state.colorTemperature;
    delete state.hue;
    delete state.saturation;
    const white = sequenceId === halloweenStorm.id && step.id === 'storm-quiet' ? settings?.glowWhiteColor : settings?.whiteColor;
    if (state.on && isWhiteOnlyLight(light) && white?.mode === 'white') state.colorTemperature = white.temperature;
  }
  return supportedLightState(light, state);
}

export function createSequenceRunner(sequence: LightingSequence, applyState: ApplyState): SequenceRunner {
  let cancelled = false;
  let activeTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveSleep: (() => void) | undefined;

  const sleep = (durationMs: number): Promise<void> => new Promise((resolve) => {
    resolveSleep = resolve;
    activeTimer = setTimeout(() => {
      activeTimer = undefined;
      resolveSleep = undefined;
      resolve();
    }, durationMs);
  });

  const done = (async () => {
    if (sequence.lightIds.length === 0 || (!sequence.nextStep && sequence.steps.length === 0)) return;
    let previousStep: SequenceStep | undefined;
    for (let index = 0; !cancelled && (sequence.nextStep || index < sequence.steps.length); index++) {
      const step = sequence.nextStep ? sequence.nextStep(previousStep) : sequence.steps[index];
      if (!step) break;
      const sentAt = Date.now();
      await applyState(sequence.lightIds, step.state, step);
      if (cancelled) return;
      previousStep = step;
      const elapsed = sequence.nextStep ? Date.now() - sentAt : 0;
      await sleep(Math.max(0, step.durationMs - elapsed));
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      if (activeTimer !== undefined) clearTimeout(activeTimer);
      activeTimer = undefined;
      resolveSleep?.();
      resolveSleep = undefined;
    },
  };
}

export function isValidTimelineState(value: unknown): value is TimelineEvent['state'] {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  if (typeof state.on !== 'boolean') return false;
  if (state.brightness !== undefined && (typeof state.brightness !== 'number' || !Number.isInteger(state.brightness) || state.brightness < 1 || state.brightness > 100)) return false;
  if (state.transitionTimeDeciseconds !== undefined && (typeof state.transitionTimeDeciseconds !== 'number' || !Number.isInteger(state.transitionTimeDeciseconds) || state.transitionTimeDeciseconds < 0 || state.transitionTimeDeciseconds > 100)) return false;
  if (state.hue !== undefined && (typeof state.hue !== 'number' || !Number.isInteger(state.hue) || state.hue < 0 || state.hue > 65535)) return false;
  if (state.saturation !== undefined && (typeof state.saturation !== 'number' || !Number.isInteger(state.saturation) || state.saturation < 0 || state.saturation > 254)) return false;
  if (state.colorTemperature !== undefined && (typeof state.colorTemperature !== 'number' || !Number.isInteger(state.colorTemperature) || state.colorTemperature < 2000 || state.colorTemperature > 6500)) return false;
  if (state.hue !== undefined !== (state.saturation !== undefined) || (state.colorTemperature !== undefined && state.hue !== undefined)) return false;
  return state.on || (state.brightness === undefined && state.hue === undefined && state.colorTemperature === undefined);
}

export function isValidAudioClip(value: unknown, durationMs: number): value is TimelineAudioClip {
  if (!value || typeof value !== 'object') return false;
  const clip = value as Partial<TimelineAudioClip>;
  return typeof clip.id === 'string' && !!clip.id && typeof clip.uri === 'string' && clip.uri.startsWith('file://') &&
    typeof clip.name === 'string' && !!clip.name.trim() && Number.isInteger(clip.atMs) && clip.atMs! >= 0 && clip.atMs! < durationMs &&
    Number.isInteger(clip.durationMs) && clip.durationMs! > 0 && Number.isFinite(clip.volume) && clip.volume! >= 0 && clip.volume! <= 1;
}

export function validateTimeline(sequence: TimelineSequence, lightIds: string[], lights: HueLight[] = []): TimelineSequence {
  const name = sequence.name.trim();
  if (!name || name.length > 60) throw new Error('Enter a sequence name (up to 60 characters).');
  if (!sequence.groupId || !lightIds.length) throw new Error('Choose a group with lamps.');
  if (!Number.isInteger(sequence.durationMs) || sequence.durationMs < 1_000 || sequence.durationMs > 120_000) throw new Error('Duration must be between 1 and 120 seconds.');
  if (sequence.restoreAfterPlayback !== undefined && typeof sequence.restoreAfterPlayback !== 'boolean') throw new Error('Restore-after-playback must be enabled or disabled.');
  if ((!sequence.events.length && !sequence.backgroundAudio && !sequence.audioEffects?.length) || sequence.events.length > 500) throw new Error('Add 1 to 500 timeline actions or an audio clip.');
  if (sequence.backgroundAudio !== undefined && !isValidAudioClip(sequence.backgroundAudio, sequence.durationMs) ||
    !Array.isArray(sequence.audioEffects ?? []) || (sequence.audioEffects?.length ?? 0) > 100 ||
    sequence.audioEffects?.some(clip => !isValidAudioClip(clip, sequence.durationMs))) throw new Error('An audio clip has an invalid file, start time, duration, or volume.');
  const audio = [...(sequence.backgroundAudio ? [sequence.backgroundAudio] : []), ...(sequence.audioEffects ?? [])];
  if (new Set(audio.map(clip => clip.id)).size !== audio.length) throw new Error('Audio clips must have unique IDs.');
  for (const event of sequence.events) {
    if (!event.id || !lightIds.includes(event.lightId) || !Number.isInteger(event.atMs) || event.atMs < 0 || event.atMs >= sequence.durationMs || !isValidTimelineState(event.state)) throw new Error('An action has an invalid lamp, time, color, brightness, or transition.');
    const lamp = lights.find(item => item.id === event.lightId);
    if (lamp && ((event.state.brightness !== undefined || event.state.transitionTimeDeciseconds !== undefined) && lamp.kind === 'onoff-plug' ||
      event.state.hue !== undefined && !lamp.colorCapable ||
      event.state.colorTemperature !== undefined && !lamp.colorTemperatureCapable)) throw new Error(`${lamp.name} does not support this action.`);
  }
  if (new Set(sequence.events.map(event => `${event.lightId}:${event.atMs}`)).size !== sequence.events.length) throw new Error('Only one action per lamp at each time is allowed.');
  return { ...sequence, name, events: [...sequence.events].sort((a, b) => a.atMs - b.atMs) };
}

export function createTimelineRunner(sequence: TimelineSequence, apply: (lightId: string, state: LightState) => Promise<void>, playAudio?: (clip: TimelineAudioClip) => void): SequenceRunner {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const wait = (ms: number) => new Promise<void>(resolve => {
    wake = resolve;
    timer = setTimeout(() => { timer = undefined; wake = undefined; resolve(); }, ms);
  });
  const started = Date.now();
  const done = (async () => {
    const events = [
      ...sequence.events.map(event => ({ atMs: event.atMs, light: event, audio: undefined as TimelineAudioClip | undefined })),
      ...(sequence.backgroundAudio ? [sequence.backgroundAudio] : []), ...(sequence.audioEffects ?? []),
    ].map(item => 'light' in item ? item : { atMs: item.atMs, light: undefined as TimelineEvent | undefined, audio: item }).sort((a, b) => a.atMs - b.atMs);
    const pending: Promise<void>[] = [];
    let failure: unknown;
    try {
      for (let i = 0; i < events.length && !cancelled && !failure;) {
        const atMs = events[i]!.atMs;
        if (atMs >= sequence.durationMs) break;
        await wait(Math.max(0, started + atMs - Date.now()));
        if (cancelled || failure) break;
        const batch: typeof events = [];
        while (i < events.length && events[i]!.atMs === atMs) batch.push(events[i++]!);
        for (const event of batch) {
          if (event.audio) playAudio?.(event.audio);
          if (event.light) pending.push(Promise.resolve().then(() => { if (!cancelled) return apply(event.light!.lightId, { ...event.light!.state, transitionTimeDeciseconds: event.light!.state.transitionTimeDeciseconds ?? 0 }); }).catch(error => {
            failure ??= error;
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            wake?.();
            wake = undefined;
          }));
        }
      }
      if (!cancelled && !failure) await wait(Math.max(0, started + sequence.durationMs - Date.now()));
    } finally { await Promise.all(pending); }
    if (!cancelled && failure) throw failure;
  })();
  return { done, cancel: () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    wake?.();
    wake = undefined;
  } };
}

import type { AmbianceMode } from './ambiance';
import { hueStateBody, supportedLightState } from './hue-state';
import type { SequenceRunner } from './sequences';
import type { HueCredentials, HueLight, LightState, TimelineSequence } from '../types/hue';
import type { AmbianceEffectSettings } from './ambiance-settings';

export type AmbianceDescription = Pick<AmbianceMode, 'sequenceId' | 'name' | 'targetName' | 'lightIds' | 'configurationId'>;
export type BackgroundAmbianceRequest = {
  description: AmbianceDescription;
  credentials: HueCredentials;
  lights: Pick<HueLight, 'id' | 'kind' | 'colorCapable' | 'colorTemperatureCapable'>[];
  settings?: AmbianceEffectSettings;
  timeline?: {
    durationMs: number;
    events: { lightId: string; atMs: number; state: ReturnType<typeof hueStateBody> }[];
    audio: NonNullable<TimelineSequence['audioEffects']>;
  };
};

export function backgroundAmbianceRequest(
  description: AmbianceDescription, credentials: HueCredentials, lights: HueLight[], timeline?: TimelineSequence, settings?: AmbianceEffectSettings,
): BackgroundAmbianceRequest {
  return {
    description: { ...description, lightIds: [...new Set(description.lightIds)] },
    credentials,
    settings,
    lights: lights.filter(light => description.lightIds.includes(light.id)).map(({ id, kind, colorCapable, colorTemperatureCapable }) =>
      ({ id, kind, colorCapable, colorTemperatureCapable })),
    timeline: timeline && {
      durationMs: timeline.durationMs,
      events: [...timeline.events].sort((a, b) => a.atMs - b.atMs).map(event => ({
        lightId: event.lightId, atMs: event.atMs,
        state: hueStateBody(supportedLightState(lights.find(light => light.id === event.lightId),
          { ...event.state, transitionTimeDeciseconds: event.state.transitionTimeDeciseconds ?? 0 })),
      })),
      audio: [...(timeline.backgroundAudio ? [timeline.backgroundAudio] : []), ...(timeline.audioEffects ?? [])],
    },
  };
}

export type AmbiancePlayback = {
  attach: () => void;
  start: (request: BackgroundAmbianceRequest, play: (apply: (id: string, state: LightState) => Promise<void>) => SequenceRunner,
    apply: (id: string, state: LightState) => Promise<void>) => Promise<string>;
  stop: (id: string) => Promise<void>;
  stopAll: () => Promise<void>;
  foreground: (ids: string[], play: () => SequenceRunner) => SequenceRunner;
  usesSequence: (id: string) => Promise<boolean>;
  getModes: () => Promise<AmbianceMode[]>;
  dispose: () => void;
};

export type BackgroundSnapshot = {
  revision: number;
  modes: AmbianceMode[];
  errors: { id: string; name: string; message: string }[];
};

export type BackgroundAmbiancePort = {
  requestNotificationPermission: () => Promise<{ granted: boolean }>;
  start: (request: string) => Promise<string>;
  stop: (id: string) => Promise<void>;
  stopAll: () => Promise<void>;
  reserve: (token: string, ids: string[]) => Promise<void>;
  release: (token: string) => Promise<void>;
  getSnapshot: () => Promise<string>;
  addListener: (name: 'onChange', listener: (event: { snapshot: string }) => void) => { remove: () => void };
};

export function createBackgroundAmbiancePlayback(
  getPort: () => BackgroundAmbiancePort | null,
  onChange: (modes: AmbianceMode[]) => void,
  onError: (name: string, error: unknown) => void,
): AmbiancePlayback {
  let modes: AmbianceMode[] = [];
  let revision = -1;
  let subscription: { remove: () => void } | undefined;
  const seenErrors = new Set<string>();
  const owner = `foreground-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let nextReservation = 0;
  let attached = false;
  const requirePort = () => {
    const port = getPort();
    if (!port) throw new Error('Android ambiance requires a custom Spooky Vibes build. Rebuild the Android app; Expo Go does not include its background service.');
    return port;
  };
  const receive = (json: string) => {
    const snapshot: BackgroundSnapshot = JSON.parse(json);
    if (snapshot.revision < revision) return;
    revision = snapshot.revision;
    modes = snapshot.modes;
    onChange(modes);
    for (const error of snapshot.errors) {
      if (seenErrors.has(error.id)) continue;
      seenErrors.add(error.id);
      onError(error.name, new Error(error.message));
    }
  };
  return {
    attach: () => {
      attached = true;
      // Expo Go can still use Home; explain the missing service only when ambiance is started.
      const port = getPort();
      if (!port) return;
      subscription = port.addListener('onChange', event => {
        if (attached) receive(event.snapshot);
      });
      void port.getSnapshot().then(json => { if (attached) receive(json); })
        .catch(error => { if (attached) onError('Android playback', error); });
    },
    start: async request => {
      const port = requirePort();
      const permission = await port.requestNotificationPermission();
      if (!permission.granted) throw new Error('Allow notifications in Android settings to use background ambiance and its Stop all control.');
      return port.start(JSON.stringify(request));
    },
    stop: async id => { await requirePort().stop(id); },
    stopAll: async () => {
      const port = getPort();
      if (port) await port.stopAll();
    },
    foreground: (ids, play) => {
      let cancelled = false;
      let active: SequenceRunner | undefined;
      const token = `${owner}-${++nextReservation}`;
      const done = (async () => {
        const port = getPort();
        if (!port) {
          active = cancelled ? undefined : play();
          await active?.done;
          return;
        }
        try {
          await port.reserve(token, ids);
          if (!cancelled) { active = play(); await active.done; }
        } finally { await port.release(token); }
      })();
      return { done, cancel: () => { cancelled = true; active?.cancel(); } };
    },
    usesSequence: async id => {
      const port = getPort();
      if (!port) return false;
      receive(await port.getSnapshot());
      return modes.some(mode => mode.sequenceId === id);
    },
    getModes: async () => {
      const port = getPort();
      if (!port) return [];
      receive(await port.getSnapshot());
      return modes;
    },
    dispose: () => { attached = false; subscription?.remove(); subscription = undefined; },
  };
}

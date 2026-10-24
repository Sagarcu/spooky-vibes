export type HueCredentials = {
  bridgeIp: string;
  username: string;
};

export type HueLight = {
  id: string;
  name: string;
  on: boolean;
  brightness: number;
  hue?: number;
  saturation?: number;
  colorTemperature?: number;
  colorTemperatureMired?: number;
  colorMode?: 'hs' | 'ct' | 'xy';
  xy?: [number, number];
  brightnessRaw?: number;
  colorCapable: boolean;
  colorTemperatureCapable: boolean;
  kind: 'color' | 'tunable-white' | 'dimmable' | 'onoff-plug' | 'dimmable-plug';
};

export type HueLightGroup = {
  id: string;
  name: string;
  lightIds: string[];
};

export type LightState = {
  on?: boolean;
  brightness?: number;
  brightnessRaw?: number;
  hue?: number;
  saturation?: number;
  colorTemperature?: number;
  colorTemperatureMired?: number;
  xy?: [number, number];
  transitionTimeDeciseconds?: number;
};

export type SequenceStep = {
  id: string;
  label: string;
  durationMs: number;
  state: LightState;
};

export type LightingSequence = {
  id: string;
  name: string;
  lightIds: string[];
  steps: SequenceStep[];
  nextStep?: (previousStep?: SequenceStep) => SequenceStep;
};

export type TimelineEvent = {
  id: string;
  lightId: string;
  atMs: number;
  state: { on: boolean; brightness?: number; hue?: number; saturation?: number; colorTemperature?: number; transitionTimeDeciseconds?: number };
};

export type TimelineAudioClip = {
  id: string;
  uri: string;
  name: string;
  atMs: number;
  durationMs: number;
  volume: number;
};

export type TimelineSequence = {
  id: string;
  name: string;
  groupId: string;
  durationMs: number;
  events: TimelineEvent[];
  restoreAfterPlayback?: boolean;
  backgroundAudio?: TimelineAudioClip;
  audioEffects?: TimelineAudioClip[];
};



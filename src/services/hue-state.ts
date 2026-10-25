import type { HueLight, LightState } from '../types/hue';

export function isWhiteOnlyLight(light: HueLight): boolean {
  return !light.colorCapable && light.colorTemperatureCapable && !light.kind.includes('plug');
}

export function supportedLightState(device: HueLight | undefined, state: LightState): LightState {
  if (device?.kind === 'onoff-plug') return { on: state.on };
  if (device?.kind === 'dimmable-plug') return {
    on: state.on, brightness: state.brightness, brightnessRaw: state.brightnessRaw,
    transitionTimeDeciseconds: state.transitionTimeDeciseconds,
  };
  return {
    ...state, hue: device?.colorCapable ? state.hue : undefined,
    saturation: device?.colorCapable ? state.saturation : undefined,
    xy: device?.colorCapable ? state.xy : undefined,
    colorTemperature: device?.colorTemperatureCapable ? state.colorTemperature : undefined,
    colorTemperatureMired: device?.colorTemperatureCapable ? state.colorTemperatureMired : undefined,
  };
}

export function hueStateBody(state: LightState): Record<string, number | boolean | [number, number]> {
  const body: Record<string, number | boolean | [number, number]> = {};
  if (state.on !== undefined) body.on = state.on;
  if (state.brightness !== undefined) body.bri = Math.max(1, Math.min(254, Math.round(state.brightness * 2.54)));
  if (state.brightnessRaw !== undefined) body.bri = Math.max(1, Math.min(254, Math.round(state.brightnessRaw)));
  if (state.hue !== undefined) body.hue = Math.max(0, Math.min(65_535, Math.round(state.hue)));
  if (state.saturation !== undefined) body.sat = Math.max(0, Math.min(254, Math.round(state.saturation)));
  if (state.xy !== undefined) body.xy = state.xy;
  if (state.colorTemperature !== undefined) body.ct = Math.max(153, Math.min(500, Math.round(1_000_000 / state.colorTemperature)));
  if (state.colorTemperatureMired !== undefined) body.ct = Math.max(153, Math.min(500, Math.round(state.colorTemperatureMired)));
  if (state.transitionTimeDeciseconds !== undefined) body.transitiontime = Math.max(0, Math.round(state.transitionTimeDeciseconds));
  return body;
}

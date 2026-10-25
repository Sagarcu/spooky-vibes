import type { PlaybackTarget } from './playback-target';

export type AmbianceWhite =
  | { mode: 'keep' }
  | { mode: 'white'; temperature: number };

export type AmbianceColor =
  | AmbianceWhite
  | { mode: 'color'; hue: number; saturation: number };

export type AmbianceEffectSettings = {
  minBrightness: number;
  maxBrightness: number;
  color: AmbianceColor;
  glowColor: AmbianceColor;
  whiteColor?: AmbianceWhite;
  glowWhiteColor?: AmbianceWhite;
};

export type SavedAmbiance = {
  id: string;
  name: string;
  sequenceId: string;
  target: PlaybackTarget | null;
  settings?: AmbianceEffectSettings;
};

export function defaultAmbianceSettings(sequenceId: string): AmbianceEffectSettings {
  return {
    minBrightness: sequenceId === 'halloween-storm' ? 80 : 8,
    maxBrightness: sequenceId === 'halloween-storm' ? 100 : 50,
    color: { mode: 'white', temperature: sequenceId === 'halloween-storm' ? 6500 : 2200 },
    glowColor: { mode: 'white', temperature: 2200 },
    whiteColor: { mode: 'keep' },
    glowWhiteColor: { mode: 'keep' },
  };
}

function integerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function isAmbianceColor(value: unknown): value is AmbianceColor {
  if (!value || typeof value !== 'object' || !('mode' in value)) return false;
  return value.mode === 'keep' ||
    value.mode === 'white' && 'temperature' in value && integerBetween(value.temperature, 2000, 6500) ||
    value.mode === 'color' && 'hue' in value && 'saturation' in value &&
      integerBetween(value.hue, 0, 65535) && integerBetween(value.saturation, 0, 254);
}

export function isAmbianceSettings(value: unknown): value is AmbianceEffectSettings {
  return !!value && typeof value === 'object' &&
    'minBrightness' in value && integerBetween(value.minBrightness, 1, 100) &&
    'maxBrightness' in value && integerBetween(value.maxBrightness, value.minBrightness, 100) &&
    'color' in value && isAmbianceColor(value.color) && 'glowColor' in value && isAmbianceColor(value.glowColor) &&
    (!('whiteColor' in value) || value.whiteColor === undefined || isAmbianceWhite(value.whiteColor)) &&
    (!('glowWhiteColor' in value) || value.glowWhiteColor === undefined || isAmbianceWhite(value.glowWhiteColor));
}

function isAmbianceWhite(value: unknown): value is AmbianceWhite {
  return isAmbianceColor(value) && value.mode !== 'color';
}

export function isBuiltInAmbiance(sequenceId: string): boolean {
  return sequenceId === 'candlelight' || sequenceId === 'halloween-storm';
}

function isSavedAmbiance(value: unknown): value is SavedAmbiance {
  if (!value || typeof value !== 'object' ||
    !('id' in value) || typeof value.id !== 'string' || !value.id.trim() ||
    !('name' in value) || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60 ||
    !('sequenceId' in value) || typeof value.sequenceId !== 'string' || !value.sequenceId.trim() ||
    !('target' in value)) return false;
  const target = value.target;
  if (target !== null && (!target || typeof target !== 'object' ||
    !('kind' in target) || target.kind !== 'group' && target.kind !== 'light' ||
    !('id' in target) || typeof target.id !== 'string' || !target.id.trim())) return false;
  if (isBuiltInAmbiance(value.sequenceId)) {
    return target !== null && 'settings' in value && isAmbianceSettings(value.settings);
  }
  return !('settings' in value) || value.settings === undefined;
}

export function validateSavedAmbiance(value: unknown): SavedAmbiance {
  if (!isSavedAmbiance(value)) throw new Error('Enter an ambiance name (up to 60 characters), choose a target, and use valid brightness limits and colors.');
  return { ...value, name: value.name.trim() };
}

export function parseSavedAmbiances(raw: string | null): SavedAmbiance[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Saved ambiance configurations are invalid.');
  const configurations = value.map(validateSavedAmbiance);
  if (new Set(configurations.map(item => item.id)).size !== configurations.length) throw new Error('Saved ambiance IDs must be unique.');
  return configurations;
}

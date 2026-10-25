import type { HueLight, HueLightGroup } from '../types/hue';

export type PlaybackTarget = { kind: 'group' | 'light'; id: string };

export function parsePlaybackTarget(raw: string | null): PlaybackTarget | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object'
    || !('kind' in value) || (value.kind !== 'group' && value.kind !== 'light')
    || !('id' in value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Invalid saved playback target. Choose a group or lamp on Home.');
  }
  return { kind: value.kind, id: value.id };
}

export function resolvePlaybackTarget(target: PlaybackTarget | null, groups: HueLightGroup[], lights: HueLight[]) {
  if (!target) return { name: 'None selected', lightIds: [] };
  if (target.kind === 'group') {
    const group = groups.find(item => item.id === target.id);
    const lightIds = group?.lightIds.filter(id => lights.some(light => light.id === id)) ?? [];
    return { name: group?.name ?? 'Saved group unavailable', lightIds };
  }
  const light = lights.find(item => item.id === target.id);
  return { name: light?.name ?? 'Saved lamp unavailable', lightIds: light ? [light.id] : [] };
}

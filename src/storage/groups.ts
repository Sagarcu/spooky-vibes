import * as SecureStore from 'expo-secure-store';

import type { HueLightGroup } from '../types/hue';

const GROUPS_KEY = 'spooky-moods.light-groups';

function isGroup(value: unknown): value is HueLightGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as { id?: unknown; name?: unknown; lightIds?: unknown };
  return typeof group.id === 'string'
    && typeof group.name === 'string'
    && Array.isArray(group.lightIds)
    && group.lightIds.every((id) => typeof id === 'string');
}

export async function loadGroups(): Promise<HueLightGroup[]> {
  const stored = await SecureStore.getItemAsync(GROUPS_KEY);
  if (!stored) return [];

  try {
    const groups = JSON.parse(stored) as unknown;
    return Array.isArray(groups) ? groups.filter(isGroup) : [];
  } catch {
    return [];
  }
}

export function saveGroups(groups: HueLightGroup[]): Promise<void> {
  return SecureStore.setItemAsync(GROUPS_KEY, JSON.stringify(groups));
}

export function clearGroups(): Promise<void> {
  return SecureStore.deleteItemAsync(GROUPS_KEY);
}



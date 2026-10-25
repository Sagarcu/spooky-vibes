import type { HueLightGroup } from '../types/hue';

export function createLightGroup(name: string, lightIds: string[], id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): HueLightGroup {
  const normalizedName = name.trim();
  const uniqueLightIds = [...new Set(lightIds)];

  if (!normalizedName) throw new Error('Give this group a name.');
  if (uniqueLightIds.length === 0) throw new Error('Choose at least one light for this group.');

  return { id, name: normalizedName, lightIds: uniqueLightIds };
}

export function saveLightGroup(groups: HueLightGroup[], name: string, lightIds: string[], id?: string): HueLightGroup[] {
  if (id !== undefined && !groups.some(group => group.id === id)) {
    throw new Error('This group no longer exists. Return to Groups and choose another group.');
  }
  const saved = createLightGroup(name, lightIds, id);
  if (groups.some(group => group.id !== saved.id && group.name.toLowerCase() === saved.name.toLowerCase())) {
    throw new Error('A group with that name already exists. Choose a different name.');
  }
  return id === undefined ? [...groups, saved] : groups.map(group => group.id === id ? saved : group);
}

export function groupsForAvailableLights(groups: HueLightGroup[], availableLightIds: string[]): HueLightGroup[] {
  const available = new Set(availableLightIds);
  return groups
    .map((group) => ({ ...group, lightIds: group.lightIds.filter((id) => available.has(id)) }))
    .filter((group) => group.lightIds.length > 0);
}


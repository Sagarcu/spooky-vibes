import type { HueLightGroup } from '../types/hue';

export function createLightGroup(name: string, lightIds: string[], id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): HueLightGroup {
  const normalizedName = name.trim();
  const uniqueLightIds = [...new Set(lightIds)];

  if (!normalizedName) throw new Error('Give this group a name.');
  if (uniqueLightIds.length === 0) throw new Error('Choose at least one light for this group.');

  return { id, name: normalizedName, lightIds: uniqueLightIds };
}

export function groupsForAvailableLights(groups: HueLightGroup[], availableLightIds: string[]): HueLightGroup[] {
  const available = new Set(availableLightIds);
  return groups
    .map((group) => ({ ...group, lightIds: group.lightIds.filter((id) => available.has(id)) }))
    .filter((group) => group.lightIds.length > 0);
}



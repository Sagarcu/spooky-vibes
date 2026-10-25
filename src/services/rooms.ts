export type LightRoom = { id: string; name: string; lightIds: string[] };
export type RoomLayout = { rooms: LightRoom[]; unorderedLightIds: string[] };
export type LightSection = { id: string | null; name: string; lightIds: string[] };

export function emptyRoomLayout(): RoomLayout {
  return { rooms: [], unorderedLightIds: [] };
}

export function parseRoomLayout(raw: string): RoomLayout {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object') throw new Error('Saved rooms are invalid.');
  const value = data as Partial<RoomLayout>;
  const isIds = (ids: unknown): ids is string[] =>
    Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.length > 0);
  if (!Array.isArray(value.rooms) || !isIds(value.unorderedLightIds) ||
    !value.rooms.every(room => room && typeof room.id === 'string' && room.id.length > 0 &&
      typeof room.name === 'string' && room.name.trim().length > 0 && isIds(room.lightIds))) {
    throw new Error('Saved rooms are invalid.');
  }
  const ids = value.rooms.map(room => room.id);
  const names = value.rooms.map(room => room.name.trim().toLowerCase());
  const lights = [...value.unorderedLightIds, ...value.rooms.flatMap(room => room.lightIds)];
  if (new Set(ids).size !== ids.length || new Set(names).size !== names.length ||
    new Set(lights).size !== lights.length) throw new Error('Saved rooms contain duplicate entries.');
  return { rooms: value.rooms, unorderedLightIds: value.unorderedLightIds };
}

export function lightSections(layout: RoomLayout, availableIds: string[], includeEmptyUnordered = false): LightSection[] {
  const available = new Set(availableIds);
  const assigned = new Set(layout.rooms.flatMap(room => room.lightIds));
  const saved = new Set(layout.unorderedLightIds);
  const unordered = [
    ...layout.unorderedLightIds.filter(id => available.has(id)),
    ...availableIds.filter(id => !assigned.has(id) && !saved.has(id)),
  ];
  return [
    ...(unordered.length || includeEmptyUnordered ? [{ id: null, name: 'Unordered', lightIds: unordered }] : []),
    ...layout.rooms.map(room => ({ ...room, lightIds: room.lightIds.filter(id => available.has(id)) })),
  ];
}

export function saveRoom(layout: RoomLayout, id: string, name: string): RoomLayout {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a room name.');
  if (layout.rooms.some(room => room.id !== id && room.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A room with that name already exists. Choose a different name.');
  }
  const existing = layout.rooms.some(room => room.id === id);
  return { ...layout, rooms: existing
    ? layout.rooms.map(room => room.id === id ? { ...room, name: trimmed } : room)
    : [...layout.rooms, { id, name: trimmed, lightIds: [] }] };
}

export function deleteRoom(layout: RoomLayout, id: string): RoomLayout {
  const room = layout.rooms.find(item => item.id === id);
  if (!room) throw new Error('This room is no longer available.');
  return {
    rooms: layout.rooms.filter(item => item.id !== id),
    unorderedLightIds: [...layout.unorderedLightIds, ...room.lightIds],
  };
}

export function reorderRoom(layout: RoomLayout, id: string, direction: -1 | 1): RoomLayout {
  const rooms = [...layout.rooms];
  const index = rooms.findIndex(room => room.id === id);
  if (index < 0) throw new Error('This room is no longer available.');
  const target = index + direction;
  if (target < 0 || target >= rooms.length) throw new Error('This room cannot move further.');
  const current = rooms[index];
  const neighbor = rooms[target];
  if (!current || !neighbor) throw new Error('This room cannot move further.');
  rooms[index] = neighbor;
  rooms[target] = current;
  return { ...layout, rooms };
}

export function moveRoomLight(
  layout: RoomLayout, availableIds: string[], lightId: string, roomId: string | null, beforeId: string | null = null,
): RoomLayout {
  if (!availableIds.includes(lightId)) throw new Error('This lamp is no longer available. Refresh your lights.');
  if (roomId !== null && !layout.rooms.some(room => room.id === roomId)) throw new Error('This room is no longer available.');
  const assigned = new Set([...layout.unorderedLightIds, ...layout.rooms.flatMap(room => room.lightIds)]);
  const next: RoomLayout = {
    rooms: layout.rooms.map(room => ({ ...room, lightIds: room.lightIds.filter(id => id !== lightId) })),
    unorderedLightIds: [...layout.unorderedLightIds, ...availableIds.filter(id => !assigned.has(id))]
      .filter(id => id !== lightId),
  };
  const destination = roomId === null ? next.unorderedLightIds : next.rooms.find(room => room.id === roomId)!.lightIds;
  if (beforeId === lightId) throw new Error('A lamp cannot be moved before itself.');
  const index = beforeId === null ? destination.length : destination.indexOf(beforeId);
  if (index < 0) throw new Error('The destination lamp is no longer in this room.');
  destination.splice(index, 0, lightId);
  return next;
}

export type RoomDropRow = { lightId: string; y: number; height: number };
export type RoomDropSection = { roomId: string | null; y: number; rows: RoomDropRow[] };

export function roomDropTarget(sections: RoomDropSection[], y: number, draggedId: string) {
  const section = [...sections].reverse().find(item => y >= item.y) ?? sections[0];
  if (!section) return null;
  const before = section.rows.find(row => row.lightId !== draggedId && y < row.y + row.height / 2);
  return { roomId: section.roomId, beforeId: before?.lightId ?? null };
}

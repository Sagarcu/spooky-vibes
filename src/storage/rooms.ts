import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyRoomLayout, parseRoomLayout, type RoomLayout } from '../services/rooms';

const KEY = 'spooky-vibes.rooms';

export async function loadRooms(): Promise<RoomLayout> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw === null) return emptyRoomLayout();
  try { return parseRoomLayout(raw); }
  catch (problem) {
    throw new Error(`Could not load saved rooms: ${problem instanceof Error ? problem.message : 'Invalid room data.'}`);
  }
}

export function saveRooms(layout: RoomLayout): Promise<void> {
  return AsyncStorage.setItem(KEY, JSON.stringify(layout));
}

export function clearRooms(): Promise<void> {
  return AsyncStorage.removeItem(KEY);
}

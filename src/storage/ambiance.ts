import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSavedAmbiances, type SavedAmbiance } from '../services/ambiance-settings';

const KEY = 'spooky-vibes.ambiance-configurations';

export async function loadAmbiances(): Promise<SavedAmbiance[]> {
  try { return parseSavedAmbiances(await AsyncStorage.getItem(KEY)); }
  catch (problem) {
    throw new Error(`Could not load saved ambiance modes: ${problem instanceof Error ? problem.message : 'Storage unavailable.'}`);
  }
}

export function saveAmbiances(configurations: SavedAmbiance[]): Promise<void> {
  return AsyncStorage.setItem(KEY, JSON.stringify(configurations));
}

export function clearAmbiances(): Promise<void> {
  return AsyncStorage.removeItem(KEY);
}

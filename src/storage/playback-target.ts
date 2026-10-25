import AsyncStorage from '@react-native-async-storage/async-storage';
import { parsePlaybackTarget, type PlaybackTarget } from '../services/playback-target';

const KEY = 'spooky-vibes.playback-target';

export async function loadPlaybackTarget(): Promise<PlaybackTarget | null> {
  try { return parsePlaybackTarget(await AsyncStorage.getItem(KEY)); }
  catch (problem) {
    throw new Error(`Could not load the Home playback target: ${problem instanceof Error ? problem.message : 'Storage unavailable.'}`);
  }
}

export function savePlaybackTarget(target: PlaybackTarget): Promise<void> {
  return AsyncStorage.setItem(KEY, JSON.stringify(target));
}

export function clearPlaybackTarget(): Promise<void> {
  return AsyncStorage.removeItem(KEY);
}

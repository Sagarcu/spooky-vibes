import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TimelineSequence } from '../types/hue';
import { isValidAudioClip, isValidTimelineState } from '../services/sequences';

const KEY = 'spooky-moods.timelines';

export async function loadTimelines(): Promise<TimelineSequence[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is TimelineSequence => {
      if (!item || typeof item !== 'object') return false;
      const sequence = item as Partial<TimelineSequence>;
      return typeof sequence.id === 'string' && typeof sequence.name === 'string' &&
        typeof sequence.groupId === 'string' && Number.isInteger(sequence.durationMs) &&
        (sequence.restoreAfterPlayback === undefined || typeof sequence.restoreAfterPlayback === 'boolean') &&
        sequence.durationMs! >= 1_000 && sequence.durationMs! <= 120_000 && Array.isArray(sequence.events) &&
        sequence.events.length <= 500 && sequence.events.every(event => event && typeof event.id === 'string' &&
          typeof event.lightId === 'string' && Number.isInteger(event.atMs) && event.atMs >= 0 &&
          event.atMs < sequence.durationMs! && isValidTimelineState(event.state)) &&
        (sequence.backgroundAudio === undefined || isValidAudioClip(sequence.backgroundAudio, sequence.durationMs!)) &&
        (sequence.audioEffects === undefined || Array.isArray(sequence.audioEffects) && sequence.audioEffects.length <= 100 &&
          sequence.audioEffects.every(clip => isValidAudioClip(clip, sequence.durationMs!))) &&
        new Set([...(sequence.backgroundAudio ? [sequence.backgroundAudio.id] : []),
          ...(sequence.audioEffects ?? []).map(clip => clip.id)]).size ===
          (sequence.backgroundAudio ? 1 : 0) + (sequence.audioEffects?.length ?? 0);
    });
  } catch { return []; }
}

export function saveTimelines(timelines: TimelineSequence[]): Promise<void> {
  return AsyncStorage.setItem(KEY, JSON.stringify(timelines));
}

export function clearTimelines(): Promise<void> {
  return AsyncStorage.removeItem(KEY);
}

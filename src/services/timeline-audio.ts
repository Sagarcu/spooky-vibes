import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { createTimelineRunner, type SequenceRunner } from './sequences';
import { CREEPY_KNOCK_DURATION_MS, EERIE_CHIME_DURATION_MS, makeCreepyKnockWav, makeEerieChimeWav } from './creepy-knock';
import type { LightState, TimelineAudioClip, TimelineSequence } from '../types/hue';

const folder = () => new Directory(Paths.document, 'sequence-audio');
const clips = (sequence: TimelineSequence) => [...(sequence.backgroundAudio ? [sequence.backgroundAudio] : []), ...(sequence.audioEffects ?? [])];
export type SampleSound = 'knock' | 'chime';
const sampleData = (sound: SampleSound) => sound === 'knock' ? makeCreepyKnockWav() : makeEerieChimeWav();

export function createSampleClip(sound: SampleSound): TimelineAudioClip {
  if (Platform.OS === 'web') throw new Error('Built-in sounds are available on Android and iOS only.');
  const directory = folder();
  directory.create({ idempotent: true });
  const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const file = new File(directory, `${id}.wav`);
  try {
    file.create();
    file.write(sampleData(sound));
    return { id, uri: file.uri, name: sound === 'knock' ? 'Creepy knocking' : 'Eerie chime', atMs: 0, durationMs: sound === 'knock' ? CREEPY_KNOCK_DURATION_MS : EERIE_CHIME_DURATION_MS, volume: 1 };
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}

function previewSampleUri(sound: SampleSound): string {
  if (Platform.OS === 'web') throw new Error('Sound preview is available on Android and iOS only.');
  const directory = new Directory(Paths.cache, 'sequence-audio');
  directory.create({ idempotent: true });
  const file = new File(directory, `${sound}-preview.wav`);
  file.create({ overwrite: true });
  file.write(sampleData(sound));
  return file.uri;
}

function ready(player: AudioPlayer, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: ReturnType<AudioPlayer['addListener']> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (duration: number, error?: Error) => {
      if (settled) return;
      settled = true;
      subscription?.remove();
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(Math.round(duration * 1000));
    };
    const abort = () => finish(0, new Error('Audio preparation stopped.'));
    const check = (status: AudioPlayer['currentStatus']) => {
      if (status.isLoaded && Number.isFinite(status.duration) && status.duration > 0) finish(status.duration);
      else if (status.error) finish(0, new Error(`Could not read this audio file: ${status.error}`));
    };
    subscription = player.addListener('playbackStatusUpdate', check);
    timer = setTimeout(() => finish(0, new Error('Could not read the audio duration (timed out).')), 10_000);
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    check(player.currentStatus);
    if (settled) { subscription.remove(); clearTimeout(timer); }
  });
}

export function createAudioPreviewRunner(uri?: string, sound: SampleSound = 'knock'): SequenceRunner {
  let cancelled = false;
  const controller = new AbortController();
  let player: AudioPlayer | undefined;
  const done = (async () => {
    try {
      const source = uri ?? previewSampleUri(sound);
      if (cancelled) return;
      if (!new File(source).exists) throw new Error('Audio file is missing. Replace it in Sequence Creator.');
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' });
      if (cancelled) return;
      player = createAudioPlayer(source);
      const durationMs = await ready(player, controller.signal);
      if (cancelled) return;
      const active = player;
      await new Promise<void>((resolve, reject) => {
        let finished = false;
        let subscription: ReturnType<AudioPlayer['addListener']> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
          if (finished) return;
          finished = true;
          subscription?.remove();
          if (timer) clearTimeout(timer);
          controller.signal.removeEventListener('abort', abort);
          if (error) reject(error); else resolve();
        };
        const abort = () => finish();
        subscription = active.addListener('playbackStatusUpdate', status => {
          if (status.error) finish(new Error(status.error));
          else if (status.didJustFinish) finish();
        });
        controller.signal.addEventListener('abort', abort);
        timer = setTimeout(() => finish(new Error('Audio preview timed out. Check the device audio output.')), durationMs + 3000);
        if (controller.signal.aborted) abort();
        else active.play();
      });
    } catch (error) { if (!cancelled) throw error; }
    finally { player?.pause(); player?.remove(); }
  })();
  return { done, cancel: () => { cancelled = true; controller.abort(); player?.pause(); } };
}

export async function importAudioClip(): Promise<TimelineAudioClip | null> {
  if (Platform.OS === 'web') throw new Error('Audio import is available on Android and iOS only.');
  // Android's picker grants read access to the content:// URI. Copying its cached
  // file:// URI can fail Expo's sandbox check even though the picker can read it.
  const picked = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: Platform.OS !== 'android' });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset) return null;
  const directory = folder();
  directory.create({ idempotent: true });
  const extension = asset.name.match(/\.[a-z0-9]{1,8}$/i)?.[0]?.toLowerCase() ?? '.mp3';
  const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const file = new File(directory, `${id}${extension}`);
  let player: AudioPlayer | undefined;
  try {
    if (Platform.OS === 'android') {
      await copyAsync({ from: asset.uri, to: file.uri });
    } else {
      new File(asset.uri).copy(file);
    }
    player = createAudioPlayer(file.uri);
    const durationMs = await ready(player);
    return { id, uri: file.uri, name: asset.name, atMs: 0, durationMs, volume: 1 };
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  } finally { player?.remove(); }
}

export function deleteUnusedAudio(previous: TimelineSequence[], next: TimelineSequence[]): void {
  if (Platform.OS === 'web') return;
  const used = new Set(next.flatMap(clips).map(clip => clip.uri));
  const prefix = `${folder().uri.replace(/\/$/, '')}/audio-`;
  for (const uri of new Set(previous.flatMap(clips).map(clip => clip.uri))) {
    if (uri.startsWith(prefix) && !used.has(uri)) {
      const file = new File(uri);
      if (file.exists) file.delete();
    }
  }
}

export function createAudioTimelineRunner(sequence: TimelineSequence, apply: (id: string, state: LightState) => Promise<void>): SequenceRunner {
  let cancelled = false;
  const controller = new AbortController();
  let runner: SequenceRunner | undefined;
  const players = new Map<string, AudioPlayer>();
  const release = () => { for (const player of players.values()) { player.pause(); player.remove(); } players.clear(); };
  const done = (async () => {
    try {
      const audio = clips(sequence);
      if (audio.length) await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
      await Promise.all(audio.map(async clip => {
        if (cancelled) return;
        if (!new File(clip.uri).exists) throw new Error(`Audio file missing: ${clip.name}. Replace it in Sequence Creator.`);
        const player = createAudioPlayer(clip.uri);
        players.set(clip.id, player);
        player.volume = clip.volume;
        await ready(player, controller.signal);
      }));
      if (cancelled) return;
      runner = createTimelineRunner(sequence, apply, clip => players.get(clip.id)?.play());
      await runner.done;
    } catch (error) { if (!cancelled) throw error; }
    finally { release(); }
  })();
  return { done, cancel: () => { cancelled = true; controller.abort(); runner?.cancel(); if (runner) release(); } };
}




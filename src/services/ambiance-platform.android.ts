import { requireOptionalNativeModule } from 'expo-modules-core';
import type { AmbianceMode } from './ambiance';
import { createBackgroundAmbiancePlayback, type BackgroundAmbiancePort } from './background-ambiance';

export function createPlatformAmbiancePlayback(
  onChange: (modes: AmbianceMode[]) => void, onError: (name: string, error: unknown) => void,
) {
  return createBackgroundAmbiancePlayback(() =>
    requireOptionalNativeModule<BackgroundAmbiancePort>('SpookyAmbiance'), onChange, onError);
}

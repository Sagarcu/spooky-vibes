import * as SecureStore from 'expo-secure-store';

import { parseCredentials } from '../services/credentials';
import type { HueCredentials } from '../types/hue';

const CREDENTIALS_KEY = 'spooky-moods.hue-credentials';

export async function loadCredentials(): Promise<HueCredentials | null> {
  const stored = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  return parseCredentials(stored);
}

export function saveCredentials(credentials: HueCredentials): Promise<void> {
  return SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export function clearCredentials(): Promise<void> {
  return SecureStore.deleteItemAsync(CREDENTIALS_KEY);
}


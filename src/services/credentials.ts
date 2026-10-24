import type { HueCredentials } from '../types/hue';

export function parseCredentials(stored: string | null): HueCredentials | null {
  if (!stored) return null;

  try {
    const value = JSON.parse(stored) as { bridgeIp?: unknown; username?: unknown };
    if (typeof value.bridgeIp !== 'string' || typeof value.username !== 'string') return null;
    if (!value.bridgeIp.trim() || !value.username.trim()) return null;
    return { bridgeIp: value.bridgeIp, username: value.username };
  } catch {
    return null;
  }
}


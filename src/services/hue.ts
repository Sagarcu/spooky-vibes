import type { HueCredentials, HueLight, LightState } from '../types/hue';

type HueError = { error?: { description?: string } };
type HueSuccess = { success?: { username?: string } };
type HueLightResponse = {
  name: string;
  type?: string;
  state: { on: boolean; bri?: number; hue?: number; sat?: number; ct?: number; xy?: [number, number]; colormode?: 'hs' | 'ct' | 'xy' };
  capabilities?: {
    color?: unknown;
    colorTemperature?: unknown;
    control?: { colorgamut?: unknown; ct?: unknown };
  };
};

const REQUEST_TIMEOUT_MS = 8_000;

function normalizeBridgeIp(bridgeIp: string): string {
  const trimmed = bridgeIp.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(trimmed)) {
    throw new Error('Enter a valid bridge IP address or local hostname.');
  }
  return trimmed;
}

function bridgeUrl(bridgeIp: string, path: string): string {
  return `http://${normalizeBridgeIp(bridgeIp)}${path}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`Hue Bridge returned HTTP ${response.status}.`);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The Hue Bridge did not respond. Check the address and your Wi-Fi.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getHueError(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  const error = (payload[0] as HueError | undefined)?.error;
  return error?.description ?? null;
}

export function inferLightCapabilities(light: Pick<HueLightResponse, 'type' | 'state' | 'capabilities'>): {
  colorCapable: boolean;
  colorTemperatureCapable: boolean;
  kind: 'color' | 'tunable-white' | 'dimmable' | 'onoff-plug' | 'dimmable-plug';
} {
  const type = light.type?.toLocaleLowerCase() ?? '';
  const isPlug = type.includes('plug-in unit') || type.includes('plug in unit');
  const isDimmablePlug = isPlug && (type.includes('dimmable') || light.state.bri !== undefined);
  const colorCapable = !isPlug && (Array.isArray(light.capabilities?.control?.colorgamut)
    || light.capabilities?.color !== undefined
    || (light.state.hue !== undefined && light.state.sat !== undefined)
    || type.includes('color light'));
  const colorTemperatureCapable = !isPlug && (light.capabilities?.control?.ct !== undefined
    || light.capabilities?.colorTemperature !== undefined
    || light.state.ct !== undefined
    || type.includes('color temperature')
    || type.includes('color light'));
  return {
    colorCapable,
    colorTemperatureCapable,
    kind: isPlug ? (isDimmablePlug ? 'dimmable-plug' : 'onoff-plug') : colorCapable ? 'color' : colorTemperatureCapable ? 'tunable-white' : 'dimmable',
  };
}

export async function discoverBridge(): Promise<string | null> {
  const bridges = await request<Array<{ internalipaddress?: string }>>(
    'https://discovery.meethue.com/',
  );
  return bridges[0]?.internalipaddress ?? null;
}

export async function pairBridge(bridgeIp: string): Promise<HueCredentials> {
  const payload = await request<Array<HueSuccess & HueError>>(bridgeUrl(bridgeIp, '/api'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devicetype: 'spookyvibes#mobile' }),
  });
  const error = getHueError(payload);
  if (error) throw new Error(error);

  const username = payload[0]?.success?.username;
  if (!username) throw new Error('The Hue Bridge did not return pairing credentials.');
  return { bridgeIp: normalizeBridgeIp(bridgeIp), username };
}

export async function getLights(credentials: HueCredentials): Promise<HueLight[]> {
  const result = await request<Record<string, HueLightResponse>>(
    bridgeUrl(credentials.bridgeIp, `/api/${credentials.username}/lights`),
  );
  const error = getHueError(result);
  if (error) throw new Error(error);

  return Object.entries(result)
    .map(([id, light]) => ({
      id,
      name: light.name,
      on: light.state.on,
      brightness: Math.round(((light.state.bri ?? 1) / 254) * 100),
      brightnessRaw: light.state.bri,
      hue: light.state.hue,
      saturation: light.state.sat,
      colorTemperature: light.state.ct ? Math.round(1_000_000 / light.state.ct) : undefined,
      colorTemperatureMired: light.state.ct,
      colorMode: light.state.colormode,
      xy: Array.isArray(light.state.xy) && light.state.xy.length === 2 && light.state.xy.every(Number.isFinite) ? light.state.xy : undefined,
      ...inferLightCapabilities(light),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function renameLight(credentials: HueCredentials, lightId: string, name: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Enter a lamp name.');
  if (trimmedName.length > 32) throw new Error('Lamp names must be 32 characters or fewer.');

  const result = await request<Array<HueError & { success?: Record<string, string> }>>(
    bridgeUrl(credentials.bridgeIp, `/api/${credentials.username}/lights/${encodeURIComponent(lightId)}`),
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: trimmedName }) },
  );
  const error = result.find(entry => entry.error)?.error?.description;
  if (error) throw new Error(error);
  if (!result.some(entry => entry.success?.[`/lights/${lightId}/name`] === trimmedName)) {
    throw new Error('The Hue Bridge did not confirm the lamp rename.');
  }
}

export async function setLightState(
  credentials: HueCredentials,
  lightId: string,
  state: LightState,
): Promise<void> {
  const body: Record<string, number | boolean | [number, number]> = {};
  if (state.on !== undefined) body.on = state.on;
  if (state.brightness !== undefined) body.bri = Math.max(1, Math.min(254, Math.round(state.brightness * 2.54)));
  if (state.brightnessRaw !== undefined) body.bri = Math.max(1, Math.min(254, Math.round(state.brightnessRaw)));
  if (state.hue !== undefined) body.hue = Math.max(0, Math.min(65_535, Math.round(state.hue)));
  if (state.saturation !== undefined) body.sat = Math.max(0, Math.min(254, Math.round(state.saturation)));
  if (state.xy !== undefined) body.xy = state.xy;
  if (state.colorTemperature !== undefined) {
    body.ct = Math.max(153, Math.min(500, Math.round(1_000_000 / state.colorTemperature)));
  }
  if (state.colorTemperatureMired !== undefined) body.ct = Math.max(153, Math.min(500, Math.round(state.colorTemperatureMired)));
  if (state.transitionTimeDeciseconds !== undefined) {
    body.transitiontime = Math.max(0, Math.round(state.transitionTimeDeciseconds));
  }

  const result = await request<Array<HueError>>(
    bridgeUrl(credentials.bridgeIp, `/api/${credentials.username}/lights/${lightId}/state`),
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const error = getHueError(result);
  if (error) throw new Error(error);
}



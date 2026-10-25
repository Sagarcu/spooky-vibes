export const WHEEL_SIZE = 320;
export const WHEEL_RADIUS = WHEEL_SIZE / 2 - 4;

export function hsvHex(hue: number, saturation: number, brightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const v = Math.max(0, Math.min(100, brightness)) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function parseHexColor(input: string): { hue: number; saturation: number; brightness: number } | null {
  const hex = input.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
  const expanded = hex.length === 3 ? [...hex].map(character => character + character).join('') : hex;
  const red = parseInt(expanded.slice(0, 2), 16) / 255;
  const green = parseInt(expanded.slice(2, 4), 16) / 255;
  const blue = parseInt(expanded.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const difference = maximum - minimum;
  const sector = difference === 0 ? 0 : maximum === red ? (green - blue) / difference
    : maximum === green ? (blue - red) / difference + 2 : (red - green) / difference + 4;
  return {
    hue: (sector * 60 + 360) % 360,
    saturation: maximum === 0 ? 0 : difference / maximum * 100,
    brightness: maximum * 100,
  };
}

export function wheelColorAt(x: number, y: number, currentHue: number) {
  const dx = x - WHEEL_SIZE / 2;
  const dy = y - WHEEL_SIZE / 2;
  const distance = Math.hypot(dx, dy);
  return {
    hue: distance < 1 ? currentHue : ((Math.atan2(dy, dx) * 180 / Math.PI + 90) % 360 + 360) % 360,
    saturation: Math.round(Math.min(1, distance / WHEEL_RADIUS) * 100),
  };
}

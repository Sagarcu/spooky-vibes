export const whites = [['Candle', 2200], ['Warm', 2700], ['Soft', 3000], ['Neutral', 3500], ['Cool', 4000], ['Daylight', 5000]] as const;
export const colors = [['Red', 0], ['Orange', 6500], ['Yellow', 11000], ['Green', 25500], ['Cyan', 32500], ['Blue', 43500], ['Purple', 50000], ['Pink', 58000]] as const;
export const whiteSwatches: Record<(typeof whites)[number][1], string> = {
  2200: '#ff932c', 2700: '#ffa757', 3000: '#ffb16e',
  3500: '#ffc18d', 4000: '#ffcea6', 5000: '#ffe4ce',
};

export function nearestWhitePreset(temperature: number | undefined): (typeof whites)[number][1] | undefined {
  if (temperature === undefined) return undefined;
  return whites.reduce((nearest, preset) =>
    Math.abs(preset[1] - temperature) < Math.abs(nearest[1] - temperature) ? preset : nearest)[1];
}

export const CREEPY_KNOCK_DURATION_MS = 2000;
export const EERIE_CHIME_DURATION_MS = 2000;
const SAMPLE_RATE = 22050;

function emptyWav(durationMs: number): Uint8Array {
  const samples = SAMPLE_RATE * durationMs / 1000;
  const result = new Uint8Array(44 + samples * 2);
  const view = new DataView(result.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, result.length - 8, true);
  text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
  return result;
}

/** Three hollow, uneven wooden thuds with short room reflections. */
export function makeCreepyKnockWav(): Uint8Array {
  const result = emptyWav(CREEPY_KNOCK_DURATION_MS);
  const view = new DataView(result.buffer);
  const samples = (result.length - 44) / 2;
  const strikes = [0.08, 0.61, 1.31];
  let seed = 7919;
  let filteredNoise = 0;
  for (let i = 0; i < samples; i++) {
    const time = i / SAMPLE_RATE;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    filteredNoise += ((seed / 0xffffffff * 2 - 1) - filteredNoise) * 0.2;
    let sound = 0;
    for (let k = 0; k < strikes.length; k++) {
      const since = time - strikes[k]!;
      if (since < 0 || since > 0.55) continue;
      const attack = Math.min(1, since * 750);
      const body = Math.exp(-since * 19) * attack;
      const pitch = 100 + 95 * Math.exp(-since * 35);
      const tone = Math.sin(2 * Math.PI * (100 * since + 95 / 35 * (1 - Math.exp(-since * 35))));
      const hollow = Math.sin(2 * Math.PI * 245 * since) * Math.exp(-since * 32);
      const slap = filteredNoise * Math.exp(-since * 80);
      sound += (0.7 * tone + 0.2 * hollow + 0.5 * slap) * body * (k === 2 ? 1 : 0.85);
      // A quieter reflected knock lends a little distance to the sound.
      const echo = since - 0.11;
      if (echo > 0) sound += 0.12 * Math.sin(2 * Math.PI * pitch * echo) * Math.exp(-echo * 23);
    }
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sound)) * 27000), true);
  }
  return result;
}

/** An unsettling two-note metallic chime for checking tonal audio output. */
export function makeEerieChimeWav(): Uint8Array {
  const result = emptyWav(EERIE_CHIME_DURATION_MS);
  const view = new DataView(result.buffer);
  const samples = (result.length - 44) / 2;
  for (let i = 0; i < samples; i++) {
    const time = i / SAMPLE_RATE;
    let sound = 0;
    for (const [start, frequency] of [[0.08, 410], [0.83, 287]]) {
      const t = time - start!;
      if (t < 0) continue;
      const decay = Math.min(1, t * 200) * Math.exp(-t * 3.5);
      sound += (0.65 * Math.sin(2 * Math.PI * frequency! * t) + 0.24 * Math.sin(2 * Math.PI * frequency! * 2.41 * t)) * decay;
    }
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sound)) * 23000), true);
  }
  return result;
}


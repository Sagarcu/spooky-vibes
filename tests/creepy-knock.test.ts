import assert from 'node:assert/strict';
import test from 'node:test';
import { CREEPY_KNOCK_DURATION_MS, EERIE_CHIME_DURATION_MS, makeCreepyKnockWav, makeEerieChimeWav } from '../src/services/creepy-knock';

test('built-in knock has a valid mono PCM WAV header and three audible strikes', () => {
  const audio = makeCreepyKnockWav();
  const header = new DataView(audio.buffer);
  const tag = (offset: number) => String.fromCharCode(...audio.subarray(offset, offset + 4));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(12), 'fmt ');
  assert.equal(tag(36), 'data');
  assert.equal(header.getUint32(4, true) + 8, audio.length);
  assert.equal(header.getUint16(20, true), 1);
  assert.equal(header.getUint16(22, true), 1);
  assert.equal(header.getUint32(24, true), 22050);
  assert.equal(header.getUint16(34, true), 16);
  assert.equal(header.getUint32(40, true), 22050 * CREEPY_KNOCK_DURATION_MS / 1000 * 2);
  const peak = (fromSeconds: number) => {
    const start = Math.floor(fromSeconds * 22050);
    return Math.max(...Array.from({ length: 1000 }, (_, i) => Math.abs(header.getInt16(44 + (start + i) * 2, true))));
  };
  assert.ok(peak(0.09) > 2000);
  assert.ok(peak(0.62) > 2000);
  assert.ok(peak(1.32) > 2000);
  assert.deepEqual(audio, makeCreepyKnockWav());
});

test('eerie chime is a second audible two-second WAV sample', () => {
  const knock = makeCreepyKnockWav();
  const chime = makeEerieChimeWav();
  const view = new DataView(chime.buffer);
  assert.equal(chime.length, 44 + 22050 * EERIE_CHIME_DURATION_MS / 1000 * 2);
  assert.equal(view.getUint32(40, true), chime.length - 44);
  assert.notDeepEqual(chime, knock);
  assert.ok(Math.abs(view.getInt16(44 + Math.round(0.1 * 22050) * 2, true)) > 50);
});


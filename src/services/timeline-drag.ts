import type { TimelineSequence } from '../types/hue';

/** Keep a dragged item within the timeline while snapping to the editor's 0.1s grid. */
export function snappedTimelineTime(startMs: number, deltaX: number, durationMs: number, pixelsPerSecond: number): number {
  const lastStartMs = Math.max(0, Math.floor((durationMs - 1) / 100) * 100);
  const positionMs = startMs + deltaX * 1000 / pixelsPerSecond;
  return Math.min(lastStartMs, Math.max(0, Math.round(positionMs / 100) * 100));
}

export function moveTimelineAction(sequence: TimelineSequence, eventId: string, atMs: number): TimelineSequence {
  const event = sequence.events.find(item => item.id === eventId);
  if (!event || !Number.isInteger(atMs) || atMs < 0 || atMs >= sequence.durationMs) throw new Error('The action cannot be moved outside the timeline.');
  if (sequence.events.some(item => item.id !== eventId && item.lightId === event.lightId && item.atMs === atMs)) {
    throw new Error('There is already an action for this lamp at that time.');
  }
  return { ...sequence, events: sequence.events.map(item => item.id === eventId ? { ...item, atMs } : item) };
}


import { createAmbiancePlayback, type AmbianceMode } from './ambiance';
import type { AmbiancePlayback } from './background-ambiance';

export function createPlatformAmbiancePlayback(
  onChange: (modes: AmbianceMode[]) => void, onError: (name: string, error: unknown) => void,
): AmbiancePlayback {
  const playback = createAmbiancePlayback(onChange, onError);
  return {
    ...playback, attach: () => {},
    start: async (request, play, apply) => playback.start(request.description, play, apply),
    usesSequence: async id => playback.usesSequence(id),
  };
}

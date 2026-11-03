/**
 * Pose estimation page settings that are not tied to React.
 */

export interface InferenceOption {
  label: string;
  /** Seconds between automatic analyses; 0 = only when the user asks. */
  intervalSec: number;
}

/**
 * How often a frame is sent to the local service. Manual, 0.5 FPS and 1 FPS are the original options.
 * 2 FPS is added for activity recognition: movement is judged between frames, and running covers a lot of
 * ground in a second. Add or remove entries here to change what the page offers.
 */
export const INFERENCE_OPTIONS: readonly InferenceOption[] = [
  { label: 'Manual', intervalSec: 0 },
  { label: '0.5 FPS (2s)', intervalSec: 2 },
  { label: '1 FPS (1s)', intervalSec: 1 },
  { label: '2 FPS (0.5s)', intervalSec: 0.5 },
];

/**
 * An id for one video session. The service keeps one pose history per id, so the live camera of this tab
 * never mixes with another tab or with a one-off test frame. `crypto.randomUUID` only exists in secure
 * contexts (https / localhost), and the dashboard may be opened over plain http on the local network.
 */
export function createSessionId(
  cryptoImpl: { randomUUID?: () => string } | undefined = typeof crypto !== 'undefined' ? crypto : undefined,
  random: () => number = Math.random,
): string {
  const uuid = cryptoImpl?.randomUUID?.();
  if (uuid) return `pose-${uuid}`.slice(0, 64);
  const part = () => Math.floor(random() * 0xffffffff).toString(36);
  return `pose-${Date.now().toString(36)}-${part()}${part()}`.slice(0, 64);
}

/** The id for the one-off synthetic test frame: it must never feed the live camera's history. */
export function sampleSessionId(liveSessionId: string): string {
  return `${liveSessionId}-sample`.slice(0, 64);
}

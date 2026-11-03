/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiBackendStatus,
  AiCategory,
  AiErrorCode,
  FilterableCategory,
  RecognizedObject,
  TokenUsage,
} from '../../server/protocol';
import type { MotionSnapshotLink } from './motion';

// The contract with the backend is defined once, in server/protocol.ts, and re-exported here.
export * from '../../server/protocol';

export type AiTrigger = 'manual' | 'motion';

export interface AiSettings {
  /**
   * Master switch for external AI processing. OFF by default: while it is off no image ever
   * leaves this browser.
   */
  enabled: boolean;
  /** Analyze a frame automatically when Motion Detection raises an alert. Needs `autoAcknowledged`. */
  autoOnMotion: boolean;
  /** The user ticked the disclosure that images are sent to Groq. Required before automatic mode can be on. */
  autoAcknowledged: boolean;
  /** Which recognized categories count as an event worth keeping. */
  categories: Record<FilterableCategory, boolean>;
  /** Minimum time between two automatic (motion-triggered) analyses. */
  cooldownSec: number;
  /** Keep a gallery snapshot (Smart Snapshot) of the analyzed frame when the result matches the filters. */
  retainSnapshot: boolean;
}

export type AiEventStatus = 'success' | 'failed';

/** One recognition attempt. The picture itself is never stored here; only a link to the gallery. */
export interface AiEvent {
  id: string;
  /** When the request was made (epoch ms). */
  t: number;
  trigger: AiTrigger;
  status: AiEventStatus;
  model?: string;
  summary?: string;
  /** Success only. */
  objects: RecognizedObject[];
  /** The category the event is filed under: the first matching object's, else the first object's, else 'none'. */
  category: AiCategory | 'none';
  /** At least one confirmed (not uncertain) object is in a category the filters had switched on. */
  matched: boolean;
  snapshot: MotionSnapshotLink;
  /** The Motion Detection event that triggered it. */
  motionEventId?: string;
  /** Failure only. */
  error?: { code: AiErrorCode; message: string };
  latencyMs?: number;
  usage?: TokenUsage;
}

export type AiBackendState =
  /** Not asked yet. */
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'ready'; status: AiBackendStatus }
  /** The backend answers but has no Groq key configured. */
  | { kind: 'not-configured'; status?: AiBackendStatus }
  | { kind: 'unreachable'; message: string }
  | { kind: 'error'; message: string };

export interface AiRecognizerState {
  settings: AiSettings;
  backend: AiBackendState;
  /** A request is in flight. */
  analyzing: boolean;
  /** The newest outcome, shown in the result card. */
  current: AiEvent | null;
  /** The last problem that did not produce an event (frame blocked, too soon, backend down...). */
  notice: { kind: 'error' | 'info'; code?: AiErrorCode; message: string; action?: 'enable-capture' } | null;
  /** Why the last automatic trigger did nothing (cooldown, busy, blocked...), or null. */
  autoNote: string | null;
  /** Analyses sent to the backend since this page was loaded (not stored). */
  requestsThisSession: number;
  /** No request is made before this time (a rate limit or the quota). */
  blockedUntil: number | null;
  /** The next automatic analysis may run after this time. */
  autoCooldownUntil: number | null;
  /** Frame access was refused: automatic analyses are paused until the stream reconnects. */
  frameBlocked: boolean;
}

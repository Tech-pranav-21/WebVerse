/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type MotionSensitivity = 'low' | 'medium' | 'high';

/** The part of the picture that is watched. Everything outside it is ignored. */
export type MotionRegion = 'full' | 'center' | 'left' | 'right' | 'top' | 'bottom';

/**
 * OFF                 - not running
 * STARTING            - running, no frame has been compared yet (never shown as ACTIVE)
 * ACTIVE              - frames are being compared
 * MOTION DETECTED     - an alert fired a few seconds ago
 * PAUSED              - deliberately suspended: tab hidden, or the Live Stream view is not showing
 * CAMERA DISCONNECTED - the stream is not connected; resumes by itself when it reconnects
 * FRAME ACCESS BLOCKED- the browser refuses to let the page read the picture's pixels
 * ERROR               - the picture could not be decoded or read repeatedly
 */
export type MotionStatus =
  | 'off'
  | 'starting'
  | 'active'
  | 'motion'
  | 'paused'
  | 'camera-disconnected'
  | 'blocked'
  | 'error';

export interface MotionSettings {
  sensitivity: MotionSensitivity;
  /** Overrides the preset's minimum changed area (percent of the watched region). null = use the preset. */
  minChangedPercent: number | null;
  /** After an alert, no further alert for this long. */
  cooldownSec: number;
  /** Time between two checks of the picture. */
  intervalMs: number;
  /** An alert needs this many consecutive changed comparisons. */
  confirmFrames: number;
  region: MotionRegion;
  /** Save a gallery snapshot (Smart Snapshot) with each alert. */
  captureSnapshot: boolean;
}

export type MotionSnapshotStatus = 'off' | 'pending' | 'saved' | 'session-only' | 'failed' | 'skipped';

/** What happened to the optional snapshot of one motion event. */
export interface MotionSnapshotLink {
  status: MotionSnapshotStatus;
  /** The gallery item, when one was created. */
  snapshotId?: string;
  /** Why it failed or was skipped. */
  note?: string;
}

export interface MotionEvent {
  id: string;
  /** When the alert fired (epoch ms). */
  t: number;
  /** Measured change, percent of the watched region. */
  changedPercent: number;
  /** Minimum change that was in force. */
  thresholdPercent: number;
  /** Per-pixel noise tolerance that was in force (gray levels, 0-255). */
  pixelThreshold: number;
  sensitivity: MotionSensitivity;
  confirmFrames: number;
  region: MotionRegion;
  snapshot: MotionSnapshotLink;
}

export interface MotionState {
  status: MotionStatus;
  /** Plain-language explanation of the current status (why blocked, why paused, what it waits for...). */
  message: string | null;
  settings: MotionSettings;
  /** Change measured in the latest comparison, percent of the watched region. */
  lastChangedPercent: number | null;
  /** When the picture was last checked. */
  lastCheckAt: number | null;
  /** Comparisons made since the page was loaded. */
  framesCompared: number;
  /** Checks that found the very same picture as before and were skipped. */
  duplicateFramesSkipped: number;
  /** No new picture for a while: nothing can be detected without new frames. */
  framesStale: boolean;
  /** Alerts are suppressed until this time. */
  cooldownUntil: number | null;
  lastEvent: MotionEvent | null;
}

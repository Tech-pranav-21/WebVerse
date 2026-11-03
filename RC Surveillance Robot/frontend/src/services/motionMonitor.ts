/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MotionEvent, MotionSettings, MotionSnapshotLink, MotionState, MotionStatus } from '../types/motion';
import type { CaptureOutcome } from './snapshotActions';
import { Clock, systemClock } from './streamConnectionService';
import { SAMPLE_PIXELS, compareFrames, frameChecksum } from './motionDetector';
import { FrameSampler, SampleResult, isSampleFailure } from './frameSampler';
import { MotionHistory } from './motionHistory';
import { DEFAULT_MOTION_SETTINGS, effectiveParams, normalizeSettings } from './motionSettings';

/**
 * Motion detection, step 3: the supervisor. It owns the timer, the previous frame, the status the
 * user sees, and the rules that turn comparisons into alerts. Framework-free and fully injectable
 * (clock, frame sampler, visibility, history, snapshot capture) so every rule is testable.
 *
 * Lifecycle (also documented in the README):
 *  - start()  : begins checking, STARTING until two different frames have been compared.
 *  - The stream disconnects, or the Live Stream view is left (Snapshot mode):
 *               checking stops, the previous frame is thrown away, status CAMERA DISCONNECTED / PAUSED.
 *               When the stream is connected again it resumes by itself with a FRESH baseline, so a
 *               picture from before the gap is never compared with one after it.
 *  - The browser tab is hidden: PAUSED, same fresh-baseline resume when it is shown again.
 *  - The camera freezes (no new picture for 15 s) and then frames flow again: the first new picture
 *               is a fresh baseline, not compared with the one from before the freeze.
 *  - The pixels are unreadable (CORS): FRAME ACCESS BLOCKED, checking stops (no endless retries);
 *               it is retried when the stream reconnects or after Stop + Start.
 *  - stop() / shutdown(): timer cleared, canvas released, visibility listener removed.
 * There is only ever one pending timer (a setTimeout chain, not an interval).
 */

/** How long MOTION DETECTED stays on screen after an alert. */
export const MOTION_DISPLAY_MS = 4000;
/** This many failed checks in a row (nothing decodable) turn into ERROR and stop the checking. */
export const MAX_CONSECUTIVE_FAILURES = 10;
/** Without a new picture for this long (or 5 intervals, whichever is longer) the state says so. */
export const STALE_FRAMES_MS = 15_000;
/** A change smaller than this many sample pixels is never motion, whatever the percentages say. */
export const MIN_CHANGED_PIXELS = 4;

export interface VisibilityApi {
  isVisible(): boolean;
  subscribe(listener: () => void): () => void;
}

export const documentVisibility: VisibilityApi = {
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  subscribe: (listener) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

/** What the dashboard knows about the camera picture. */
export interface CameraInput {
  /** The Live Stream view is showing (only then does a stream element exist to read from). */
  viewing: boolean;
  /** The stream connection reports "connected". */
  connected: boolean;
  /** Short word for the connection state, used in messages ("reconnecting", "error"...). */
  statusLabel: string;
}

export interface MotionMonitorDeps {
  sampler: FrameSampler;
  history: MotionHistory;
  clock?: Clock;
  settings?: MotionSettings;
  /** Called with the new settings so they can be saved. */
  persistSettings?: (settings: MotionSettings) => void;
  visibility?: VisibilityApi;
  /** Takes a gallery snapshot for a new alert. Only called when the "capture snapshot" setting is on. */
  captureSnapshot?: () => Promise<MotionSnapshotLink>;
  /** Told about every new alert (for example the AI recognition panel). A failing listener changes nothing here. */
  onMotionEvent?: (event: MotionEvent) => void;
  makeId?: () => string;
}

const defaultMakeId = () => `mot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Describe what the Smart Snapshot service did, for the motion event's snapshot status. */
export function linkFromCaptureOutcome(outcome: CaptureOutcome): MotionSnapshotLink {
  switch (outcome.status) {
    case 'saved':
      return { status: 'saved', snapshotId: outcome.item.id };
    case 'session-only':
      return { status: 'session-only', snapshotId: outcome.item.id, note: outcome.error };
    case 'failed':
      return { status: 'failed', note: outcome.failure.message };
    default:
      return { status: 'skipped', note: 'Another snapshot was already being captured.' };
  }
}

export class MotionMonitor {
  private readonly clock: Clock;
  private readonly sampler: FrameSampler;
  private readonly history: MotionHistory;
  private readonly visibility: VisibilityApi;
  private readonly captureSnapshot?: () => Promise<MotionSnapshotLink>;
  private readonly onMotionEvent?: (event: MotionEvent) => void;
  private readonly persistSettings?: (settings: MotionSettings) => void;
  private readonly makeId: () => string;

  private settings: MotionSettings;
  private enabled = false;
  private camera: CameraInput = { viewing: false, connected: false, statusLabel: 'not connected' };
  private visible: boolean;
  private unsubscribeVisibility: (() => void) | null = null;

  // the single timer chain
  private timer: unknown = null;
  private loopId = 0;

  // per-run state (thrown away whenever checking is suspended)
  private prev = new Uint8Array(SAMPLE_PIXELS);
  private curr = new Uint8Array(SAMPLE_PIXELS);
  private hasBaseline = false;
  private lastChecksum = 0;
  private hits = 0;
  private failures = 0;
  private blocked = false;
  private errorMessage: string | null = null;
  private comparedThisRun = 0;
  private runStartedAt = 0;
  private lastNewFrameAt: number | null = null;
  private motionUntil = 0;

  // kept across runs
  private cooldownUntil = 0;
  private framesCompared = 0;
  private duplicates = 0;
  private lastChangedPercent: number | null = null;
  private lastCheckAt: number | null = null;
  private lastEvent: MotionEvent | null = null;
  private snapshotInFlight = false;

  private listeners = new Set<() => void>();
  private state: MotionState;

  constructor(deps: MotionMonitorDeps) {
    this.clock = deps.clock ?? systemClock;
    this.sampler = deps.sampler;
    this.history = deps.history;
    this.visibility = deps.visibility ?? documentVisibility;
    this.captureSnapshot = deps.captureSnapshot;
    this.onMotionEvent = deps.onMotionEvent;
    this.persistSettings = deps.persistSettings;
    this.makeId = deps.makeId ?? defaultMakeId;
    this.settings = normalizeSettings(deps.settings ?? DEFAULT_MOTION_SETTINGS);
    this.visible = this.visibility.isVisible();
    this.state = this.computeState();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Same object until something changes (the contract of useSyncExternalStore). */
  getSnapshot = (): MotionState => this.state;

  // -------------------------------------------------------------- controls --

  /** Start Detection. A second call while it is running does nothing, so there is never a second loop. */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.visible = this.visibility.isVisible();
    this.unsubscribeVisibility = this.visibility.subscribe(this.onVisibilityChange);
    this.resume();
  }

  /** Stop Detection: timer cleared, canvas released, listener removed. Safe to call at any time. */
  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    this.cancelTimer();
    this.resetRun();
    this.sampler.release();
    this.cooldownUntil = 0;
    this.publish();
  }

  /** Release everything (component unmount). The monitor can be started again afterwards. */
  shutdown(): void {
    this.stop();
  }

  configure(patch: Partial<MotionSettings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    this.persistSettings?.(this.settings);
    this.hits = 0;
    // A new interval applies at once instead of after the old, possibly long, wait.
    if (this.enabled && this.timer !== null) this.schedule(this.settings.intervalMs);
    this.publish();
  }

  /** What the dashboard knows about the camera picture. Call whenever it changes. */
  setCamera(input: CameraInput): void {
    const prev = this.camera;
    this.camera = { ...input };
    if (!this.enabled) return;
    if (prev.viewing !== input.viewing || prev.connected !== input.connected) {
      if (input.viewing && input.connected) this.resume();
      else this.suspend();
    } else if (prev.statusLabel !== input.statusLabel) {
      this.publish();
    }
  }

  // ------------------------------------------------------------- lifecycle --

  private readonly onVisibilityChange = (): void => {
    const visible = this.visibility.isVisible();
    if (!this.enabled || visible === this.visible) return;
    this.visible = visible;
    if (visible) this.resume();
    else this.suspend();
  };

  /** Stop checking and forget the previous frame; the status explains why. */
  private suspend(): void {
    this.cancelTimer();
    this.resetRun();
    this.sampler.release();
    this.publish();
  }

  /** (Re)start checking with a fresh baseline, if the picture can be read right now. */
  private resume(): void {
    if (!this.enabled) return;
    this.cancelTimer();
    this.resetRun();
    if (this.camera.viewing && this.camera.connected && this.visible) {
      this.runStartedAt = this.clock.now();
      this.schedule(0);
    }
    this.publish();
  }

  /** No new picture for this long means the camera froze (or the scene is perfectly still). */
  private staleAfterMs(): number {
    return Math.max(STALE_FRAMES_MS, this.settings.intervalMs * 5);
  }

  private resetRun(): void {
    this.hasBaseline = false;
    this.hits = 0;
    this.failures = 0;
    this.blocked = false;
    this.errorMessage = null;
    this.comparedThisRun = 0;
    this.lastNewFrameAt = null;
    this.motionUntil = 0;
  }

  private cancelTimer(): void {
    this.loopId++; // invalidates a tick that is already queued
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    this.cancelTimer();
    const id = this.loopId;
    this.timer = this.clock.setTimeout(() => this.tick(id), delayMs);
  }

  /** Checking stops but stays "enabled": status BLOCKED/ERROR, until a reconnect or Stop + Start. */
  private haltChecking(): void {
    this.cancelTimer();
    this.sampler.release();
  }

  // ------------------------------------------------------------------ tick --

  private tick(id: number): void {
    if (id !== this.loopId || !this.enabled) return;
    this.timer = null;
    try {
      const result = this.sampler.sample(this.curr);
      if (isSampleFailure(result)) {
        if (this.onSampleFailure(result)) return; // checking was halted
      } else {
        this.failures = 0;
        this.onFrame(this.clock.now());
      }
    } catch (err) {
      this.errorMessage = `Unexpected error while reading the picture: ${err instanceof Error ? err.message : String(err)}`;
      this.haltChecking();
      this.publish();
      return;
    }
    this.lastCheckAt = this.clock.now();
    this.schedule(this.settings.intervalMs);
    this.publish();
  }

  /** Returns true if checking was halted. */
  private onSampleFailure(result: Extract<SampleResult, { ok: false }>): boolean {
    if (result.kind === 'blocked') {
      this.blocked = true;
      this.haltChecking();
      this.publish();
      return true;
    }
    if (result.kind === 'canvas-unavailable') {
      this.errorMessage = result.message;
      this.haltChecking();
      this.publish();
      return true;
    }
    this.failures++;
    if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
      this.errorMessage = `No readable picture for ${this.failures} checks in a row. ${result.message}${result.detail ? ` (${result.detail})` : ''}`;
      this.haltChecking();
      this.publish();
      return true;
    }
    return false;
  }

  private onFrame(now: number): void {
    const checksum = frameChecksum(this.curr);
    if (this.hasBaseline && checksum === this.lastChecksum) {
      this.duplicates++; // the very same picture as last time: nothing to compare
      return;
    }
    // After a long freeze the previous picture is too old to compare with: what changed in between
    // cannot be told apart from motion. Start over from this picture instead (same rule as a reconnect).
    const frozeFor = this.lastNewFrameAt == null ? 0 : now - this.lastNewFrameAt;
    if (this.hasBaseline && frozeFor > this.staleAfterMs()) this.hits = 0;
    else if (this.hasBaseline) this.evaluate(now);
    this.lastNewFrameAt = now;
    this.lastChecksum = checksum;
    this.hasBaseline = true;
    [this.prev, this.curr] = [this.curr, this.prev]; // the newest picture becomes the previous one, no copying
  }

  private evaluate(now: number): void {
    const { pixelThreshold, minChangedPercent } = effectiveParams(this.settings);
    const result = compareFrames(this.prev, this.curr, { pixelThreshold, region: this.settings.region });
    this.lastChangedPercent = result.changedPercent;
    this.framesCompared++;
    this.comparedThisRun++;

    const changed = result.changedPixels >= MIN_CHANGED_PIXELS && result.changedPercent >= minChangedPercent;
    this.hits = changed ? this.hits + 1 : 0;
    if (this.hits >= this.settings.confirmFrames && now >= this.cooldownUntil) {
      this.fire(now, result.changedPercent, minChangedPercent, pixelThreshold);
    }
  }

  // ----------------------------------------------------------------- alerts --

  private fire(now: number, changedPercent: number, thresholdPercent: number, pixelThreshold: number): void {
    const wantSnapshot = this.settings.captureSnapshot && Boolean(this.captureSnapshot);
    const event: MotionEvent = {
      id: this.makeId(),
      t: now,
      changedPercent: round1(changedPercent),
      thresholdPercent: round1(thresholdPercent),
      pixelThreshold,
      sensitivity: this.settings.sensitivity,
      confirmFrames: this.settings.confirmFrames,
      region: this.settings.region,
      snapshot: { status: wantSnapshot ? 'pending' : 'off' },
    };
    this.cooldownUntil = now + this.settings.cooldownSec * 1000;
    this.motionUntil = now + MOTION_DISPLAY_MS;
    this.hits = 0;
    this.lastEvent = event;
    this.history.add(event);
    try {
      this.onMotionEvent?.({ ...event, snapshot: { ...event.snapshot } });
    } catch {
      // a listener's problem is not the detector's problem
    }
    if (wantSnapshot) this.startSnapshot(event.id);
  }

  /** At most one snapshot at a time; an alert never queues a second one. */
  private startSnapshot(eventId: string): void {
    const capture = this.captureSnapshot;
    if (!capture) return;
    if (this.snapshotInFlight) {
      this.setLink(eventId, { status: 'skipped', note: 'The previous snapshot was still being captured.' });
      return;
    }
    this.snapshotInFlight = true;
    void (async () => {
      let link: MotionSnapshotLink;
      try {
        link = await capture();
      } catch (err) {
        link = { status: 'failed', note: `Snapshot error: ${err instanceof Error ? err.message : String(err)}` };
      } finally {
        this.snapshotInFlight = false;
      }
      this.setLink(eventId, link);
    })();
  }

  private setLink(eventId: string, link: MotionSnapshotLink): void {
    this.history.updateSnapshot(eventId, link);
    if (this.lastEvent && this.lastEvent.id === eventId) {
      this.lastEvent = { ...this.lastEvent, snapshot: link };
      this.publish();
    }
  }

  // ----------------------------------------------------------------- state --

  private publish(): void {
    this.state = this.computeState();
    for (const listener of [...this.listeners]) listener();
  }

  private computeState(): MotionState {
    const now = this.clock.now();
    let status: MotionStatus;
    let message: string | null = null;

    if (!this.enabled) {
      status = 'off';
    } else if (!this.camera.viewing) {
      status = 'paused';
      message = 'Paused: motion detection needs the live picture, and the Live Stream view is not showing. It resumes when you return to it.';
    } else if (!this.camera.connected) {
      status = 'camera-disconnected';
      message = `The camera stream is not connected (${this.camera.statusLabel}). Nothing is compared while it is down; detection resumes by itself when it reconnects.`;
    } else if (!this.visible) {
      status = 'paused';
      message = 'Paused while this browser tab is hidden. It resumes with a fresh comparison when the tab is shown again.';
    } else if (this.blocked) {
      status = 'blocked';
      message = 'The browser will not let this page read the live picture (cross-origin security), so motion cannot be measured.';
    } else if (this.errorMessage) {
      status = 'error';
      message = this.errorMessage;
    } else if (this.comparedThisRun === 0) {
      status = 'starting';
      message = this.hasBaseline
        ? 'First frame captured. Waiting for a different frame to compare.'
        : 'Waiting for the first camera frame.';
    } else if (now < this.motionUntil) {
      status = 'motion';
    } else {
      status = 'active';
    }

    const running = status === 'starting' || status === 'active' || status === 'motion';
    const sinceFrame = now - (this.lastNewFrameAt ?? this.runStartedAt);
    const framesStale = running && sinceFrame > this.staleAfterMs();
    if (framesStale) {
      message = `No new camera picture for ${Math.round(sinceFrame / 1000)} s. Motion cannot be detected without new frames (the camera may be stalled, or the scene is perfectly still).`;
    }

    return {
      status,
      message,
      settings: { ...this.settings },
      lastChangedPercent: this.lastChangedPercent,
      lastCheckAt: this.lastCheckAt,
      framesCompared: this.framesCompared,
      duplicateFramesSkipped: this.duplicates,
      framesStale,
      cooldownUntil: now < this.cooldownUntil ? this.cooldownUntil : null,
      lastEvent: this.lastEvent ? { ...this.lastEvent, snapshot: { ...this.lastEvent.snapshot } } : null,
    };
  }
}

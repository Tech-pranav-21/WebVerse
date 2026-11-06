/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiBackendStatus,
  AiCategory,
  AiErrorCode,
  FilterableCategory,
  RecognizeSuccess,
  RecognizedObject,
} from '../../server/protocol';
import type { AiBackendState, AiEvent, AiRecognizerState, AiSettings, AiTrigger } from '../types/ai';
import type { MotionEvent, MotionSnapshotLink } from '../types/motion';
import { AiClient, AiClientError } from './aiClient';
import { AiHistory } from './aiHistory';
import { DEFAULT_AI_SETTINGS, MANUAL_MIN_INTERVAL_MS, normalizeAiSettings } from './aiSettings';
import type { CapturedFrame } from './frameCapture';
import { Clock, systemClock } from './streamConnectionService';

/**
 * AI recognition supervisor (framework-free, fully injectable).
 *
 * It decides WHEN a picture may be sent to Groq (through our own backend), never WHAT is in it:
 *  - nothing is sent unless the master switch is on, and automatic analysis also needs the
 *    privacy acknowledgement;
 *  - at most one request at a time; a second trigger while one runs is dropped, not queued;
 *  - motion-triggered analyses are spaced by a cooldown, and one motion alert is analysed once;
 *  - a rate-limit or quota answer blocks further requests for the time the server named;
 *  - a response that arrives after cancel() / switching the feature off is ignored;
 *  - one trigger is at most one request: there is no retry loop here (the backend retries only
 *    transient errors, once).
 */

export const DEFAULT_MAX_IMAGE_BYTES = 1_500_000;
/** Used when a rate limit names no wait. */
const DEFAULT_RATE_LIMIT_WAIT_SEC = 30;
const DEFAULT_QUOTA_WAIT_SEC = 600;
const MAX_BLOCK_SEC = 24 * 3600;
const REMEMBERED_MOTION_EVENTS = 30;

export type FrameOutcome =
  | { ok: true; frame: CapturedFrame }
  | { ok: false; blocked: boolean; message: string; action?: 'enable-capture' };

export function isFrameFailure(result: FrameOutcome): result is { ok: false; blocked: boolean; message: string; action?: 'enable-capture' } {
  return !result.ok;
}

export type SkipReason =
  | 'disabled'
  | 'auto-off'
  | 'busy'
  | 'cooldown'
  | 'too-soon'
  | 'blocked-until'
  | 'frame-blocked'
  | 'backend-unavailable'
  | 'duplicate-event'
  | 'cancelled';

export type AnalyzeOutcome =
  | { status: 'done'; event: AiEvent }
  | { status: 'skipped'; reason: SkipReason; message: string }
  | { status: 'failed'; message: string; event?: AiEvent };

export interface AiRecognizerDeps {
  client: Pick<AiClient, 'status' | 'recognize'>;
  history: AiHistory;
  /** Read the picture that is on screen now (and say why not, if it cannot be read). */
  getFrame: () => Promise<FrameOutcome>;
  /** Save the analysed frame to the gallery (Smart Snapshot). Called only for matching events when the setting is on. */
  saveSnapshot?: (frame: CapturedFrame) => Promise<MotionSnapshotLink>;
  clock?: Clock;
  settings?: AiSettings;
  persistSettings?: (settings: AiSettings) => void;
  makeId?: () => string;
}

const defaultMakeId = () => `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Does the result contain something worth an event: a CONFIRMED object in a category that is switched on? */
export function matchesFilters(objects: RecognizedObject[], categories: Record<FilterableCategory, boolean>): boolean {
  return objects.some((o) => !o.uncertain && o.category !== 'unknown' && categories[o.category]);
}

/** The category an event is filed under: the first matching object's, else the first object's, else none. */
export function primaryCategory(objects: RecognizedObject[], categories: Record<FilterableCategory, boolean>): AiCategory | 'none' {
  const hit = objects.find((o) => !o.uncertain && o.category !== 'unknown' && categories[o.category]);
  return (hit ?? objects[0])?.category ?? 'none';
}

function describeError(err: unknown): AiClientError {
  return err instanceof AiClientError ? err : new AiClientError('internal_error', 'An unexpected error stopped the analysis.');
}

export class AiRecognizer {
  private readonly client: AiRecognizerDeps['client'];
  private readonly history: AiHistory;
  private readonly getFrame: AiRecognizerDeps['getFrame'];
  private readonly saveSnapshot?: AiRecognizerDeps['saveSnapshot'];
  private readonly clock: Clock;
  private readonly persistSettings?: (settings: AiSettings) => void;
  private readonly makeId: () => string;

  private settings: AiSettings;
  private inFlight: AbortController | null = null;
  /** Bumped by cancel(): anything started under an older number is stale and ignored. */
  private generation = 0;
  private lastManualAt = -Infinity;
  private seenMotion: string[] = [];
  private lastStatus: AiBackendStatus | null = null;
  private statusInFlight: Promise<void> | null = null;

  private listeners = new Set<() => void>();
  private state: AiRecognizerState;

  constructor(deps: AiRecognizerDeps) {
    this.client = deps.client;
    this.history = deps.history;
    this.getFrame = deps.getFrame;
    this.saveSnapshot = deps.saveSnapshot;
    this.clock = deps.clock ?? systemClock;
    this.persistSettings = deps.persistSettings;
    this.makeId = deps.makeId ?? defaultMakeId;
    this.settings = normalizeAiSettings(deps.settings ?? DEFAULT_AI_SETTINGS);
    this.state = {
      settings: this.settings,
      backend: { kind: 'unknown' },
      analyzing: false,
      current: null,
      notice: null,
      autoNote: null,
      requestsThisSession: 0,
      blockedUntil: null,
      autoCooldownUntil: null,
      frameBlocked: false,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Same object until something changes (the contract of useSyncExternalStore). */
  getSnapshot = (): AiRecognizerState => this.state;

  // -------------------------------------------------------------- settings --

  configure(patch: Partial<AiSettings>): void {
    const next = normalizeAiSettings({ ...this.settings, ...patch, categories: { ...this.settings.categories, ...(patch.categories ?? {}) } });
    const switchedOff = this.settings.enabled && !next.enabled;
    this.settings = next;
    this.persistSettings?.(next);
    if (switchedOff) this.cancel(); // switching the feature off also drops an answer that is still on its way
    this.set({ settings: next, ...(next.enabled ? {} : { notice: null, autoNote: null }) });
  }

  /** The stream reconnected: reading the picture may work now, so automatic analysis may try again. */
  notifyStreamReconnected(): void {
    if (this.state.frameBlocked) this.set({ frameBlocked: false, autoNote: null });
  }

  // --------------------------------------------------------------- backend --

  /** Ask the backend whether it is running and has a key. Never sends an image. */
  refreshBackend(): Promise<void> {
    if (this.statusInFlight) return this.statusInFlight;
    this.set({ backend: { kind: 'checking' } });
    this.statusInFlight = (async () => {
      try {
        const status = await this.client.status();
        this.lastStatus = status;
        // A banner about the backend being down or unconfigured is out of date once it answers.
        const stale = this.state.notice?.code === 'backend_unreachable' || this.state.notice?.code === 'timeout' || this.state.notice?.code === 'not_configured';
        this.set({
          backend: status.configured ? { kind: 'ready', status } : { kind: 'not-configured', status },
          ...(stale && status.configured ? { notice: null } : {}),
        });
      } catch (err) {
        const e = describeError(err);
        this.set({
          backend: e.code === 'backend_unreachable' || e.code === 'timeout' ? { kind: 'unreachable', message: e.message } : { kind: 'error', message: e.message },
        });
      } finally {
        this.statusInFlight = null;
      }
    })();
    return this.statusInFlight;
  }

  // -------------------------------------------------------------- triggers --

  /** "Analyze Current Frame": one picture, one request. */
  analyzeNow(): Promise<AnalyzeOutcome> {
    return this.run('manual');
  }

  /** A Motion Detection alert. Analysed only if automatic mode is on, the cooldown allows it, and it has not been seen before. */
  async handleMotionEvent(event: MotionEvent): Promise<AnalyzeOutcome> {
    if (this.seenMotion.includes(event.id)) {
      return { status: 'skipped', reason: 'duplicate-event', message: 'This motion alert was already handled.' };
    }
    this.seenMotion.push(event.id);
    if (this.seenMotion.length > REMEMBERED_MOTION_EVENTS) this.seenMotion.shift();

    if (!this.settings.enabled || !this.settings.autoOnMotion) {
      return { status: 'skipped', reason: 'auto-off', message: 'Automatic recognition is off.' };
    }
    return this.run('motion', event);
  }

  /** Abort a request in flight and ignore its answer, whenever it arrives. */
  cancel(): void {
    this.generation++;
    this.inFlight?.abort();
    this.inFlight = null;
    if (this.state.analyzing) this.set({ analyzing: false });
  }

  shutdown(): void {
    this.cancel();
  }

  // ------------------------------------------------------------------- run --

  private async run(trigger: AiTrigger, motion?: MotionEvent): Promise<AnalyzeOutcome> {
    const now = this.clock.now();
    const s = this.settings;

    if (!s.enabled) return this.skip('disabled', 'AI recognition is switched off.', trigger);
    if (this.inFlight) return this.skip('busy', 'An analysis is already running.', trigger);
    const blockedUntil = this.state.blockedUntil;
    if (blockedUntil !== null && now < blockedUntil) {
      return this.skip('blocked-until', `Groq asked for a pause: try again in ${Math.ceil((blockedUntil - now) / 1000)} s.`, trigger);
    }
    if (trigger === 'manual' && now - this.lastManualAt < MANUAL_MIN_INTERVAL_MS) {
      return { status: 'skipped', reason: 'too-soon', message: 'Please wait a moment between analyses.' };
    }
    if (trigger === 'motion') {
      if (this.state.frameBlocked) {
        return this.skip('frame-blocked', 'Automatic analysis is paused: the browser blocked reading the picture. It resumes when the stream reconnects.', trigger);
      }
      const kind = this.state.backend.kind;
      if (kind === 'not-configured' || kind === 'unreachable') {
        return this.skip('backend-unavailable', 'Automatic analysis is paused: the AI backend is not available.', trigger);
      }
      const cooldownUntil = this.state.autoCooldownUntil;
      if (cooldownUntil !== null && now < cooldownUntil) {
        return this.skip('cooldown', `Skipped: AI cooldown, ${Math.ceil((cooldownUntil - now) / 1000)} s left.`, trigger);
      }
    }

    const gen = this.generation;
    const controller = new AbortController();
    this.inFlight = controller;
    if (trigger === 'manual') this.lastManualAt = now;
    this.set({ analyzing: true, notice: null, ...(trigger === 'motion' ? { autoNote: null } : {}) });

    try {
      const frameOutcome = await this.getFrame();
      if (gen !== this.generation) return this.stale();
      if (isFrameFailure(frameOutcome)) {
        this.set({
          ...(frameOutcome.blocked ? { frameBlocked: true } : {}),
          notice: { kind: 'error', code: frameOutcome.blocked ? 'frame_blocked' : 'frame_unavailable', message: frameOutcome.message, action: frameOutcome.action },
          ...(trigger === 'motion' ? { autoNote: `Could not read the picture: ${frameOutcome.message}` } : {}),
        });
        return { status: 'failed', message: frameOutcome.message };
      }

      const frame = frameOutcome.frame;
      const maxBytes = this.lastStatus?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
      if (frame.blob.size > maxBytes) {
        const message = `The picture is ${Math.round(frame.blob.size / 1024)} kB, over the ${Math.round(maxBytes / 1024)} kB limit, so it was not sent.`;
        this.set({ notice: { kind: 'error', code: 'image_too_large', message } });
        return { status: 'failed', message };
      }

      // From here on a request is made. The cooldown starts now, so a failure cannot trigger a retry storm.
      this.set({
        requestsThisSession: this.state.requestsThisSession + 1,
        ...(trigger === 'motion' ? { autoCooldownUntil: now + s.cooldownSec * 1000 } : {}),
      });

      let response: RecognizeSuccess;
      try {
        response = await this.client.recognize(
          frame.blob,
          { provider: s.provider, model: s.model },
          controller.signal,
        );
      } catch (err) {
        return this.onClientError(describeError(err), trigger, motion, gen, now);
      }
      if (gen !== this.generation) return this.stale();

      return await this.onSuccess(response, frame, trigger, motion, gen, now);
    } finally {
      if (gen === this.generation) {
        this.inFlight = null;
        if (this.state.analyzing) this.set({ analyzing: false });
      }
    }
  }

  private async onSuccess(
    response: RecognizeSuccess,
    frame: CapturedFrame,
    trigger: AiTrigger,
    motion: MotionEvent | undefined,
    gen: number,
    startedAt: number,
  ): Promise<AnalyzeOutcome> {
    const s = this.settings;
    const objects = response.result.objects;
    const matched = matchesFilters(objects, s.categories);

    let link: MotionSnapshotLink = { status: 'off' };
    if (matched && s.retainSnapshot && this.saveSnapshot) {
      if (motion && (motion.snapshot.status === 'pending' || motion.snapshot.status === 'saved')) {
        // Motion Detection is already keeping a picture for this alert: a second one would only duplicate it.
        link = { status: 'skipped', note: 'Motion Detection already saves a snapshot for this alert (see the motion event).' };
      } else {
        try {
          link = await this.saveSnapshot(frame);
        } catch (err) {
          link = { status: 'failed', note: `Snapshot error: ${err instanceof Error ? err.message : String(err)}` };
        }
        if (gen !== this.generation) return this.stale();
      }
    }

    const event: AiEvent = {
      id: this.makeId(),
      t: startedAt,
      trigger,
      status: 'success',
      provider: response.provider || s.provider,
      model: response.model,
      summary: response.result.summary,
      objects,
      category: primaryCategory(objects, s.categories),
      matched,
      snapshot: link,
      latencyMs: response.latencyMs,
      ...(response.usage ? { usage: response.usage } : {}),
      ...(motion ? { motionEventId: motion.id } : {}),
    };
    this.history.add(event);
    this.set({ current: event, notice: null, ...(trigger === 'motion' ? { autoNote: null } : {}) });
    return { status: 'done', event };
  }

  private onClientError(e: AiClientError, trigger: AiTrigger, motion: MotionEvent | undefined, gen: number, startedAt: number): AnalyzeOutcome {
    if (e.code === 'cancelled' || gen !== this.generation) return this.stale();

    let message = e.message;
    const patch: Partial<AiRecognizerState> = {};
    if (e.code === 'rate_limited' || e.code === 'quota_exhausted') {
      const fallback = e.code === 'quota_exhausted' ? DEFAULT_QUOTA_WAIT_SEC : DEFAULT_RATE_LIMIT_WAIT_SEC;
      const waitSec = Math.min(MAX_BLOCK_SEC, Math.max(1, e.retryAfterSec ?? fallback));
      const until = this.clock.now() + waitSec * 1000;
      patch.blockedUntil = until;
      if (trigger === 'motion') patch.autoCooldownUntil = Math.max(this.state.autoCooldownUntil ?? 0, until);
      message = `${e.message} Waiting ${waitSec >= 120 ? `${Math.round(waitSec / 60)} min` : `${waitSec} s`} before the next request.`;
    }
    if (e.code === 'backend_unreachable' || e.code === 'timeout') patch.backend = { kind: 'unreachable', message: e.message };
    if (e.code === 'not_configured') patch.backend = { kind: 'not-configured', status: this.lastStatus ?? undefined };

    const event: AiEvent = {
      id: this.makeId(),
      t: startedAt,
      trigger,
      status: 'failed',
      provider: this.settings.provider,
      model: this.settings.model,
      objects: [],
      category: 'none',
      matched: false,
      snapshot: { status: 'off' },
      error: { code: e.code as AiErrorCode, message },
      ...(motion ? { motionEventId: motion.id } : {}),
    };
    this.history.add(event);
    this.set({ ...patch, current: event, notice: { kind: 'error', code: e.code, message } });
    return { status: 'failed', message, event };
  }

  private stale(): AnalyzeOutcome {
    return { status: 'skipped', reason: 'cancelled', message: 'The analysis was cancelled; its answer was ignored.' };
  }

  /** Explain why nothing was sent: a banner for a manual click, a quiet note for an automatic trigger. */
  private skip(reason: SkipReason, message: string, trigger: AiTrigger): AnalyzeOutcome {
    if (trigger === 'motion') this.set({ autoNote: message });
    else if (reason !== 'busy') this.set({ notice: { kind: 'info', message } });
    return { status: 'skipped', reason, message };
  }

  private set(patch: Partial<AiRecognizerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

/** Convenience for the UI: whether the backend state means "a request can be made". */
export function backendUsable(backend: AiBackendState): boolean {
  return backend.kind === 'ready' || backend.kind === 'unknown' || backend.kind === 'checking';
}

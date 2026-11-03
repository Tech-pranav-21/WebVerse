/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ConnectionStatus,
  FrameStats,
  HostProbeSample,
  HostProbeTrigger,
  HostReachability,
  InterruptedRecovery,
  LastRecovery,
  RecoveryInfo,
  StreamEvent,
  StreamEventLevel,
  StreamFailureKind,
  StreamHealth,
  StreamMode,
} from '../types/camera';
import { ConnectionHistory } from './connectionHistory';

/**
 * StreamConnection - the single owner of the live-stream connection and its status.
 *
 * Why this exists (see PHASE1_STABILITY_REPORT.md for the evidence):
 *  - A plain <img> MJPEG stream reports only its FIRST frame (one `load` event). A stall, a
 *    reset or a corrupt frame later on raises no event, so the old code kept saying "Connected".
 *  - Removing an <img> does not close its connection, and re-using the same URL can re-attach to
 *    the old (possibly stalled) request or to a cached copy. "Reconnect" therefore often did
 *    nothing. This class closes the old connection explicitly before opening a new one.
 *  - Status used to be written by several independent async paths (probe, <img> events), so a
 *    late result could overwrite newer evidence. Here every transport event carries an attempt
 *    id and anything from a superseded attempt is ignored.
 *
 * It contains no DOM or React code. Time and the transport are injected so every behaviour can
 * be unit tested with a fake clock (tests/streamConnection.test.ts).
 */

// ---------------------------------------------------------------- injection --

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface StreamCallbacks {
  /** The first decodable frame of this session arrived. */
  onFirstFrame(): void;
  /** Another frame arrived (only transports with frame-level visibility call this). */
  onFrame?(): void;
  /** The session failed (refused, reset, HTTP error, unreadable...). */
  onError(message: string): void;
  /** The camera ended the response cleanly. */
  onEnded?(message: string): void;
}

export interface StreamSession {
  /** Stop everything for this session and release the network connection. Idempotent. */
  close(): void;
  /**
   * Optional cheap check polled while connected. 'broken' means the element that should show
   * the stream holds no decodable image (observed after a connection reset or a corrupt frame).
   */
  poll?(): 'ok' | 'broken';
}

export interface StreamTransport {
  open(url: string, callbacks: StreamCallbacks): StreamSession;
}

export interface HostProbeResult {
  reachable: boolean;
  /** Browser request time until the camera answered or the request failed (see connectionService). */
  latencyMs?: number;
  error?: string;
  /**
   * Why it failed. 'cancelled' means the caller aborted it; that is not a measurement and is
   * never recorded as a failure.
   */
  failure?: 'timeout' | 'network' | 'cancelled';
}

// ------------------------------------------------------------------- policy --

export interface StreamPolicy {
  /** No first frame within this time counts as a failed attempt. */
  connectTimeoutMs: number;
  /** Monitor mode: no frame for this long while connected counts as a stall. */
  stallTimeoutMs: number;
  /** Plain <img> mode: an undecodable image for this long counts as a lost display. */
  brokenDisplayGraceMs: number;
  /** A connection that survives this long resets the retry counter. */
  stableAfterMs: number;
  /** Automatic retries before giving up (manual Reconnect always works). */
  maxRetries: number;
  maxDelayMs: number;
  /** Ignore a second manual Reconnect that arrives this soon after the first. */
  manualDebounceMs: number;
  tickMs: number;
  /** Time limit of one camera-reachability request (Phase 2: passed to the probe). */
  hostProbeTimeoutMs: number;
  /** Smallest interval for the opt-in periodic reachability measurement. */
  autoMeasureMinMs: number;
}

export const DEFAULT_STREAM_POLICY: StreamPolicy = {
  connectTimeoutMs: 8000,
  stallTimeoutMs: 5000,
  brokenDisplayGraceMs: 2000,
  stableAfterMs: 10000,
  maxRetries: 6,
  maxDelayMs: 60000,
  manualDebounceMs: 1000,
  tickMs: 1000,
  hostProbeTimeoutMs: 2500,
  autoMeasureMinMs: 5000,
};

export interface StreamTarget {
  /** Camera base URL (used only for the reachability probe). */
  baseUrl: string;
  baseConfigured: boolean;
  /** Fully resolved stream URL, '' when no stream path is configured. */
  url: string;
  mode: StreamMode;
  mixedContent: boolean;
  autoReconnect: boolean;
  /** First retry delay; doubles on every consecutive failure up to policy.maxDelayMs. */
  baseDelayMs: number;
  /**
   * Smart Snapshot: the stream is requested with CORS so frames can be captured. Changing it
   * reconnects, because an <img> only honours `crossorigin` when it is set before the source.
   */
  corsCapture?: boolean;
}

export interface StreamConnectionOptions {
  clock?: Clock;
  policy?: Partial<StreamPolicy>;
  /** Returns a transport for the mode, or null when nothing can display a stream right now. */
  createTransport: (mode: StreamMode) => StreamTransport | null;
  /** Camera-host reachability check. Result is stored separately and never changes stream status. */
  probeHost?: (baseUrl: string, signal: AbortSignal, timeoutMs?: number) => Promise<HostProbeResult>;
  /** Phase 2: the persisted connection history. Defaults to an in-memory one. */
  history?: ConnectionHistory;
  /** Phase 2: identifies this page load in the history ('Dashboard opened' marker). */
  sessionId?: string;
  /** Phase 2: periodic measurements are skipped while this returns false (hidden tab). */
  isPageVisible?: () => boolean;
}

type Phase = 'idle' | 'connecting' | 'connected' | 'waiting-retry' | 'failed';
type StartReason = 'initial' | 'retry' | 'manual';

const MAX_EVENTS = 100;
const MAX_HOST_SAMPLES = 30;
const FPS_WINDOW_MS = 5_000;
const GAP_WINDOW_MS = 5 * 60_000;
const MIN_RECORDED_GAP_MS = 250;
const MIXED_CONTENT_MESSAGE =
  'The browser blocks this HTTPS page from loading an HTTP camera (mixed content). Open the dashboard over plain HTTP.';
const HOST_PROBE_BLOCKED_MESSAGE =
  'The browser blocks requests from this HTTPS page to an HTTP camera (mixed content), so camera reachability cannot be measured. Open the dashboard over plain HTTP.';

// ------------------------------------------------------------------- class --

export class StreamConnection {
  private readonly clock: Clock;
  private readonly policy: StreamPolicy;
  private readonly opts: StreamConnectionOptions;

  private listeners = new Set<() => void>();
  private snapshot: StreamHealth;

  // inputs
  private target: StreamTarget = {
    baseUrl: '',
    baseConfigured: false,
    url: '',
    mode: 'img',
    mixedContent: false,
    autoReconnect: true,
    baseDelayMs: 5000,
  };
  private viewing = false;
  private elementAvailable = false;
  private configured = false;

  // runtime state
  private phase: Phase = 'idle';
  private session: StreamSession | null = null;
  private attemptId = 0;
  private attemptSeq = 0;
  private attemptStartedAt = 0;
  private lastStartReason: StartReason = 'initial';
  private attemptIsRetry = false;
  private retriesUsed = 0;
  private totalReconnects = 0;
  private everConnected = false;
  private connectedSince: number | null = null;
  private lastFrameAt: number | null = null;
  private brokenSince: number | null = null;
  /** Timestamps of frames in the last FPS_WINDOW_MS (monitor mode). */
  private recentFrames: number[] = [];
  /** Gaps between consecutive frames (>= MIN_RECORDED_GAP_MS) in the last GAP_WINDOW_MS. */
  private gaps: Array<{ at: number; ms: number }> = [];
  /** Time of the previous frame for gap measurement; null after the stream was closed on purpose. */
  private gapBaseline: number | null = null;
  private framesTotal = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private nextRetryAt: number | null = null;
  private recovery: RecoveryInfo = emptyRecovery();
  private events: StreamEvent[] = [];
  private host: HostReachability = { reachable: null, checkedAt: null };
  private hostChecking = false;
  private hostAbort: AbortController | null = null;
  private hostSeq = 0;

  // Phase 2
  private readonly history: ConnectionHistory;
  private failureKind: StreamFailureKind | null = null;
  private lastRecovery: LastRecovery | null = null;
  private interruptedRecovery: InterruptedRecovery | null = null;
  private hostSamples: HostProbeSample[] = [];
  /** Last observed host state; events are recorded only when it changes. null = unknown. */
  private hostState: 'reachable' | 'unreachable' | null = null;
  private autoMeasureMs: number | null = null;

  private timers: { connect: unknown; retry: unknown; tick: unknown; stable: unknown; auto: unknown } = {
    connect: null,
    retry: null,
    tick: null,
    stable: null,
    auto: null,
  };

  constructor(options: StreamConnectionOptions) {
    this.opts = options;
    this.clock = options.clock ?? systemClock;
    this.policy = { ...DEFAULT_STREAM_POLICY, ...options.policy };
    this.history = options.history ?? new ConnectionHistory({ clock: this.clock });
    this.history.startSession(options.sessionId ?? 'session');
    this.snapshot = this.buildSnapshot();
  }

  // ----------------------------------------------- useSyncExternalStore API --

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): StreamHealth => this.snapshot;

  // ------------------------------------------------------------ inputs -----

  /** Apply configuration. Restarts the connection only if the URL, mode or blocking state changed. */
  configure(patch: Partial<StreamTarget>): void {
    const prev = this.target;
    this.target = { ...prev, ...patch };
    const t = this.target;

    const baseChanged = prev.baseUrl !== t.baseUrl;
    const streamChanged =
      prev.url !== t.url ||
      prev.mode !== t.mode ||
      prev.mixedContent !== t.mixedContent ||
      Boolean(prev.corsCapture) !== Boolean(t.corsCapture);

    if (baseChanged) this.resetHost();
    if (streamChanged || baseChanged) {
      this.stopRuntime();
      this.resetDiagnostics();
      if (this.configured) {
        this.pushEvent('info', 'Camera configuration changed.');
        this.history.record({ type: 'config_changed', message: 'Camera settings changed; the stream reconnects with the new settings.' });
      }
      this.configured = true;
      this.reevaluate();
    }
    this.notify();
  }

  /** The Live Feed is (or is not) on screen in stream mode. */
  setViewing(viewing: boolean): void {
    if (this.viewing === viewing) return;
    this.viewing = viewing;
    this.reevaluate();
  }

  /** Something exists that can display the stream (an <img> is mounted). */
  setElementAvailable(available: boolean): void {
    if (this.elementAvailable === available) return;
    this.elementAvailable = available;
    this.reevaluate();
  }

  /**
   * Manual Reconnect. Always available. Resets the retry counter, closes the current connection
   * first and opens exactly one new one. Rapid repeated clicks collapse into one attempt.
   */
  reconnect(): void {
    const t = this.target;
    if (!t.baseConfigured) return;
    this.checkHost('manual');
    if (!t.url) return; // no stream path configured: reachability check is all there is to do

    if (!this.isActive()) {
      this.pushEvent('info', 'Reconnect requested while the Live Feed is not open: checked camera reachability only.');
      this.notify();
      return;
    }

    const now = this.clock.now();
    if (
      this.phase === 'connecting' &&
      this.lastStartReason === 'manual' &&
      now - this.attemptStartedAt < this.policy.manualDebounceMs
    ) {
      return; // duplicate click: one attempt is already starting
    }

    const wasFailing = this.phase === 'failed' || this.phase === 'waiting-retry';
    this.retriesUsed = 0;
    this.pushEvent('info', 'Manual reconnect requested.');
    if (wasFailing && this.recovery.state !== 'in_progress') {
      this.beginRecovery('manual');
    }
    this.startAttempt('manual');
  }

  /** Run a camera-host reachability check (coalesced). Never changes stream status. */
  checkHost(trigger: HostProbeTrigger = 'manual'): void {
    if (this.startHostProbe(trigger)) this.notify();
  }

  /**
   * "Measure now" in the Diagnostics UI. Returns false when a request is already running (they are
   * never overlapped) or when nothing can be measured (no camera address, or the browser blocks it).
   */
  measureHost(): boolean {
    const started = this.startHostProbe('manual');
    if (started) this.notify();
    return started;
  }

  /**
   * Opt-in periodic reachability measurement. null turns it off. The interval is raised to
   * policy.autoMeasureMinMs. The first measurement runs immediately; later ones are skipped while a
   * request is still running or the page is hidden. Off by default: every measurement is one
   * more request to a small device that may already be busy serving video.
   */
  setAutoMeasure(intervalMs: number | null): void {
    const next = intervalMs == null ? null : Math.max(this.policy.autoMeasureMinMs, Math.floor(intervalMs));
    if (next === this.autoMeasureMs) return;
    this.clearTimer('auto');
    this.autoMeasureMs = next;
    if (next != null) {
      this.runAutoTick(); // measures now and schedules the next tick
    }
    this.notify();
  }

  private runAutoTick(): void {
    this.clearTimer('auto');
    const interval = this.autoMeasureMs;
    if (interval == null) return;
    this.timers.auto = this.clock.setTimeout(() => {
      this.timers.auto = null;
      this.runAutoTick();
    }, interval);
    if (this.opts.isPageVisible && !this.opts.isPageVisible()) return;
    this.startHostProbe('auto'); // refuses while another request is running
    this.notify();
  }

  /** Remove every entry of the persisted connection history. */
  clearHistory(): void {
    this.history.clear();
    this.notify();
  }

  /** Starts a probe unless one is already running. Returns true if it started. Does not notify. */
  private startHostProbe(trigger: HostProbeTrigger): boolean {
    const probe = this.opts.probeHost;
    if (!probe || !this.target.baseConfigured || this.hostAbort) return false;
    // The browser would block the request itself, which would look like "camera unreachable".
    if (this.target.mixedContent) return false;
    const abort = new AbortController();
    this.hostAbort = abort;
    this.hostChecking = true;
    const token = ++this.hostSeq;
    const baseUrl = this.target.baseUrl;
    const startedAt = this.clock.now();
    probe(baseUrl, abort.signal, this.policy.hostProbeTimeoutMs)
      .then((res) => {
        if (token !== this.hostSeq) return; // stale: configuration changed or shut down meanwhile
        this.hostAbort = null;
        this.hostChecking = false;
        if (res.failure === 'cancelled') {
          this.notify(); // aborted by someone else: not a measurement, so nothing is recorded
          return;
        }
        this.applyHostResult(res, trigger, startedAt);
        this.notify();
      })
      .catch((err: unknown) => {
        if (token !== this.hostSeq) return;
        this.hostAbort = null;
        this.hostChecking = false;
        this.applyHostResult({ reachable: false, error: errorText(err), failure: 'network' }, trigger, startedAt);
        this.notify();
      });
    return true;
  }

  /** Store one completed measurement and record the history events it justifies. */
  private applyHostResult(res: HostProbeResult, trigger: HostProbeTrigger, startedAt: number): void {
    const now = this.clock.now();
    const ok = res.reachable;
    const failure = ok ? undefined : res.failure === 'timeout' ? 'timeout' : 'network';
    const elapsedMs = Math.max(0, res.latencyMs ?? now - startedAt);
    // A stream connection confirmed AFTER this request started proves the camera was alive; an
    // old "no answer" must not be reported as news.
    const streamRecoveredSince =
      this.phase === 'connected' && this.connectedSince != null && this.connectedSince > startedAt;
    const superseded = !ok && streamRecoveredSince;
    const streamReportedConnected = this.phase === 'connected';

    this.host = {
      reachable: ok,
      checkedAt: now,
      latencyMs: res.latencyMs,
      error: res.error,
      ...(failure ? { failure } : {}),
    };
    this.hostSamples.push({ at: now, ok, elapsedMs, ...(failure ? { failure } : {}), trigger, ...(superseded ? { superseded: true } : {}) });
    if (this.hostSamples.length > MAX_HOST_SAMPLES) this.hostSamples.splice(0, this.hostSamples.length - MAX_HOST_SAMPLES);

    // Phase 1 verbose log. Periodic samples would flood it, so they only appear in the samples list.
    if (trigger !== 'auto') {
      this.pushEvent(
        ok ? 'info' : 'warn',
        ok ? 'Camera host responded.' : `Camera host did not respond${res.error ? `: ${res.error}` : '.'}`,
      );
    }

    if (superseded) return;
    if (ok) {
      if (this.hostState === 'unreachable') {
        this.history.record({
          type: 'host_reachable',
          message: `Camera host answers again (request took ${Math.round(elapsedMs)} ms).`,
        });
      }
      this.hostState = 'reachable';
      // The host answers but the stream is still failing: say plainly that the cause is unknown.
      if (!streamRecoveredSince && this.failureInProgress()) {
        this.history.record({
          type: 'diagnosis_inconclusive',
          message:
            'The camera host answers, but the stream is not delivering frames. The browser cannot tell why (the camera\'s video task, another viewer holding the stream, power or Wi-Fi quality can all look like this).',
          dedupeKey: 'host-answers-stream-fails',
        });
      }
    } else {
      if (this.hostState !== 'unreachable') {
        const why = failure === 'timeout' ? `no answer within ${formatSeconds(this.policy.hostProbeTimeoutMs)}` : 'the browser reported a network error';
        this.history.record({
          type: 'host_unreachable',
          message:
            `Camera host did not answer a reachability check (${why}).` +
            (streamReportedConnected
              ? ' The stream was still reported connected, so this alone does not mean the stream failed.'
              : ''),
        });
      }
      this.hostState = 'unreachable';
    }
  }

  /** True while the stream is failing and not yet recovered (a failure episode is open). */
  private failureInProgress(): boolean {
    return (
      this.phase === 'waiting-retry' ||
      this.phase === 'failed' ||
      (this.phase === 'connecting' && this.recovery.state === 'in_progress')
    );
  }

  /**
   * Stop everything (timers, connection, in-flight probes) and forget the viewing inputs, so a
   * later setViewing()/setElementAvailable() starts cleanly (this also makes React StrictMode's
   * mount-unmount-mount sequence safe). Safe to call repeatedly.
   */
  shutdown(): void {
    this.viewing = false;
    this.elementAvailable = false;
    this.stopRuntime();
    this.clearTimer('auto');
    this.autoMeasureMs = null;
    this.resetHost();
    this.notify();
  }

  // ------------------------------------------------------------ internals --

  private isActive(): boolean {
    const t = this.target;
    return this.viewing && this.elementAvailable && Boolean(t.url) && t.baseConfigured && !t.mixedContent;
  }

  /** Start or stop the connection so it matches the current inputs. */
  private reevaluate(): void {
    if (this.isActive()) {
      if (this.phase === 'idle') this.startAttempt('initial');
    } else if (this.phase !== 'idle') {
      this.stopRuntime();
      this.pushEvent('info', 'Stream closed (Live Feed not open or not configured).');
    }
    this.notify();
  }

  private startAttempt(reason: StartReason): void {
    this.teardownSession();
    this.clearTimer('retry');
    this.nextRetryAt = null;

    const transport = this.opts.createTransport(this.target.mode);
    if (!transport) {
      this.phase = 'idle';
      this.notify();
      return;
    }

    const id = ++this.attemptId;
    this.attemptSeq++;
    if (reason !== 'initial') this.totalReconnects++;
    this.phase = 'connecting';
    this.attemptStartedAt = this.clock.now();
    this.lastStartReason = reason;
    this.attemptIsRetry = this.retriesUsed > 0 || this.everConnected || reason === 'manual';
    this.brokenSince = null;

    const url = this.urlForAttempt();
    this.pushEvent(
      'info',
      reason === 'retry'
        ? `Reconnect attempt ${this.retriesUsed} of ${this.policy.maxRetries}...`
        : reason === 'manual'
          ? 'Reconnecting (manual)...'
          : 'Connecting to the stream...',
    );
    if (reason === 'initial') {
      this.history.record({ type: 'stream_connecting', message: 'Stream connection started.' });
    } else {
      this.history.record({
        type: 'reconnect_started',
        message:
          reason === 'retry'
            ? `Automatic reconnect attempt ${this.retriesUsed} of ${this.policy.maxRetries} started.`
            : 'Manual reconnect started.',
      });
    }

    let session: StreamSession;
    try {
      session = transport.open(url, {
        onFirstFrame: () => this.onFirstFrame(id),
        onFrame: () => this.onFrame(id),
        onError: (message) => this.onTransportFailure(id, 'error', message),
        onEnded: (message) => this.onTransportFailure(id, 'ended', message),
      });
    } catch (err) {
      this.fail(`Could not open the stream: ${errorText(err)}`, 'open-failed');
      return;
    }

    if (id !== this.attemptId) {
      // The transport failed synchronously inside open(); this attempt is already superseded.
      session.close();
      return;
    }
    this.session = session;
    this.timers.connect = this.clock.setTimeout(() => this.onConnectTimeout(id), this.policy.connectTimeoutMs);
    this.notify();
  }

  /** Close the current session and invalidate every callback it could still fire. */
  private teardownSession(): void {
    this.attemptId++;
    const session = this.session;
    this.session = null;
    this.clearTimer('connect');
    this.clearTimer('tick');
    this.clearTimer('stable');
    if (session) {
      try {
        session.close();
      } catch {
        // closing must never throw into the caller
      }
    }
  }

  private stopRuntime(): void {
    this.teardownSession();
    this.clearTimer('retry');
    this.nextRetryAt = null;
    this.phase = 'idle';
    this.retriesUsed = 0;
    this.everConnected = false;
    this.connectedSince = null;
    this.brokenSince = null;
    this.gapBaseline = null;
    if (this.recovery.state === 'in_progress') {
      this.interruptedRecovery = {
        startedAt: this.recovery.startedAt,
        reason: this.recovery.reason,
        attempts: this.recovery.attempts,
      };
      this.recovery = { ...this.recovery, state: 'none' };
    }
    // A stream that was closed on purpose is not "one continuous failure" with what comes next.
    this.history.endEpisode();
  }

  /** Forget per-stream diagnostics (used when the camera configuration itself changed). */
  private resetDiagnostics(): void {
    this.lastFrameAt = null;
    this.recentFrames = [];
    this.gaps = [];
    this.gapBaseline = null;
    this.framesTotal = 0;
    this.lastError = null;
    this.lastErrorAt = null;
    this.failureKind = null;
    this.lastRecovery = null;
    this.interruptedRecovery = null;
    this.recovery = emptyRecovery();
  }

  private resetHost(): void {
    this.hostSeq++;
    this.hostAbort?.abort();
    this.hostAbort = null;
    this.hostChecking = false;
    this.host = { reachable: null, checkedAt: null };
    this.hostSamples = [];
    this.hostState = null;
  }

  private urlForAttempt(): string {
    const { url, mode } = this.target;
    // A plain <img> may serve a repeated identical URL from its in-memory cache or re-attach to
    // the previous request instead of opening a new connection, so every attempt after the first
    // gets a unique query parameter. The first connection uses the configured URL untouched, and
    // fetch() (monitor mode) already bypasses the cache.
    if (mode !== 'img' || this.attemptSeq <= 1) return url;
    return `${url}${url.includes('?') ? '&' : '?'}_rc=${this.attemptSeq}`;
  }

  // ------------------------------------------------------ transport events --

  private onFirstFrame(id: number): void {
    if (id !== this.attemptId || this.phase !== 'connecting') return;
    this.clearTimer('connect');
    const now = this.clock.now();
    this.phase = 'connected';
    this.everConnected = true;
    this.connectedSince = now;
    this.brokenSince = null;
    this.recordFrame(now);

    if (this.recovery.state === 'in_progress') {
      this.recovery = {
        ...this.recovery,
        state: 'succeeded',
        finishedAt: now,
        attempts: this.retriesUsed,
      };
      const took = this.recovery.startedAt != null ? ((now - this.recovery.startedAt) / 1000).toFixed(1) : '?';
      const retries = `${this.retriesUsed} automatic ${this.retriesUsed === 1 ? 'retry' : 'retries'}`;
      this.pushEvent('ok', `Stream recovered after ${took}s (${retries}).`);
      this.lastRecovery = {
        at: now,
        durationMs: this.recovery.startedAt != null ? now - this.recovery.startedAt : 0,
        attempts: this.retriesUsed,
      };
      this.history.record({ type: 'reconnect_succeeded', message: `Stream recovered after ${took}s (${retries}).` });
    } else {
      this.pushEvent('ok', 'Stream connected (first frame received).');
      this.history.record({
        type: 'stream_first_frame',
        message: `First frame confirmed ${formatSeconds(now - this.attemptStartedAt, true)} after the connection was opened.`,
      });
    }
    // A frame proves the camera is alive: the failure is over and old reachability news is stale.
    this.interruptedRecovery = null;
    this.history.endEpisode();
    this.hostState = null;

    this.timers.stable = this.clock.setTimeout(() => this.onStable(id), this.policy.stableAfterMs);
    this.scheduleTick(id);
    this.notify();
  }

  private onFrame(id: number): void {
    if (id !== this.attemptId || this.phase !== 'connected') return;
    this.recordFrame(this.clock.now());
    // No notify(): per-frame re-renders are pointless; stats are published on each tick.
  }

  private onTransportFailure(id: number, kind: 'error' | 'ended', message: string): void {
    if (id !== this.attemptId) return; // from a superseded attempt: ignore
    if (this.phase !== 'connecting' && this.phase !== 'connected') return;
    this.fail(kind === 'ended' ? `Camera closed the stream: ${message}` : message, kind === 'ended' ? 'ended' : 'transport-error');
  }

  private onConnectTimeout(id: number): void {
    if (id !== this.attemptId || this.phase !== 'connecting') return;
    this.timers.connect = null;
    const secs = Math.round(this.policy.connectTimeoutMs / 1000);
    this.fail(`No frame received within ${secs}s of opening the stream.`, 'connect-timeout');
  }

  private onStable(id: number): void {
    if (id !== this.attemptId || this.phase !== 'connected') return;
    this.timers.stable = null;
    if (this.retriesUsed !== 0) {
      this.retriesUsed = 0;
      this.notify();
    }
  }

  private scheduleTick(id: number): void {
    this.clearTimer('tick');
    this.timers.tick = this.clock.setTimeout(() => {
      this.timers.tick = null;
      if (id !== this.attemptId || this.phase !== 'connected') return;
      this.onTick(id);
    }, this.policy.tickMs);
  }

  private onTick(id: number): void {
    const now = this.clock.now();

    const health = this.session?.poll?.();
    if (health === 'broken') {
      this.brokenSince ??= now;
      if (now - this.brokenSince >= this.policy.brokenDisplayGraceMs) {
        this.fail('The video element no longer holds a decodable image (the stream was reset or sent a corrupt frame).', 'display-lost');
        return;
      }
    } else if (health === 'ok') {
      this.brokenSince = null;
    }

    if (this.target.mode === 'monitor' && this.lastFrameAt != null) {
      const gap = now - this.lastFrameAt;
      if (gap > this.policy.stallTimeoutMs) {
        this.fail(`Stalled: no frame for ${(gap / 1000).toFixed(1)}s while the connection stayed open.`, 'stall');
        return;
      }
    }

    if (id === this.attemptId && this.phase === 'connected') {
      this.scheduleTick(id);
      if (this.target.mode === 'monitor') this.notify(); // publish live frame statistics
    }
  }

  // ------------------------------------------------------------ failures ---

  private fail(message: string, kind: StreamFailureKind): void {
    const wasConnected = this.phase === 'connected';
    this.teardownSession();
    this.clearTimer('retry'); // never leave an older retry timer behind when scheduling a new one
    const now = this.clock.now();
    this.lastError = message;
    this.lastErrorAt = now;
    this.failureKind = kind;
    this.pushEvent('error', message);
    const firstFailure = this.recovery.state !== 'in_progress';
    this.recordFailureHistory(kind, message, wasConnected, firstFailure);
    if (firstFailure) this.beginRecovery(wasConnected ? 'connection lost' : 'connect failed');

    if (this.target.autoReconnect && this.retriesUsed < this.policy.maxRetries) {
      this.retriesUsed++;
      const delay = this.delayFor(this.retriesUsed);
      this.phase = 'waiting-retry';
      this.nextRetryAt = now + delay;
      this.recovery = { ...this.recovery, attempts: this.retriesUsed };
      this.pushEvent('info', `Retry ${this.retriesUsed} of ${this.policy.maxRetries} in ${(delay / 1000).toFixed(delay % 1000 === 0 ? 0 : 1)}s.`);
      this.timers.retry = this.clock.setTimeout(() => {
        this.timers.retry = null;
        this.nextRetryAt = null;
        if (this.phase === 'waiting-retry' && this.isActive()) this.startAttempt('retry');
      }, delay);
    } else {
      this.phase = 'failed';
      this.nextRetryAt = null;
      if (this.recovery.state === 'in_progress') {
        this.recovery = { ...this.recovery, state: 'failed', finishedAt: now };
      }
      const stopped = this.target.autoReconnect
        ? `Gave up after ${this.policy.maxRetries} automatic retries. Press Reconnect to try again.`
        : 'Automatic reconnect is off. Press Reconnect to try again.';
      this.pushEvent('error', stopped);
      this.history.record({ type: 'reconnect_stopped', message: stopped, dedupeKey: 'stopped' });
    }
    this.startHostProbe('stream-failure');
    this.notify();
  }

  /**
   * One history entry per distinct cause per continuous failure: the first failure is typed by what
   * happened; later failed attempts of the same recovery are 'reconnect_failed' and identical
   * causes are folded into one entry with a repeat count.
   */
  private recordFailureHistory(kind: StreamFailureKind, message: string, wasConnected: boolean, firstFailure: boolean): void {
    const cause = kind === 'transport-error' || kind === 'ended' || kind === 'open-failed' ? `${kind}:${message}` : kind;
    if (firstFailure) {
      if (kind === 'stall') {
        const detail = message.replace(/^Stalled:\s*/i, '');
        this.history.record({
          type: 'stream_stalled',
          message: `${detail.charAt(0).toUpperCase()}${detail.slice(1)} Reconnecting.`,
          dedupeKey: cause,
        });
      } else if (wasConnected) {
        this.history.record({ type: 'stream_disconnected', message, dedupeKey: cause });
      } else {
        this.history.record({ type: 'stream_connect_failed', message, dedupeKey: cause });
      }
    } else {
      this.history.record({ type: 'reconnect_failed', message, dedupeKey: cause });
    }
  }

  /**
   * Delay before automatic retry number `retryNumber` (1-based) of the current recovery.
   *  - Stream was working and just dropped: retry once quickly (<= 1 s), because a one-off glitch
   *    is the common case, then back off from the base delay (1 s, base, 2x base, ...).
   *  - Stream never connected: base, 2x base, 4x base, ... so an unreachable camera is not hammered.
   * Every delay is capped at policy.maxDelayMs.
   */
  private delayFor(retryNumber: number): number {
    const base = Math.max(250, this.target.baseDelayMs);
    const lostWorkingStream = this.recovery.reason === 'connection lost';
    if (lostWorkingStream && retryNumber === 1) return Math.min(1000, base);
    const exponent = lostWorkingStream ? retryNumber - 2 : retryNumber - 1;
    return Math.min(this.policy.maxDelayMs, base * 2 ** exponent);
  }

  private beginRecovery(reason: string): void {
    this.recovery = {
      state: 'in_progress',
      startedAt: this.clock.now(),
      finishedAt: null,
      attempts: 0,
      reason,
    };
  }

  // ----------------------------------------------------------- bookkeeping --

  private recordFrame(now: number): void {
    // Gap = time the viewer saw no new frame. It deliberately spans reconnects.
    if (this.gapBaseline != null && now - this.gapBaseline >= MIN_RECORDED_GAP_MS) {
      this.gaps.push({ at: now, ms: now - this.gapBaseline });
    }
    this.gapBaseline = now;
    this.lastFrameAt = now;
    this.framesTotal++;

    this.recentFrames.push(now);
    let drop = 0;
    while (drop < this.recentFrames.length && this.recentFrames[drop] < now - FPS_WINDOW_MS) drop++;
    if (drop > 0) this.recentFrames.splice(0, drop);

    let dropGaps = 0;
    while (dropGaps < this.gaps.length && this.gaps[dropGaps].at < now - GAP_WINDOW_MS) dropGaps++;
    if (dropGaps > 0) this.gaps.splice(0, dropGaps);
    if (this.gaps.length > 1000) this.gaps.splice(0, this.gaps.length - 1000);
  }

  private frameStats(now: number): FrameStats | null {
    if (this.target.mode !== 'monitor') return null;
    let longest = 0;
    for (const g of this.gaps) if (g.at >= now - GAP_WINDOW_MS && g.ms > longest) longest = g.ms;
    // A gap that is still open counts too, except while the stream is deliberately closed.
    if (this.gapBaseline != null && this.phase !== 'idle') longest = Math.max(longest, now - this.gapBaseline);
    const recent = this.recentFrames.filter((t) => t >= now - FPS_WINDOW_MS).length;
    return {
      framesTotal: this.framesTotal,
      fps5s: Math.round((recent / (FPS_WINDOW_MS / 1000)) * 10) / 10,
      longestGapMs5min: longest,
    };
  }

  private pushEvent(level: StreamEventLevel, message: string): void {
    this.events.push({ t: this.clock.now(), level, message });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private clearTimer(name: keyof StreamConnection['timers']): void {
    const handle = this.timers[name];
    if (handle != null) {
      this.clock.clearTimeout(handle);
      this.timers[name] = null;
    }
  }

  private deriveStatus(): ConnectionStatus {
    const t = this.target;
    if (!t.baseConfigured) return 'unconfigured';
    if (!t.url) {
      // No stream path: the only evidence available is host reachability.
      if (this.hostChecking) return 'connecting';
      if (this.host.reachable === true) return 'host_reachable';
      if (this.host.reachable === false) return 'error';
      return 'disconnected';
    }
    if (t.mixedContent) return 'disconnected';
    switch (this.phase) {
      case 'connecting':
        return this.attemptIsRetry ? 'reconnecting' : 'connecting';
      case 'connected':
        return 'connected';
      case 'waiting-retry':
        return 'reconnecting';
      case 'failed':
        return 'error';
      default:
        return 'disconnected';
    }
  }

  private buildSnapshot(): StreamHealth {
    const now = this.clock.now();
    const t = this.target;
    const noStream = t.baseConfigured && !t.url;
    let lastError = this.lastError;
    if (t.mixedContent && t.url) lastError = MIXED_CONTENT_MESSAGE;
    else if (noStream && this.host.reachable === false) lastError = this.host.error ?? 'Camera host is not reachable.';
    return {
      status: this.deriveStatus(),
      mode: t.mode,
      evidence: t.mode === 'monitor' ? 'frames' : 'first-frame-only',
      active: this.phase === 'connecting' || this.phase === 'connected' || this.phase === 'waiting-retry',
      attempt: this.retriesUsed,
      maxAttempts: this.policy.maxRetries,
      totalReconnects: this.totalReconnects,
      connectedSince: this.phase === 'connected' ? this.connectedSince : null,
      lastFrameAt: this.lastFrameAt,
      frameStats: this.frameStats(now),
      lastError,
      lastErrorAt: this.lastErrorAt,
      blockedReason: t.mixedContent && t.url ? MIXED_CONTENT_MESSAGE : null,
      nextRetryAt: this.nextRetryAt,
      host: this.host,
      hostChecking: this.hostChecking,
      recovery: this.recovery,
      events: this.events.slice(),
      failureKind: this.failureKind,
      lastRecovery: this.lastRecovery,
      interruptedRecovery: this.interruptedRecovery ? { ...this.interruptedRecovery } : null,
      hostSamples: this.hostSamples.map((sample) => ({ ...sample })),
      hostProbeTimeoutMs: this.policy.hostProbeTimeoutMs,
      hostProbeBlockedReason: t.baseConfigured && t.mixedContent ? HOST_PROBE_BLOCKED_MESSAGE : null,
      autoMeasureMs: this.autoMeasureMs,
      history: this.history.getEvents(),
      historyStorage: this.history.getStorageInfo(),
    };
  }

  private notify(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }
}

// ------------------------------------------------------------------ helpers --

function emptyRecovery(): RecoveryInfo {
  return { state: 'none', startedAt: null, finishedAt: null, attempts: 0, reason: null };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatSeconds(ms: number, precise = false): string {
  const secs = ms / 1000;
  return precise ? `${secs.toFixed(1)}s` : `${secs.toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CameraConfig {
  baseUrl: string;
  streamPath: string;
  snapshotPath: string;
  /** Retry automatically (bounded, with back-off) after the live stream fails. */
  autoReconnect: boolean;
  /** Base delay between automatic retries; doubles after each consecutive failure. */
  reconnectIntervalSec: number;
  /**
   * Experimental, default off. Reads the MJPEG stream with fetch() instead of a bare
   * <img>, which makes every frame observable (stall detection) but only works when the
   * camera sends an Access-Control-Allow-Origin header.
   */
  frameMonitor?: boolean;
  /**
   * Marks configs saved by a version that understands the recovery settings above.
   * Older saved configs carried autoReconnect/reconnectIntervalSec as unused defaults.
   */
  recoverySchema?: number;
  /**
   * Smart Snapshot. Default off. Requests the live video with CORS (`<img crossorigin>`) so a frame
   * can be read back for "Capture Still". Only works if the camera sends Access-Control-Allow-Origin;
   * without that header the browser refuses to show the stream at all, so it is opt-in.
   */
  captureCors?: boolean;
}

export type ConnectionStatus =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'host_reachable'
  | 'disconnected'
  | 'error';

export interface ConnectionProbeResult {
  success: boolean;
  checkedUrl: string;
  probeType: 'image' | 'fetch' | 'mixed_content_block';
  timestamp: number;
  latencyMs?: number;
  errorMessage?: string;
  isMixedContent: boolean;
  httpStatus?: number;
  hostReachable?: boolean;
  frameVerified?: boolean;
  details?: string;
  /**
   * Why a host-reachability request failed, in machine-readable form (Phase 2). 'timeout' = no
   * answer within the time limit, 'cancelled' = aborted by the caller (not a measurement),
   * 'network' = the browser reported a network error (refused, unreachable, blocked...).
   */
  failureKind?: 'timeout' | 'cancelled' | 'network';
}

/**
 * A still image captured from the camera. `blob` is the JPEG itself: a gallery entry always holds
 * real image data, never a reference to a camera URL.
 */
export interface SnapshotItem {
  id: string;
  /** When the frame was captured (epoch ms). */
  timestamp: number;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  /** The stream the frame was read from. */
  sourceUrl: string;
  cameraName: string;
  /**
   * 'saved' = also written to this browser's IndexedDB (survives a refresh).
   * 'session' = held in memory only, because the browser refused to store it; gone on refresh.
   */
  persistence: 'saved' | 'session';
  /** Why it is session-only, when it is. */
  persistenceNote?: string;
}

export type SurveillanceViewMode = 'stream' | 'snapshot';

export type ActiveNavTab = 'feed' | 'ai' | 'pose' | 'snapshots' | 'events' | 'diagnostics' | 'settings' | 'network-guide';

// ---------------------------------------------------------------------------
// Live-stream health (owned by services/streamConnectionService.ts)
// ---------------------------------------------------------------------------

/** 'img' = plain <img> element (default). 'monitor' = fetch() reader with per-frame evidence. */
export type StreamMode = 'img' | 'monitor';

export type StreamEventLevel = 'info' | 'ok' | 'warn' | 'error';

export interface StreamEvent {
  t: number;
  level: StreamEventLevel;
  message: string;
}

export interface HostReachability {
  /** null = never checked. Reachability is kept separate from stream health on purpose. */
  reachable: boolean | null;
  checkedAt: number | null;
  /**
   * How long the browser's request to the camera took to get a response (Phase 2: measured with a
   * monotonic clock). This is an HTTP request time, NOT Wi-Fi latency; see PHASE2_DIAGNOSTICS_REPORT.md.
   */
  latencyMs?: number;
  error?: string;
  /** Why the check failed, when it did (Phase 2). */
  failure?: 'timeout' | 'network';
}

export type RecoveryState = 'none' | 'in_progress' | 'succeeded' | 'failed';

export interface RecoveryInfo {
  state: RecoveryState;
  startedAt: number | null;
  finishedAt: number | null;
  attempts: number;
  reason: string | null;
}

export interface FrameStats {
  framesTotal: number;
  /** Frames per second averaged over the last 5 s. */
  fps5s: number;
  /**
   * Longest time the viewer saw no new frame in the last 5 minutes. Spans reconnects, so it is the
   * freeze duration as experienced, including any gap that is still open.
   */
  longestGapMs5min: number;
}

// ---------------------------------------------------------------------------
// Phase 2: connection history, response-time samples and failure classification
// ---------------------------------------------------------------------------

/** Kinds of event kept in the persisted connection history. */
export type ConnectionEventType =
  | 'session_started'
  | 'config_changed'
  | 'stream_connecting'
  | 'stream_first_frame'
  | 'stream_disconnected'
  | 'stream_connect_failed'
  | 'stream_stalled'
  | 'reconnect_started'
  | 'reconnect_succeeded'
  | 'reconnect_failed'
  | 'reconnect_stopped'
  | 'host_unreachable'
  | 'host_reachable'
  | 'diagnosis_inconclusive';

export interface ConnectionEvent {
  /** Increases for every new event; stays unique across reloads. */
  id: number;
  /** First time this event happened. */
  t: number;
  /** Most recent time it happened again (equals t when count is 1). */
  lastT: number;
  /** Identical repeats during one continuous failure are folded into one entry. */
  count: number;
  type: ConnectionEventType;
  severity: StreamEventLevel;
  message: string;
  /** Only on 'session_started': identifies the page load that wrote it. */
  session?: string;
  /** True when the event was loaded from browser storage, i.e. it belongs to an earlier page load. */
  restored?: boolean;
}

export interface HistoryStorageInfo {
  /** 'persistent' = saved in this browser's localStorage. 'memory-only' = lost when the page closes. */
  status: 'persistent' | 'memory-only';
  /** Why it is memory-only (storage blocked, full...), or a note such as "unreadable data was discarded". */
  reason: string | null;
}

export type HostProbeTrigger = 'manual' | 'auto' | 'stream-failure' | 'initial';

/** One completed camera-reachability request (never a cancelled one). */
export interface HostProbeSample {
  /** When the request finished. */
  at: number;
  /** True when the camera answered with any HTTP response. */
  ok: boolean;
  /** Time until the request was answered, failed, or gave up (for a timeout this is the time limit). */
  elapsedMs: number;
  failure?: 'timeout' | 'network';
  trigger: HostProbeTrigger;
  /** A newer frame proved the stream alive after this request started, so it raised no event. */
  superseded?: boolean;
}

/** What went wrong in the most recent stream failure. */
export type StreamFailureKind =
  | 'connect-timeout'
  | 'stall'
  | 'display-lost'
  | 'transport-error'
  | 'ended'
  | 'open-failed';

/** A recovery that was cut short because the stream was closed on purpose (Live Feed hidden). */
export interface InterruptedRecovery {
  startedAt: number | null;
  reason: string | null;
  attempts: number;
}

export interface LastRecovery {
  /** When the first frame after the failure arrived. */
  at: number;
  durationMs: number;
  /** Automatic retries it took. */
  attempts: number;
}

export interface StreamHealth {
  status: ConnectionStatus;
  mode: StreamMode;
  /**
   * What the page can actually observe:
   * 'frames'           - every frame (monitor mode)
   * 'first-frame-only' - a plain <img> reports only the first frame of a connection, so a
   *                      mid-stream stall cannot be seen.
   */
  evidence: 'frames' | 'first-frame-only';
  /** True while a stream connection is being managed (Live Feed visible and configured). */
  active: boolean;
  /** Automatic retries used in the current recovery sequence (0 = none). */
  attempt: number;
  maxAttempts: number;
  /** Retries plus manual restarts since the page was loaded. */
  totalReconnects: number;
  connectedSince: number | null;
  /** Monitor mode: last frame. Plain <img> mode: the first frame of the current connection. */
  lastFrameAt: number | null;
  frameStats: FrameStats | null;
  lastError: string | null;
  lastErrorAt: number | null;
  /** Set when the browser itself prevents the stream from being opened (HTTPS page, HTTP camera). */
  blockedReason: string | null;
  nextRetryAt: number | null;
  host: HostReachability;
  hostChecking: boolean;
  recovery: RecoveryInfo;
  /** Phase 1 verbose log of this page session (unchanged). The persisted log is `history`. */
  events: StreamEvent[];

  // ---- Phase 2 (all additive) ----
  /** Kind of the most recent stream failure, or null if none happened since the last reset. */
  failureKind: StreamFailureKind | null;
  /** Most recent successful recovery in this page session. */
  lastRecovery: LastRecovery | null;
  /**
   * Set when the stream was closed while a recovery was still in progress, so "no interruption"
   * would be untrue. Cleared by the next first frame or a settings change.
   */
  interruptedRecovery: InterruptedRecovery | null;
  /** Recent camera-reachability request timings, oldest first (this page session only). */
  hostSamples: HostProbeSample[];
  /** Time limit of one reachability request. */
  hostProbeTimeoutMs: number;
  /** Set when the browser makes a reachability request impossible (HTTPS page, HTTP camera). */
  hostProbeBlockedReason: string | null;
  /** Interval of the opt-in periodic measurement, or null when it is off. */
  autoMeasureMs: number | null;
  /** Typed, de-duplicated, capped connection history; oldest first. */
  history: ConnectionEvent[];
  historyStorage: HistoryStorageInfo;
}

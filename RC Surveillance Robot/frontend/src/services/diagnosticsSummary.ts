/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HostProbeSample, StreamHealth } from '../types/camera';
import { describeStatus, formatAgo, formatDuration, hostResultIsOutdated } from './streamStatusText';

/**
 * Turns the connection manager's snapshot (StreamHealth) into the plain-language diagnostics
 * summary shown in the Diagnostics tab and written into the copyable report.
 *
 * It adds no new measurements. Its job is to keep the facts apart that a hurried reader would
 * otherwise blur together, and to say, for every item, whether it was MEASURED, NOT MEASURED YET,
 * or CANNOT BE MEASURED in the current setup:
 *   - "camera host answers" (a network fact) is not "video is flowing" (a stream fact);
 *   - a failed one-off check is not proof that an already-working stream failed;
 *   - in plain <img> mode the page sees only the first frame of each connection.
 */

export type Availability = 'measured' | 'not-measured' | 'unavailable';
export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export type StreamStateKey =
  | 'unconfigured'
  | 'host_reachable'
  | 'connecting'
  | 'connected'
  | 'stalled'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface StreamStateSummary {
  key: StreamStateKey;
  label: string;
  explanation: string;
  tone: Tone;
}

export interface SummaryItem {
  id: 'host' | 'frame' | 'error' | 'attempts' | 'reconnect-result' | 'last-recovery';
  label: string;
  value: string;
  /** Qualification that stops the value being over-read. */
  note?: string;
  availability: Availability;
  tone: Tone;
  /** Moment the value refers to, for showing a clock time. */
  at?: number | null;
}

export interface CapabilityItem {
  id: string;
  label: string;
  state: 'available' | 'limited' | 'unavailable';
  detail: string;
}

export interface ResponseTimeStats {
  /** Completed requests in the list (cancelled ones are never in it). */
  count: number;
  answered: number;
  failed: number;
  last: HostProbeSample | null;
  /** Statistics use answered requests only; a timeout is not a latency. */
  minMs: number | null;
  medianMs: number | null;
  maxMs: number | null;
}

export interface SummaryContext {
  /** A stream path is configured (otherwise no video is expected). */
  streamPathConfigured: boolean;
  /**
   * The reachability request goes to the same host and port that serves the video. Many ESP32
   * firmwares serve one request at a time per port, so such a request can be delayed by the video
   * itself.
   */
  probeSharesStreamOrigin: boolean;
}

export interface DiagnosticsSummary {
  state: StreamStateSummary;
  items: SummaryItem[];
  capabilities: CapabilityItem[];
  responseTime: ResponseTimeStats;
}

// ----------------------------------------------------------------- statistics --

export function summarizeResponseTimes(samples: readonly HostProbeSample[]): ResponseTimeStats {
  const answered = samples.filter((s) => s.ok);
  const sorted = answered.map((s) => s.elapsedMs).sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  return {
    count: samples.length,
    answered: answered.length,
    failed: samples.length - answered.length,
    last: samples.length > 0 ? samples[samples.length - 1] : null,
    minMs: sorted.length ? sorted[0] : null,
    medianMs: median,
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

/** "412 ms", "1.2 s" - a duration measured by the browser, never "latency". */
export function formatRequestTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** One-line description of a single measurement, including the failure kind. */
export function describeSample(sample: HostProbeSample, timeoutMs: number): string {
  if (sample.ok) return `answered in ${formatRequestTime(sample.elapsedMs)}`;
  if (sample.failure === 'timeout') return `no answer within ${formatRequestTime(timeoutMs)} (timed out)`;
  return `failed after ${formatRequestTime(sample.elapsedMs)} (browser network error: refused, unreachable or blocked)`;
}

// -------------------------------------------------------------------- summary --

export function buildDiagnosticsSummary(health: StreamHealth, ctx: SummaryContext, now: number): DiagnosticsSummary {
  return {
    state: summarizeState(health),
    items: buildItems(health, now),
    capabilities: buildCapabilities(health, ctx),
    responseTime: summarizeResponseTimes(health.hostSamples),
  };
}

function summarizeState(health: StreamHealth): StreamStateSummary {
  const explanation = describeStatus(health);
  const stalled = health.failureKind === 'stall';
  switch (health.status) {
    case 'unconfigured':
      return { key: 'unconfigured', label: 'Not configured', explanation, tone: 'neutral' };
    case 'host_reachable':
      return {
        key: 'host_reachable',
        label: 'Camera host reachable (no stream configured)',
        explanation: 'The camera host answers, but no stream path is configured, so no video is expected.',
        tone: 'neutral',
      };
    case 'connecting':
      return { key: 'connecting', label: 'Connecting', explanation, tone: 'neutral' };
    case 'connected':
      return {
        key: 'connected',
        label: 'Stream connected',
        explanation:
          health.evidence === 'frames'
            ? 'Frames are arriving from the camera (Frame monitor is on).'
            : 'The first frame of this connection arrived. Plain video mode cannot observe a later stall, so this does not prove video is still advancing.',
        tone: 'good',
      };
    case 'reconnecting':
      return stalled
        ? {
            key: 'stalled',
            label: 'Stalled - reconnecting',
            explanation: `${health.lastError ?? 'Frames stopped while the connection stayed open.'} Reconnecting (automatic retry ${health.attempt} of ${health.maxAttempts}).`,
            tone: 'warn',
          }
        : { key: 'reconnecting', label: 'Reconnecting', explanation, tone: 'warn' };
    case 'error':
      return {
        key: 'error',
        label: stalled ? 'Error - stream stalled and did not recover' : 'Error - stream not working',
        explanation,
        tone: 'bad',
      };
    case 'disconnected':
    default:
      return health.active
        ? { key: 'disconnected', label: 'Disconnected', explanation, tone: 'neutral' }
        : {
            key: 'disconnected',
            label: 'Disconnected - stream not open on this page',
            explanation: `${explanation} The camera stream is opened only while the Live Feed is on screen, so these diagnostics never add a second connection to the camera. Open the Live Feed to see the live state.`,
            tone: 'neutral',
          };
  }
}

function buildItems(health: StreamHealth, now: number): SummaryItem[] {
  return [
    hostItem(health, now),
    frameItem(health, now),
    errorItem(health, now),
    attemptsItem(health),
    reconnectResultItem(health, now),
    lastRecoveryItem(health, now),
  ];
}

function hostItem(health: StreamHealth, now: number): SummaryItem {
  const base = { id: 'host' as const, label: 'Camera host reachability' };
  if (health.hostProbeBlockedReason) {
    return { ...base, value: 'Cannot be measured here', note: health.hostProbeBlockedReason, availability: 'unavailable', tone: 'neutral' };
  }
  if (health.hostChecking) {
    return { ...base, value: 'Checking...', availability: 'not-measured', tone: 'neutral' };
  }
  const host = health.host;
  if (host.reachable === null) {
    return {
      ...base,
      value: 'No check has run yet',
      note: 'It is checked when the stream fails, or when you press "Measure now".',
      availability: 'not-measured',
      tone: 'neutral',
    };
  }
  if (hostResultIsOutdated(health)) {
    return {
      ...base,
      value: `Earlier check: no answer${host.failure === 'timeout' ? ' (timed out)' : host.failure === 'network' ? ' (network error)' : ''}, ${formatAgo(host.checkedAt, now)}. Outdated - a video frame arrived afterwards`,
      note: 'A video frame arrived after that check, which shows the camera is reachable again. Press "Measure now" for a fresh result.',
      availability: 'measured',
      tone: 'neutral',
      at: host.checkedAt,
    };
  }
  if (host.reachable) {
    return {
      ...base,
      value: `Answers${host.latencyMs != null ? ` (request took ${formatRequestTime(host.latencyMs)})` : ''}, ${formatAgo(host.checkedAt, now)}`,
      note: 'The host answering does not show that video is flowing.',
      availability: 'measured',
      tone: 'good',
      at: host.checkedAt,
    };
  }
  const connected = health.status === 'connected';
  return {
    ...base,
    value: `No answer${host.failure === 'timeout' ? ' (timed out)' : host.failure === 'network' ? ' (network error)' : ''}, ${formatAgo(host.checkedAt, now)}`,
    note: connected
      ? 'The stream is still reported connected. A failed one-off check does not mean a working stream failed (a camera that serves one request at a time can ignore a second request while it streams).'
      : 'Check power, Wi-Fi and the IP address. A failed check is a measurement of this one request only.',
    availability: 'measured',
    tone: connected ? 'warn' : 'bad',
    at: host.checkedAt,
  };
}

function frameItem(health: StreamHealth, now: number): SummaryItem {
  const frames = health.evidence === 'frames';
  const closed = !health.active && health.status === 'disconnected';
  const base = {
    id: 'frame' as const,
    label: frames
      ? closed ? 'Last confirmed frame (before the stream was closed)' : 'Last confirmed frame'
      : closed ? 'First frame of the last connection' : 'First frame of this connection',
  };
  if (health.lastFrameAt == null) {
    return {
      ...base,
      value: 'No frame confirmed yet',
      availability: 'not-measured',
      tone: 'neutral',
      note: health.active ? undefined : 'The stream is only open while the Live Feed is on screen.',
    };
  }
  return {
    ...base,
    value: formatAgo(health.lastFrameAt, now),
    availability: 'measured',
    tone: 'neutral',
    at: health.lastFrameAt,
    note: frames
      ? 'Counts frames that arrived; the picture content is not compared, so a camera repeating one image would still look alive.'
      : 'Plain video mode reports only the first frame of a connection. Later frames cannot be observed, so this is not proof that video is still advancing.',
  };
}

function errorItem(health: StreamHealth, now: number): SummaryItem {
  const base = { id: 'error' as const, label: 'Most recent connection error' };
  if (health.lastError == null) {
    return { ...base, value: 'None since the page was loaded', availability: 'measured', tone: 'good' };
  }
  return {
    ...base,
    value: health.lastError,
    note: health.lastErrorAt != null ? `${formatAgo(health.lastErrorAt, now)}${health.status === 'connected' ? ' (since then the stream reconnected)' : ''}` : undefined,
    availability: 'measured',
    tone: health.status === 'connected' ? 'neutral' : 'bad',
    at: health.lastErrorAt,
  };
}

function attemptsItem(health: StreamHealth): SummaryItem {
  const inRecovery = health.attempt > 0 ? `${health.attempt} of ${health.maxAttempts} in the current recovery` : 'none in the current recovery';
  return {
    id: 'attempts',
    label: 'Reconnection attempts',
    value: `${inRecovery}; ${health.totalReconnects} reconnect${health.totalReconnects === 1 ? '' : 's'} since page load`,
    availability: 'measured',
    tone: 'neutral',
  };
}

function reconnectResultItem(health: StreamHealth, now: number): SummaryItem {
  const base = { id: 'reconnect-result' as const, label: 'Did reconnection succeed?' };
  const r = health.recovery;
  switch (r.state) {
    case 'in_progress':
      return { ...base, value: 'Not yet - recovery in progress', note: r.reason ? `Cause: ${r.reason}` : undefined, availability: 'measured', tone: 'warn' };
    case 'succeeded':
      return {
        ...base,
        value: `Yes, after ${formatDuration((r.finishedAt ?? now) - (r.startedAt ?? now))}`,
        note: r.reason ? `Cause: ${r.reason}` : undefined,
        availability: 'measured',
        tone: 'good',
      };
    case 'failed':
      return {
        ...base,
        value: 'No - automatic retries were used up',
        note: 'Use Reconnect to try again.',
        availability: 'measured',
        tone: 'bad',
      };
    default:
      if (health.interruptedRecovery) {
        const i = health.interruptedRecovery;
        return {
          ...base,
          value: 'Unknown - recovery was interrupted',
          note: `The stream was closed (Live Feed left) while it was still recovering${i.reason ? ` from: ${i.reason}` : ''}. Open the Live Feed to find out whether it reconnects.`,
          availability: 'measured',
          tone: 'warn',
        };
      }
      return {
        ...base,
        value: 'No reconnection was needed',
        note:
          health.evidence === 'frames'
            ? undefined
            : 'In plain video mode a freeze that fixes itself is invisible to the page, so this does not rule one out.',
        availability: 'measured',
        tone: 'neutral',
      };
  }
}

function lastRecoveryItem(health: StreamHealth, now: number): SummaryItem {
  const base = { id: 'last-recovery' as const, label: 'Most recent successful recovery' };
  const r = health.lastRecovery;
  if (!r) {
    return { ...base, value: 'None in this page session', note: 'Earlier sessions are in the connection history.', availability: 'measured', tone: 'neutral' };
  }
  return {
    ...base,
    value: `${formatAgo(r.at, now)} (took ${formatDuration(r.durationMs)}, ${r.attempts} automatic ${r.attempts === 1 ? 'retry' : 'retries'})`,
    availability: 'measured',
    tone: 'good',
    at: r.at,
  };
}

// --------------------------------------------------------------- capabilities --

const CORS_HINT = /Access-Control-Allow-Origin/i;

function buildCapabilities(health: StreamHealth, ctx: SummaryContext): CapabilityItem[] {
  const monitor = health.mode === 'monitor';
  const monitorNoFrames = monitor && health.frameStats != null && health.frameStats.framesTotal === 0;
  const monitorBlocked =
    monitorNoFrames && (health.status === 'error' || health.status === 'reconnecting') && CORS_HINT.test(health.lastError ?? '');

  const stall: CapabilityItem = !monitor
    ? {
        id: 'stall-detection',
        label: 'Detecting a stalled stream',
        state: 'unavailable',
        detail:
          'Not available in plain video mode: the browser reports only the first frame of a connection. Turn on Frame monitor in Settings (the camera must send an Access-Control-Allow-Origin header).',
      }
    : monitorBlocked
      ? {
          id: 'stall-detection',
          label: 'Detecting a stalled stream',
          state: 'unavailable',
          detail:
            'Frame monitor is on but no frame has been read. Either the network request failed or the camera sends no Access-Control-Allow-Origin header, which the Frame monitor needs. Turn it off to use plain video, or enable CORS headers in the camera firmware.',
        }
      : monitorNoFrames
        ? {
            id: 'stall-detection',
            label: 'Detecting a stalled stream',
            state: 'limited',
            detail: 'Frame monitor is on but no frame has been read yet in this page session.',
          }
        : {
            id: 'stall-detection',
            label: 'Detecting a stalled stream',
            state: 'available',
            detail: 'Frame monitor is on: a gap of more than 5 s between frames is treated as a stall.',
          };

  const hostBlocked = health.hostProbeBlockedReason != null;
  const reach: CapabilityItem = hostBlocked
    ? { id: 'reachability', label: 'Camera reachability and request time', state: 'unavailable', detail: health.hostProbeBlockedReason! }
    : {
        id: 'reachability',
        label: 'Camera reachability and request time',
        state: 'available',
        detail: `A browser request to the camera's web server, timed until the response headers arrive (limit ${formatRequestTime(health.hostProbeTimeoutMs)}).${
          ctx.probeSharesStreamOrigin
            ? ' It uses the same port as the video, so a camera that serves one request at a time can answer it late while streaming.'
            : ''
        }`,
      };

  return [
    {
      id: 'first-frame',
      label: 'First frame and connection errors',
      state: 'available',
      detail: 'Available in both modes: the stream is reported connected only after a decodable frame arrived.',
    },
    stall,
    reach,
    {
      id: 'frame-content',
      label: 'Whether the picture itself changed',
      state: 'unavailable',
      detail: 'The dashboard counts frames that arrive; it does not compare picture content, so repeated identical images would not be noticed.',
    },
    {
      id: 'wifi-rssi',
      label: 'Wi-Fi signal strength',
      state: 'unavailable',
      detail: 'Web pages cannot read it. Only the ESP32 firmware could report it.',
    },
    {
      id: 'packet-loss',
      label: 'Packet loss and true network latency',
      state: 'unavailable',
      detail: 'Web pages cannot send pings or count packets. The request time above includes connection set-up and the camera\'s own processing time, so it is not Wi-Fi latency.',
    },
  ];
}

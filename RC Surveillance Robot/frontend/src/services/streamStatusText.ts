/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamHealth } from '../types/camera';

/** "3.2s", "850ms", "2m 05s" */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
}

/**
 * Clock time of an event; adds the date when it did not happen today (history survives reloads,
 * so older entries can be days old).
 */
export function formatEventTime(t: number, now: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '-';
  const n = new Date(now);
  const time = d.toLocaleTimeString(undefined, { hour12: false });
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

/** "45s", "12m", "2h 15m", "3d 4h": how long something has lasted. */
export function describeSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`;
  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
}

/** "just now", "12s ago", "3m ago" */
export function formatAgo(timestamp: number | null, now: number): string {
  if (timestamp == null) return 'never';
  const diff = Math.max(0, now - timestamp);
  if (diff < 1500) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  return `${Math.floor(diff / 60_000)}m ago`;
}

/**
 * One-sentence explanation of the current status, used as a tooltip. It only states what the
 * evidence supports (for example, a plain <img> cannot report stalls, so "connected" says so).
 */
export function describeStatus(health: StreamHealth): string {
  switch (health.status) {
    case 'connected':
      return health.evidence === 'frames'
        ? 'Frames are arriving from the camera (Frame monitor is on).'
        : 'The first frame of this connection arrived. In plain video mode the browser cannot report a later stall; enable Frame monitor in Settings to detect one.';
    case 'connecting':
      return 'Opening the stream and waiting for the first frame.';
    case 'reconnecting':
      return `Recovering the stream (automatic retry ${health.attempt} of ${health.maxAttempts}). ${health.lastError ?? ''}`.trim();
    case 'error':
      return health.lastError ?? 'The stream is not working.';
    case 'host_reachable':
      return 'The camera host responds, but no stream path is configured.';
    case 'unconfigured':
      return 'No camera address is configured.';
    case 'disconnected':
    default:
      // Not the last error: that may belong to an earlier, already recovered interruption.
      return health.blockedReason ?? 'No stream connection is open (Live Feed not shown, or snapshot mode).';
  }
}

/**
 * True when the last reachability check FAILED and a video frame arrived after it. A frame is
 * proof that the camera answered, so the older "no answer" no longer describes the camera and
 * must not keep showing a power/Wi-Fi warning. (An "answers" result is never treated as outdated:
 * it was true when measured and does not claim anything about later video.)
 */
export function hostResultIsOutdated(health: StreamHealth): boolean {
  const { reachable, checkedAt } = health.host;
  return reachable === false && checkedAt != null && health.lastFrameAt != null && health.lastFrameAt > checkedAt;
}

/** A single line combining the two separate facts: camera reachability and stream state. */
export function describeReachability(health: StreamHealth): string | null {
  const { reachable } = health.host;
  if (reachable === null) return null;
  if (hostResultIsOutdated(health)) {
    return 'An earlier check got no answer, but a video frame arrived after it, so the camera is reachable again.';
  }
  if (reachable === true) return 'The camera host answers on the network.';
  return 'The camera host is not answering. Check power, Wi-Fi and the IP address.';
}

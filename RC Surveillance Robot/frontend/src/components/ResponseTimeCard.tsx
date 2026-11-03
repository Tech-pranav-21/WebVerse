/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Timer, Loader2, Play } from 'lucide-react';
import { StreamHealth } from '../types/camera';
import { useNow } from '../hooks/useNow';
import { formatAgo } from '../services/streamStatusText';
import { describeSample, formatRequestTime, summarizeResponseTimes } from '../services/diagnosticsSummary';
import { BTN_SECONDARY, CHECK, Disclosure, FIELD, Hint, Notice, Panel } from './ui';

interface ResponseTimeCardProps {
  health: StreamHealth;
  baseConfigured: boolean;
  /** scheme://host:port the request goes to (shown so it is clear what is being timed). */
  probeTarget: string;
  /** The request goes to the same host:port that serves the video. */
  probeSharesStreamOrigin: boolean;
  onMeasure: () => boolean;
  onSetAutoMeasure: (intervalMs: number | null) => void;
}

const INTERVALS_SEC = [5, 10, 30, 60] as const;
const BARS = 20;

/**
 * Camera response time: how long the browser waits for the camera's web server to answer one
 * small request. Deliberately labelled as that and nothing more - it is not Wi-Fi latency, and
 * signal strength and packet loss are not measurable by a web page.
 */
export const ResponseTimeCard: React.FC<ResponseTimeCardProps> = ({
  health,
  baseConfigured,
  probeTarget,
  probeSharesStreamOrigin,
  onMeasure,
  onSetAutoMeasure,
}) => {
  const now = useNow(true, 1000);
  const [autoOn, setAutoOn] = useState(false);
  const [intervalSec, setIntervalSec] = useState<number>(10);

  // Periodic measurement runs only while this card is on screen, and is always switched off when
  // it leaves, so it can never keep poking the camera in the background.
  useEffect(() => {
    onSetAutoMeasure(autoOn ? intervalSec * 1000 : null);
    return () => onSetAutoMeasure(null);
  }, [autoOn, intervalSec, onSetAutoMeasure]);

  const blocked = health.hostProbeBlockedReason;
  const disabled = !baseConfigured || Boolean(blocked);
  const stats = summarizeResponseTimes(health.hostSamples);
  const last = stats.last;
  const recent = health.hostSamples.slice(-BARS);
  const scaleMax = Math.max(100, ...recent.filter((s) => s.ok).map((s) => s.elapsedMs));

  return (
    <Panel
      id="response-time"
      title="Camera response time"
      icon={Timer}
      description="How long the camera's web server took to answer one request from this browser. Not a Wi-Fi measurement."
      actions={
        <button
          type="button"
          onClick={() => void onMeasure()}
          disabled={disabled || health.hostChecking}
          className={BTN_SECONDARY}
        >
          {health.hostChecking ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="w-4 h-4 text-slate-400" aria-hidden="true" />
          )}
          <span>{health.hostChecking ? 'Measuring...' : 'Measure now'}</span>
        </button>
      }
    >
      {!baseConfigured && (
        <Notice tone="info">
          <p>Set the camera address in Settings first; there is nothing to measure yet.</p>
        </Notice>
      )}
      {blocked && (
        <Notice tone="warn">
          <p>{blocked}</p>
        </Notice>
      )}
      {probeSharesStreamOrigin && (
        <Notice tone="warn">
          <p>
            The video uses this same host and port. Many ESP32 firmwares handle one request at a time per port, so while the
            video plays, this request can be answered late or not at all because of the video itself.
          </p>
        </Notice>
      )}

      {/* Latest measurement */}
      {!disabled && (
        <div className="rounded-md border border-line bg-sunken p-3" aria-live="polite">
          {last == null ? (
            <p className="text-[13px] text-slate-400">
              {health.hostChecking ? 'Measuring...' : 'No measurement yet in this page session. Press "Measure now".'}
            </p>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`text-2xl font-semibold tabular-nums ${last.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                {last.ok ? formatRequestTime(last.elapsedMs) : last.failure === 'timeout' ? 'Timed out' : 'Failed'}
              </span>
              <span className="text-[13px] text-slate-200">{describeSample(last, health.hostProbeTimeoutMs)}</span>
              <span className="text-xs text-slate-400">
                {formatAgo(last.at, now)}, {last.trigger === 'auto' ? 'periodic' : last.trigger === 'manual' ? 'you pressed Measure now' : 'automatic check after a stream problem'}
              </span>
            </div>
          )}
          {last && !last.ok && health.status === 'connected' && (
            <p className="text-xs text-amber-300 mt-1.5">
              The stream is still reported connected. This one request failing does not mean the stream failed.
            </p>
          )}
        </div>
      )}

      {/* Recent history */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-slate-400">
            Last {recent.length} request{recent.length === 1 ? '' : 's'} (oldest left)
          </div>
          <div className="flex items-end gap-0.5 h-14" aria-hidden="true">
            {recent.map((s, i) => (
              <div
                key={`${s.at}-${i}`}
                title={`${describeSample(s, health.hostProbeTimeoutMs)} - ${new Date(s.at).toLocaleTimeString(undefined, { hour12: false })}${s.superseded ? ' (stream had recovered meanwhile)' : ''}`}
                className={`flex-1 min-w-[4px] rounded-sm ${s.ok ? 'bg-cyan-400/80' : 'bg-rose-400/70'}`}
                style={{ height: s.ok ? `${Math.max(8, Math.round((s.elapsedMs / scaleMax) * 100))}%` : '100%' }}
              />
            ))}
          </div>
          <p className="text-xs text-slate-400 font-mono break-words">
            {recent.map((s) => (s.ok ? formatRequestTime(s.elapsedMs) : s.failure === 'timeout' ? 'timeout' : 'error')).join('  ')}
          </p>
          <p className="text-[13px] text-slate-200">
            {stats.answered} of {stats.count} requests answered
            {stats.minMs != null && stats.medianMs != null && stats.maxMs != null && (
              <span className="text-slate-400">
                {' '}- answered requests: min {formatRequestTime(stats.minMs)}, median {formatRequestTime(stats.medianMs)}, max {formatRequestTime(stats.maxMs)}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Periodic measurement (opt-in) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2 text-[13px] text-slate-100 cursor-pointer">
            <input
              type="checkbox"
              checked={autoOn}
              disabled={disabled}
              onChange={(e) => setAutoOn(e.target.checked)}
              className={CHECK}
            />
            <span>Measure periodically while this page is open</span>
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-slate-300">
            <span>every</span>
            <select
              value={intervalSec}
              disabled={!autoOn || disabled}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
              className={FIELD}
              aria-label="Measurement interval in seconds"
            >
              {INTERVALS_SEC.map((s) => (
                <option key={s} value={s}>{s} s</option>
              ))}
            </select>
          </label>
        </div>
        <Hint>
          Off by default. Each measurement is one extra small request to a camera that may already be busy sending video, so
          switch it on only while investigating. It stops when you leave this page, and it pauses while the browser tab is hidden.
        </Hint>
      </div>

      <Disclosure summary="What is measured, and what is not">
        <div className="text-xs text-slate-400 leading-relaxed space-y-2">
          <p>
            <strong className="text-slate-200">What is measured:</strong> the time from sending one small web request to{' '}
            <span className="font-mono text-slate-300">{probeTarget || 'the camera'}</span> until the response headers arrived
            (limit {formatRequestTime(health.hostProbeTimeoutMs)}). It includes connection set-up and the camera's own processing
            time. The browser hides the status code, so any answer counts as "host answers", and it does not show that video is flowing.
          </p>
          <p>
            <strong className="text-slate-200">Not available:</strong> Wi-Fi signal strength and packet loss. A web page cannot
            read them, so nothing here is estimated.
          </p>
        </div>
      </Disclosure>
    </Panel>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HeartPulse, RefreshCw } from 'lucide-react';
import { StreamHealth, StreamEventLevel } from '../types/camera';
import { ConnectionIndicator } from './ConnectionIndicator';
import { BTN_SECONDARY, Disclosure, Hint, Notice, Panel } from './ui';
import { useNow } from '../hooks/useNow';
import { describeStatus, formatAgo, formatDuration, hostResultIsOutdated } from '../services/streamStatusText';

interface StreamHealthCardProps {
  health: StreamHealth;
  isMixedContent: boolean;
  onReconnect: () => void;
}

const LEVEL_STYLE: Record<StreamEventLevel, string> = {
  info: 'text-slate-400',
  ok: 'text-emerald-400',
  warn: 'text-amber-300',
  error: 'text-rose-300',
};

function clock(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour12: false });
}

/** Label/value row shared by the Diagnostics cards. Stacks when the card is narrow. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 @sm:grid-cols-[9.5rem_1fr] gap-0.5 @sm:gap-3 py-2 border-b border-line last:border-0">
      <dt className="text-xs text-slate-400 pt-0.5">{label}</dt>
      <dd className="text-[13px] text-slate-100 break-words min-w-0">{children}</dd>
    </div>
  );
}

function describeRecovery(health: StreamHealth, now: number): string {
  const r = health.recovery;
  switch (r.state) {
    case 'in_progress':
      return `Recovering since ${r.startedAt ? clock(r.startedAt) : '-'} (${formatDuration(now - (r.startedAt ?? now))} so far, ${r.attempts} automatic retr${r.attempts === 1 ? 'y' : 'ies'}).${r.reason ? ` Cause: ${r.reason}` : ''}`;
    case 'succeeded':
      return `Recovered after ${formatDuration((r.finishedAt ?? now) - (r.startedAt ?? now))} and ${r.attempts} automatic retr${r.attempts === 1 ? 'y' : 'ies'}.${r.reason ? ` Cause: ${r.reason}` : ''}`;
    case 'failed':
      return `Gave up after ${r.attempts} automatic retries (${formatDuration((r.finishedAt ?? now) - (r.startedAt ?? now))}). Use Reconnect to try again.${r.reason ? ` Cause: ${r.reason}` : ''}`;
    default:
      if (health.interruptedRecovery) {
        const i = health.interruptedRecovery;
        return `Recovery was interrupted: the stream was closed while it was still recovering${i.reason ? ` from "${i.reason}"` : ''}. It is unknown whether it would have reconnected.`;
      }
      return health.evidence === 'frames'
        ? 'No interruption seen since the page was loaded.'
        : 'No interruption detected. In plain video mode a mid-stream freeze is invisible to the page, so this does not rule one out.';
  }
}

/**
 * Stream health as the page can actually observe it. Camera reachability and stream state are
 * shown separately on purpose: a camera can answer pings while its video stream is stuck.
 */
export const StreamHealthCard: React.FC<StreamHealthCardProps> = ({ health, isMixedContent, onReconnect }) => {
  const now = useNow(true, 1000);
  const host = health.host;

  const evidenceText =
    health.evidence === 'frames'
      ? 'Every frame (Frame monitor on)'
      : 'First frame of each connection only (plain video element)';

  const frameLabel = health.evidence === 'frames' ? 'Last frame received' : 'First frame of this connection';

  return (
    <Panel
      id="stream-health"
      title="Stream health"
      icon={HeartPulse}
      description="What the browser can confirm about the live video. Nothing here is estimated or simulated."
      status={<ConnectionIndicator status={health.status} isMixedContent={isMixedContent} detail={describeStatus(health)} />}
      actions={
        <button
          type="button"
          onClick={onReconnect}
          className={BTN_SECONDARY}
          title={
            health.active
              ? 'Close the current stream connection and open one new one'
              : 'The Dashboard is not open, so this only re-checks that the camera host responds'
          }
        >
          <RefreshCw className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <span>{health.active ? 'Reconnect stream' : 'Check camera host'}</span>
        </button>
      }
    >
      {!health.active && (
        <Notice tone="info">
          <p>
            The live stream connection is only open while the Dashboard or AI Detection page is on screen in stream mode. Leaving it closed here
            keeps diagnostics from opening a second connection to a camera that may only serve one viewer.
          </p>
        </Notice>
      )}

      <dl>
        <Row label="Status">
          <span className="font-medium">{health.status.replace('_', ' ')}</span>
          <span className="text-slate-400"> - {describeStatus(health)}</span>
        </Row>
        <Row label="Evidence">{evidenceText}</Row>
        <Row label={frameLabel}>
          {health.lastFrameAt != null ? (
            <>
              {clock(health.lastFrameAt)} <span className="text-slate-400">({formatAgo(health.lastFrameAt, now)})</span>
            </>
          ) : (
            <span className="text-slate-400">no frame confirmed yet</span>
          )}
        </Row>
        {health.frameStats && (
          <Row label="Frame rate / gaps">
            {health.frameStats.fps5s} fps over the last 5 s - {health.frameStats.framesTotal} frames total - longest gap in
            the last 5 min: <strong>{formatDuration(health.frameStats.longestGapMs5min)}</strong>
          </Row>
        )}
        <Row label="Reconnect attempts">
          {health.attempt > 0 ? `${health.attempt} of ${health.maxAttempts} in the current recovery` : 'none in progress'}
          <span className="text-slate-400"> - {health.totalReconnects} reconnect{health.totalReconnects === 1 ? '' : 's'} since page load</span>
          {health.nextRetryAt != null && health.status === 'reconnecting' && (
            <span className="text-amber-300"> - next try in {Math.max(0, Math.ceil((health.nextRetryAt - now) / 1000))}s</span>
          )}
        </Row>
        <Row label="Recovery">{describeRecovery(health, now)}</Row>
        <Row label="Last error">
          {health.lastError ? (
            <>
              <span className="text-rose-300 font-mono text-xs">{health.lastError}</span>
              {health.lastErrorAt != null && <span className="text-slate-400"> ({clock(health.lastErrorAt)})</span>}
            </>
          ) : (
            <span className="text-slate-400">none</span>
          )}
        </Row>
        <Row label="Camera host">
          {health.hostChecking ? (
            <span className="text-cyan-300">checking...</span>
          ) : host.reachable === null ? (
            <span className="text-slate-400">not checked yet (checked when the stream has a problem, or use "Measure now" below)</span>
          ) : host.reachable ? (
            <>
              <span className="text-emerald-300">answers</span>
              {host.latencyMs != null && <span className="text-slate-400"> (request took {host.latencyMs} ms)</span>}
              {host.checkedAt != null && <span className="text-slate-400"> ({formatAgo(host.checkedAt, now)})</span>}
            </>
          ) : hostResultIsOutdated(health) ? (
            <>
              <span className="text-slate-300">earlier check: no answer</span>
              {host.checkedAt != null && <span className="text-slate-400"> ({formatAgo(host.checkedAt, now)})</span>}
              <span className="block text-slate-400 mt-0.5">Outdated: a video frame arrived after it, so the camera is reachable again.</span>
            </>
          ) : (
            <>
              <span className="text-rose-300">no answer</span>
              {host.checkedAt != null && <span className="text-slate-400"> ({formatAgo(host.checkedAt, now)})</span>}
              {host.error && <span className="block text-slate-400 font-mono text-xs mt-0.5">{host.error}</span>}
            </>
          )}
          <span className="block text-xs text-slate-400 mt-0.5">
            A host that answers does not mean the video is flowing, and the reverse.
          </span>
        </Row>
      </dl>

      {/* The curated, saved log is the Connection History card; this is the full trace of this page session. */}
      <Disclosure summary={`Detailed stream log of this page session (${health.events.length})`}>
        <div className="max-h-44 overflow-y-auto bg-sunken border border-line rounded-md p-2 font-mono text-xs space-y-0.5">
          {health.events.length === 0 ? (
            <div className="text-slate-400">Nothing has happened yet.</div>
          ) : (
            [...health.events].reverse().map((e, i) => (
              <div key={`${e.t}-${i}`} className={LEVEL_STYLE[e.level]}>
                <span className="text-slate-400">{clock(e.t)}</span> {e.message}
              </div>
            ))
          )}
        </div>
        <Hint>The same events, curated and saved between visits, are in Connection history.</Hint>
      </Disclosure>
    </Panel>
  );
};

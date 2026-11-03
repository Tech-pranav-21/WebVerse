/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Activity, Trash2 } from 'lucide-react';
import type { CameraConfig, StreamHealth, SurveillanceViewMode } from '../types/camera';
import type { MotionEvent, MotionStatus } from '../types/motion';
import { useMotionDetection } from '../hooks/useMotionDetection';
import { useNow } from '../hooks/useNow';
import type { SmartSnapshotApi } from '../hooks/useSmartSnapshot';
import { formatAgo, formatEventTime } from '../services/streamStatusText';
import { describeSnapshotLink } from '../services/snapshotLinkText';
import { REGION_LABELS, SENSITIVITY_PRESETS, effectiveParams } from '../services/motionSettings';
import { SnapshotImage } from './SnapshotImage';
import { MotionAdvancedFields, MotionQuickFields } from './settingsFields';
import {
  BTN_DANGER_SOLID,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BadgeTone,
  Code,
  Disclosure,
  Hint,
  Notice,
  Panel,
  StatusBadge,
  Toggle,
} from './ui';

interface MotionDetectionPanelProps {
  viewMode: SurveillanceViewMode;
  isStreamConfigured: boolean;
  health: StreamHealth;
  /** The element showing the live stream (see useStreamConnection). */
  getImage: () => HTMLImageElement | null;
  streamUrl: string;
  config: CameraConfig;
  smart: SmartSnapshotApi;
  /** Turns on Settings > "Allow snapshot capture" (also what lets the page read the picture). */
  onEnableCapture: () => void;
  /** Told about every new motion alert (the AI recognition panel listens through this). */
  onMotionEvent?: (event: MotionEvent) => void;
  /** Opens the Event History page on the motion events. */
  onViewAll?: () => void;
}

const STATUS_VIEW: Record<MotionStatus, { label: string; tone: BadgeTone }> = {
  off: { label: 'Off', tone: 'neutral' },
  starting: { label: 'Starting', tone: 'warn' },
  active: { label: 'Active', tone: 'good' },
  motion: { label: 'Motion detected', tone: 'bad' },
  paused: { label: 'Paused', tone: 'neutral' },
  'camera-disconnected': { label: 'Camera disconnected', tone: 'warn' },
  blocked: { label: 'Frame access blocked', tone: 'warn' },
  error: { label: 'Error', tone: 'bad' },
};

/** How many events the card lists; the rest are on the Event History page. */
const RECENT_COUNT = 5;

/** The colour class snapshotLinkText chose, as a badge tone. */
function badgeToneFor(textClass: string): BadgeTone {
  if (textClass.includes('emerald')) return 'good';
  if (textClass.includes('amber')) return 'warn';
  if (textClass.includes('rose')) return 'bad';
  return 'neutral';
}

/** The snapshot was saved and still exists in the gallery. */
const snapSaved = (event: MotionEvent, snap: { tone: string }) =>
  event.snapshot.status === 'saved' && snap.tone.includes('emerald');

/**
 * Motion Detection card of the AI Detection page. It compares consecutive frames of the stream
 * already shown on screen (no extra camera connection) and never claims detection is running
 * unless frames are really being compared. See services/motionMonitor.ts for the rules.
 */
export const MotionDetectionPanel: React.FC<MotionDetectionPanelProps> = ({
  viewMode,
  isStreamConfigured,
  health,
  getImage,
  streamUrl,
  config,
  smart,
  onEnableCapture,
  onMotionEvent,
  onViewAll,
}) => {
  const motion = useMotionDetection({
    getImage,
    viewing: viewMode === 'stream' && isStreamConfigured,
    connected: health.status === 'connected',
    statusLabel: health.status.replace('_', ' '),
    streamUrl,
    corsRequested: Boolean(config.captureCors),
    smart,
    onMotionEvent,
  });
  const { state, history } = motion;
  const { settings } = state;

  const running = state.status !== 'off';
  const live = state.status === 'starting' || state.status === 'active' || state.status === 'motion';
  const now = useNow(running, 1000);
  const view = STATUS_VIEW[state.status];
  const params = effectiveParams(settings);
  const galleryById = React.useMemo(() => new Map(smart.items.map((i) => [i.id, i])), [smart.items]);
  const galleryIds = React.useMemo(() => new Set(galleryById.keys()), [galleryById]);
  const startDisabled = running || viewMode !== 'stream' || !isStreamConfigured;
  const readsPixelsNow = Boolean(config.captureCors || config.frameMonitor);
  const recent = history.events.slice(0, RECENT_COUNT);

  return (
    <Panel
      id="motion"
      title="Motion Detection"
      icon={Activity}
      description="Compares consecutive camera frames in this browser and alerts when enough of the picture changes. Nothing is sent anywhere. Not a security-grade detector."
      status={
        <>
          {/* While it is off the switch says so; the badge adds the detail once it runs (starting, paused, blocked...). */}
          <span role="status" aria-live="polite">
            {running && <StatusBadge tone={view.tone}>{view.label}</StatusBadge>}
          </span>
          <Toggle
            checked={running}
            onChange={(on) => (on ? motion.start() : motion.stop())}
            label="Motion detection"
            disabled={!running && startDisabled}
          />
        </>
      }
    >
      {viewMode !== 'stream' && !running && <Hint>Switch to Live Stream mode to use motion detection.</Hint>}
      {!isStreamConfigured && <Hint>Set the stream path in Settings first.</Hint>}

      {/* Alert */}
      {state.status === 'motion' && state.lastEvent && (
        <Notice tone="bad" role="alert">
          <p>
            Motion detected at {formatEventTime(state.lastEvent.t, now)}: {state.lastEvent.changedPercent}% of the picture
            changed (alert level {state.lastEvent.thresholdPercent}%).
          </p>
        </Notice>
      )}

      {/* Why it is not (fully) running */}
      {state.message && state.status !== 'off' && state.status !== 'motion' && (
        <Notice tone={state.status === 'error' ? 'bad' : state.status === 'paused' ? 'info' : 'warn'}>
          <p>{state.message}</p>
          {state.status === 'blocked' && (
            <>
              {readsPixelsNow ? (
                <p>
                  Pixel access is already requested (Settings), yet the browser still refuses. Press Reconnect so the stream
                  reloads. If it keeps failing, the camera is not sending <Code>Access-Control-Allow-Origin</Code> on its
                  stream; only the camera firmware (or serving this page from the camera's own address) can fix that. This
                  dashboard cannot.
                </p>
              ) : (
                <>
                  <p>
                    The live picture is shown as a plain cross-origin image, which the browser never lets a page read. Turn
                    on "Allow snapshot capture" so the stream is requested with CORS. This works only if the camera sends{' '}
                    <Code>Access-Control-Allow-Origin</Code> on <Code>/stream</Code>. Detection resumes by itself once the
                    stream reconnects.
                  </p>
                  <button type="button" onClick={onEnableCapture} className={BTN_PRIMARY}>
                    Allow snapshot capture
                  </button>
                </>
              )}
            </>
          )}
        </Notice>
      )}

      <MotionQuickFields settings={settings} onChange={motion.configure} idPrefix="motion" />

      <Disclosure summary="Advanced Detection Settings">
        <MotionAdvancedFields settings={settings} onChange={motion.configure} idPrefix="motion" />
      </Disclosure>

      {/* Live readout */}
      {running && (
        <p
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono tabular-nums text-slate-300"
          aria-label="Detection measurements"
        >
          <span>Last check {formatAgo(state.lastCheckAt, now)}</span>
          {live && state.lastChangedPercent != null && (
            <span>
              Changed {state.lastChangedPercent.toFixed(1)}% (alert at {params.minChangedPercent}%)
            </span>
          )}
          <span>
            {state.framesCompared} frame{state.framesCompared === 1 ? '' : 's'} compared
          </span>
          <span>{state.duplicateFramesSkipped} repeated skipped</span>
          {state.cooldownUntil != null && (
            <span>Cooldown {Math.max(0, Math.ceil((state.cooldownUntil - now) / 1000))} s</span>
          )}
        </p>
      )}

      {/* Recent events */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Recent Motion Events</h3>
          <div className="flex flex-wrap items-center gap-2">
            {motion.confirmingClear ? (
              <>
                <button type="button" onClick={motion.requestClearHistory} className={BTN_DANGER_SOLID}>
                  Yes, clear motion history
                </button>
                <button type="button" onClick={motion.cancelClearHistory} className={BTN_SECONDARY}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={motion.requestClearHistory}
                disabled={history.events.length === 0}
                className={BTN_GHOST}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>Clear history</span>
              </button>
            )}
            {onViewAll && (
              <button type="button" onClick={onViewAll} className={BTN_SECONDARY}>
                View All{history.events.length > RECENT_COUNT ? ` (${history.events.length})` : ''}
              </button>
            )}
          </div>
        </div>

        <ul aria-label="Recent motion events" className="rounded-lg bg-sunken border border-line divide-y divide-line">
          {recent.length === 0 ? (
            <li className="p-3 text-[13px] text-slate-400 leading-relaxed">
              No motion events yet. An event is recorded when enough of the picture changes for the set number of frames,
              and at most once per cooldown.
            </li>
          ) : (
            recent.map((event) => {
              const snap = describeSnapshotLink(event.snapshot, galleryIds);
              const thumb = event.snapshot.snapshotId ? galleryById.get(event.snapshot.snapshotId) : undefined;
              return (
                <li key={event.id} className="flex items-center gap-3 p-3">
                  {thumb ? (
                    <SnapshotImage
                      item={thumb}
                      alt={`Snapshot taken at the motion alert at ${formatEventTime(event.t, now)}`}
                      className="w-24 aspect-video shrink-0 rounded-md object-cover bg-black"
                    />
                  ) : (
                    <span
                      className="w-24 aspect-video shrink-0 rounded-md bg-surface border border-line flex items-center justify-center text-rose-300"
                      aria-hidden="true"
                    >
                      <Activity className="w-6 h-6" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5 text-[13px]">
                    <div className="font-semibold text-white">Motion detected</div>
                    <div className="font-mono text-xs tabular-nums text-slate-300">
                      {new Date(event.t).toLocaleTimeString(undefined, { hour12: false })},{' '}
                      {new Date(event.t).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                    <div className="text-xs text-slate-400">
                      {event.changedPercent}% changed (alert level {event.thresholdPercent}%),{' '}
                      {SENSITIVITY_PRESETS[event.sensitivity].label.toLowerCase()} sensitivity,{' '}
                      {REGION_LABELS[event.region].toLowerCase()}
                    </div>
                    {/* What happened to the optional snapshot, in words (a saved one also gets the badge on the right) */}
                    {snap && <div className={`text-xs ${snap.tone} ${snapSaved(event, snap) ? '@sm:hidden' : ''}`}>{snap.text}</div>}
                  </div>
                  {snap && snapSaved(event, snap) && (
                    <StatusBadge tone={badgeToneFor(snap.tone)} className="hidden @sm:inline-flex shrink-0">
                      Snapshot saved
                    </StatusBadge>
                  )}
                </li>
              );
            })
          )}
        </ul>
        {history.storage.status === 'memory-only' && history.storage.reason && (
          <p className="text-xs text-amber-300">{history.storage.reason}</p>
        )}
        {history.storage.status === 'persistent' && history.storage.reason && (
          <Hint>{history.storage.reason}</Hint>
        )}
        <Hint>
          Events are saved in this browser (newest 100). Changes in lighting, shadows, camera vibration and the camera's
          automatic exposure can trigger false alerts, and very slow movement can be missed.
        </Hint>
      </div>
    </Panel>
  );
};

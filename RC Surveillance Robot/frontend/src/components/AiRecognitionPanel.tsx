/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ChevronRight, Loader2, ScanSearch, Trash2, Wifi, WifiOff } from 'lucide-react';
import type { CameraConfig, StreamHealth, SurveillanceViewMode } from '../types/camera';
import type { AiEvent } from '../types/ai';
import { RecognizedObject } from '../../server/protocol';
import { useAiRecognition } from '../hooks/useAiRecognition';
import { useNow } from '../hooks/useNow';
import type { SmartSnapshotApi } from '../hooks/useSmartSnapshot';
import type { MotionEventBus } from '../services/motionEventBus';
import { CATEGORY_LABELS } from '../services/aiSettings';
import { describeSnapshotLink } from '../services/snapshotLinkText';
import { formatEventTime } from '../services/streamStatusText';
import { SnapshotImage } from './SnapshotImage';
import { AiSettingsFields } from './settingsFields';
import {
  BTN_DANGER_SOLID,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BadgeTone,
  Disclosure,
  Hint,
  Notice,
  Panel,
  StatusBadge,
} from './ui';

export interface AiRecognitionPanelProps {
  feedSlot?: React.ReactNode;
  viewMode: SurveillanceViewMode;
  isStreamConfigured: boolean;
  health: StreamHealth;
  getImage: () => HTMLImageElement | null;
  streamUrl: string;
  config: CameraConfig;
  smart: SmartSnapshotApi;
  motionBus: MotionEventBus;
  /** Turns on Settings > "Allow snapshot capture" (what lets the page read the picture's pixels). */
  onEnableCapture: () => void;
  /**
   * True after "AI Analyze" was pressed on the Dashboard: run ONE analysis as soon as the picture is
   * there, but only if external AI processing is switched on.
   */
  analyzePending?: boolean;
  /** Tells the page the request was run, skipped or timed out, so it never fires twice. */
  onAnalyzeHandled?: () => void;
  /** Opens the Event History page on the AI recognitions. */
  onViewAll?: () => void;
  /** Reports the calculated AI service status badge up to the page header. */
  onStatusChange?: (badge: { label: string; tone: BadgeTone; busy?: boolean }) => void;
}

const categoryName = (c: string) =>
  c in CATEGORY_LABELS ? CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] : c === 'unknown' ? 'Unknown' : c === 'none' ? 'Nothing recognised' : c;
const singular = (c: string) =>
  ({ person: 'Person', animal: 'Animal', vehicle: 'Vehicle', other: 'Other', unknown: 'Unknown', none: 'None' } as Record<string, string>)[c] ?? c;

const waitText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`;
};

const CHIP = 'inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium';
/** How many recognitions the card lists; the rest are on the Event History page. */
const RECENT_COUNT = 5;
/** A pending Dashboard request is dropped after this long if the picture or backend never became ready. */
const PENDING_TIMEOUT_MS = 15_000;

export const AiRecognitionPanel: React.FC<AiRecognitionPanelProps> = ({
  feedSlot,
  viewMode,
  isStreamConfigured,
  health,
  getImage,
  streamUrl,
  config,
  smart,
  motionBus,
  onEnableCapture,
  analyzePending = false,
  onAnalyzeHandled,
  onViewAll,
  onStatusChange,
}) => {
  const ai = useAiRecognition({
    getImage,
    viewing: viewMode === 'stream' && isStreamConfigured,
    connected: health.status === 'connected',
    statusLabel: health.status.replace('_', ' '),
    streamUrl,
    corsRequested: Boolean(config.captureCors),
    smart,
    motionBus,
  });
  const { state, history } = ai;
  const { settings, backend } = state;
  const now = useNow(state.blockedUntil !== null || state.autoCooldownUntil !== null || state.analyzing, 1000);
  const galleryById = React.useMemo(() => new Map(smart.items.map((i) => [i.id, i])), [smart.items]);
  const galleryIds = React.useMemo(() => new Set(galleryById.keys()), [galleryById]);

  const blockedMs = state.blockedUntil !== null ? state.blockedUntil - now : 0;
  const waiting = blockedMs > 0;
  const status = backend.kind === 'ready' || backend.kind === 'not-configured' ? backend.status : undefined;
  const backendProblem =
    backend.kind === 'not-configured'
      ? 'The AI backend is running but has no Groq key configured. Add it to the server settings (.env) and restart the backend. See the README, section 16.'
      : backend.kind === 'unreachable'
        ? backend.message
        : backend.kind === 'error'
          ? backend.message
          : null;
  const canAnalyze = settings.enabled && !state.analyzing && !waiting && viewMode === 'stream' && isStreamConfigured && backend.kind !== 'not-configured';

  // "AI Analyze" on Dashboard handling
  const [skippedNote, setSkippedNote] = useState<string | null>(null);
  const aiRef = useRef(ai);
  aiRef.current = ai;
  const readyRef = useRef(false);
  readyRef.current = canAnalyze && health.status === 'connected';

  useEffect(() => {
    if (!analyzePending) return;
    if (!settings.enabled) {
      setSkippedNote('AI Analyze did not run: external AI processing is off. Enable it below, then click Analyze Current Frame.');
      onAnalyzeHandled?.();
      return;
    }
    const timer = setInterval(() => {
      const img = getImage();
      if (!readyRef.current || !img || !img.complete || img.naturalWidth === 0) return;
      clearInterval(timer);
      setSkippedNote(null);
      onAnalyzeHandled?.();
      void aiRef.current.analyze();
    }, 250);
    const giveUp = setTimeout(() => {
      clearInterval(timer);
      onAnalyzeHandled?.();
    }, PENDING_TIMEOUT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [analyzePending, settings.enabled, getImage, onAnalyzeHandled]);

  let badge: { label: string; tone: BadgeTone; busy?: boolean } = { label: 'Off', tone: 'neutral' };
  if (settings.enabled) {
    badge =
      state.analyzing
        ? { label: 'Analyzing', tone: 'warn', busy: true }
        : backend.kind === 'ready'
          ? { label: 'Ready', tone: 'good' }
          : backend.kind === 'checking' || backend.kind === 'unknown'
            ? { label: 'Checking', tone: 'neutral', busy: true }
            : { label: 'Backend problem', tone: 'bad' };
  }

  // Sync AI status badge to page header
  useEffect(() => {
    onStatusChange?.(badge);
  }, [badge.label, badge.tone, badge.busy, onStatusChange]);

  const current: AiEvent | null = state.current;
  const currentThumb = current?.snapshot.snapshotId ? galleryById.get(current.snapshot.snapshotId) : undefined;
  const matchingCategories = (e: AiEvent) =>
    e.objects.filter((o) => !o.uncertain && o.category !== 'unknown' && settings.categories[o.category as keyof typeof settings.categories]);
  const recent = history.events.slice(0, RECENT_COUNT);

  // Snapshot capture handler from live stream
  const handleCaptureSnapshot = useCallback(async () => {
    const img = getImage();
    await smart.captureStill({
      kind: 'live',
      image: img,
      connected: health.status === 'connected',
      statusLabel: health.status.replace('_', ' '),
      sourceUrl: streamUrl,
      corsRequested: Boolean(config.captureCors),
    });
  }, [getImage, smart, health.status, streamUrl, config.captureCors]);

  // Camera connection status presentation
  const camStatus: { label: string; tone: BadgeTone } =
    health.status === 'connected'
      ? { label: 'Camera Connected', tone: 'good' }
      : health.status === 'reconnecting'
        ? { label: 'Camera Reconnecting', tone: 'warn' }
        : health.status === 'connecting'
          ? { label: 'Camera Connecting', tone: 'warn' }
          : health.status === 'error'
            ? { label: 'Camera Offline', tone: 'bad' }
            : health.status === 'host_reachable'
              ? { label: 'Host Reachable', tone: 'accent' }
              : health.status === 'unconfigured'
                ? { label: 'Camera Unconfigured', tone: 'neutral' }
                : { label: 'Camera Disconnected', tone: 'neutral' };

  return (
    <Panel
      id="ai"
      title="Groq AI Recognition"
      icon={ScanSearch}
      description="Vision AI analysis of the live ESP32-CAM video stream. Analyzes single frames on demand or automatically when motion is detected."
      status={
        <StatusBadge role="status" aria-live="polite" tone={badge.tone} busy={badge.busy}>
          {badge.label}
        </StatusBadge>
      }
    >
      {/* ====================================================================
          TOP LEVEL: Prominent Camera Preview & Live Action Section
         ==================================================================== */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Prominent Live Camera Preview */}
        <div className="lg:col-span-7 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              Live Source Preview
            </span>
            <StatusBadge tone={camStatus.tone} dot={true}>
              {camStatus.label}
            </StatusBadge>
          </div>

          {/* Prominent Video Slot */}
          <div className="w-full rounded-xl overflow-hidden border border-line bg-black shadow-[0_0_30px_-12px_rgba(30,140,255,0.4)]">
            {feedSlot}
          </div>

          {/* Camera Controls Under Preview */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCaptureSnapshot()}
                disabled={smart.capturing || health.status !== 'connected'}
                className={BTN_SECONDARY}
                title="Capture current video frame into snapshot gallery"
              >
                {smart.capturing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" aria-hidden="true" />
                ) : (
                  <Camera className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                )}
                <span>{smart.capturing ? 'Capturing Still...' : 'Capture Snapshot'}</span>
              </button>
            </div>
            {health.status === 'connected' && (
              <span className="font-mono text-[11px] text-slate-400">
                Format: {config.captureCors ? 'CORS Enhanced' : 'Standard MJPEG'}
              </span>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: AI Recognition Actions & Latest Result */}
        <div className="lg:col-span-5 space-y-4 min-w-0">
          {/* Analyze Current Frame Action Button */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void ai.analyze()}
              disabled={!canAnalyze}
              className={`${BTN_PRIMARY} w-full h-11 text-sm font-semibold shadow-[0_0_20px_-6px_rgba(40,150,255,0.8)]`}
            >
              {state.analyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <ScanSearch className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{state.analyzing ? 'Analyzing Frame with Groq...' : 'Analyze Current Frame'}</span>
            </button>

            {/* Quick status reminders */}
            {!settings.enabled && (
              <p className="text-xs text-amber-300/90 text-center">
                External AI processing is off. Enable it in Advanced Settings below.
              </p>
            )}
            {settings.enabled && waiting && (
              <p className="text-xs text-amber-300 text-center">
                Rate limit active: {waitText(blockedMs)} remaining.
              </p>
            )}
            {settings.enabled && viewMode !== 'stream' && (
              <p className="text-xs text-amber-300 text-center">
                Switch to Live Stream mode to analyze camera frames.
              </p>
            )}
            {skippedNote && !settings.enabled && (
              <Notice tone="info" role="status">
                <p className="text-xs">{skippedNote}</p>
              </Notice>
            )}
            {backendProblem && settings.enabled && (
              <Notice tone="bad">
                <p className="text-xs">{backendProblem}</p>
                <button type="button" onClick={() => void ai.refreshBackend()} className={`${BTN_SECONDARY} !h-7 !text-xs mt-1`}>
                  Check again
                </button>
              </Notice>
            )}
            {state.notice && (
              <Notice tone={state.notice.kind === 'error' ? 'bad' : 'info'} role={state.notice.kind === 'error' ? 'alert' : 'status'}>
                <p className="text-xs">{state.notice.message}</p>
                {state.notice.action === 'enable-capture' && (
                  <button type="button" onClick={onEnableCapture} className={`${BTN_PRIMARY} !h-7 !text-xs mt-1`}>
                    Allow snapshot capture
                  </button>
                )}
              </Notice>
            )}
          </div>

          {/* Active Model Indicator */}
          <div className="px-3 py-2 rounded-lg bg-sunken border border-line text-xs font-mono text-slate-300 flex items-center justify-between">
            <span className="text-slate-400">Model:</span>
            <span className="text-cyan-300 font-semibold truncate max-w-[200px]" title={status?.model}>
              {status ? status.model : 'Groq Vision (ready)'}
            </span>
          </div>

          {/* Latest Recognition Result Card */}
          <div
            className="rounded-xl border border-line bg-sunken p-4 space-y-3 min-w-0"
            aria-label="Current recognition result"
            aria-busy={state.analyzing}
          >
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Latest Recognition Result
              </h3>
              {current && (
                <span className="text-xs font-mono text-slate-400">
                  {formatEventTime(current.t, now)}
                </span>
              )}
            </div>

            {state.analyzing ? (
              <div role="status" className="py-6 flex flex-col items-center justify-center space-y-2 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" aria-hidden="true" />
                <p className="text-xs text-slate-300">
                  Asking Groq Vision to analyze this frame...
                </p>
              </div>
            ) : !current ? (
              <div className="py-6 text-center text-xs text-slate-400 space-y-1">
                <p className="font-medium text-slate-300">No frame analyzed yet</p>
                <p>Click "Analyze Current Frame" above to inspect the live feed.</p>
              </div>
            ) : current.status === 'failed' ? (
              <Notice tone="bad" role="alert">
                <p className="text-xs font-medium">Recognition failed</p>
                <p className="text-xs text-rose-300">{current.error?.message}</p>
              </Notice>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  {currentThumb && (
                    <SnapshotImage
                      item={currentThumb}
                      alt="Analyzed camera frame"
                      className="w-24 sm:w-28 aspect-video shrink-0 rounded-md object-cover bg-black border border-line"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    {current.summary && (
                      <p className="text-sm leading-relaxed text-white font-medium">
                        {current.summary}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-mono text-slate-400">
                      <span>{current.trigger === 'motion' ? 'Trigger: Motion' : 'Trigger: Manual'}</span>
                      {current.latencyMs != null && <span>{(current.latencyMs / 1000).toFixed(1)}s latency</span>}
                      {current.usage && <span>{current.usage.promptTokens + current.usage.completionTokens} tokens</span>}
                    </div>
                  </div>
                </div>

                {/* Detected Object Badges */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Detected Object Labels ({current.objects.length})
                  </div>
                  {current.objects.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No specific objects recognized</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {current.objects.map((o, i) => (
                        <li key={`${o.label}-${i}`} className={`${CHIP} border-cyan-500/40 bg-cyan-500/10 text-cyan-200`}>
                          <span className="font-semibold">{o.label}</span>
                          <span className="text-slate-400 ml-1">({singular(o.category)})</span>
                          {o.uncertain && <span className="ml-1 text-amber-300 text-[10px]">?</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {(() => {
                  const snap = describeSnapshotLink(current.snapshot, galleryIds);
                  return snap ? <p className={`text-xs ${snap.tone}`}>{snap.text}</p> : null;
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====================================================================
          C. Compact Collapsible AI Settings & Privacy Disclosures
         ==================================================================== */}
      <Disclosure summary="Advanced AI Settings" defaultOpen={false}>
        <div className="space-y-4 pt-2">
          {/* External AI Consent Switch & Privacy Disclosure */}
          <div className="p-3.5 rounded-lg border border-edge bg-raised/40 space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => {
                  ai.configure({ enabled: e.target.checked });
                  if (e.target.checked) void ai.refreshBackend();
                }}
                className="accent-cyan-400 w-4 h-4 shrink-0 mt-0.5"
              />
              <div className="space-y-0.5">
                <span className="text-[13px] font-medium text-white">
                  Enable external AI processing (Groq Vision)
                </span>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Off by default. When enabled, single JPEG frames are sent through this app's backend to Groq for visual recognition.
                  Switching this off immediately prevents any frames from leaving your network.
                </p>
              </div>
            </label>

            <Notice tone="warn">
              <p className="text-xs leading-relaxed text-amber-200/90">
                <strong>Privacy Disclosure:</strong> One frame at a time is sent to Groq only when you click Analyze or when motion is verified (if configured). Groq does not retain inference data by default, though diagnostic logs may be kept temporarily. Zero Data Retention can be configured in your Groq account.
              </p>
            </Notice>
          </div>

          {/* AI Settings Fields: Automatic on motion, Categories */}
          <AiSettingsFields settings={settings} onChange={ai.configure} idPrefix="ai-panel" />

          {settings.autoOnMotion && state.autoCooldownUntil !== null && state.autoCooldownUntil > now && (
            <p className="text-xs font-mono text-slate-300">
              Next automatic analysis available in {waitText(state.autoCooldownUntil - now)}.
            </p>
          )}

          {/* Usage & Quota Info */}
          <div className="p-3 rounded-lg bg-sunken border border-line text-xs font-mono text-slate-300 space-y-1">
            <div className="font-semibold text-slate-200">API Usage & Rate Limits</div>
            <p className="text-slate-400">
              Analyses this session: {state.requestsThisSession}
              {status && ` • Server limits: ${status.limits.perMinute}/min, ${status.limits.remainingToday}/${status.limits.perDay} remaining today`}
            </p>
            <p className="text-slate-400 text-[11px]">
              Model: {status?.model || 'llama-3.2-11b-vision-preview'} • ~2,500 tokens per analysis
            </p>
          </div>

          {/* Recent Recognitions List with Clear History */}
          <div className="space-y-2 pt-2 border-t border-line">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Recent Recognitions
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                {ai.confirmingClear ? (
                  <>
                    <button type="button" onClick={ai.requestClearHistory} className={BTN_DANGER_SOLID}>
                      Confirm Clear
                    </button>
                    <button type="button" onClick={ai.cancelClearHistory} className={BTN_SECONDARY}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={ai.requestClearHistory}
                    disabled={history.events.length === 0}
                    className={BTN_GHOST}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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

            <ul aria-label="Recent recognitions" className="rounded-lg bg-sunken border border-line divide-y divide-line text-xs">
              {recent.length === 0 ? (
                <li className="p-3 text-slate-400">No recognition history recorded yet.</li>
              ) : (
                recent.map((event) => {
                  const snap = describeSnapshotLink(event.snapshot, galleryIds);
                  const thumb = event.snapshot.snapshotId ? galleryById.get(event.snapshot.snapshotId) : undefined;
                  const kinds = Array.from(new Set(event.objects.map((o) => o.category)));
                  return (
                    <li key={event.id} className="flex gap-3 p-3 items-center">
                      {thumb && (
                        <SnapshotImage
                          item={thumb}
                          alt="Analyzed frame thumbnail"
                          className="w-16 aspect-video shrink-0 rounded object-cover bg-black"
                        />
                      )}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">
                            {event.summary || categoryName(event.category)}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {formatEventTime(event.t, now)} ({event.trigger === 'motion' ? 'motion' : 'manual'})
                          </span>
                        </div>
                        {event.status === 'failed' ? (
                          <p className="text-rose-300">{event.error?.message}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {kinds.map((k) => (
                              <span key={k} className={`${CHIP} border-edge text-slate-300 text-[10px]`}>
                                {singular(k)}
                              </span>
                            ))}
                          </div>
                        )}
                        {snap && <div className={`text-[11px] ${snap.tone}`}>{snap.text}</div>}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>
      </Disclosure>
    </Panel>
  );
};

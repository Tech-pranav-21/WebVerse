/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  AlertTriangle,
  WifiOff,
  SlidersHorizontal,
  Loader2,
  RefreshCw,
  Maximize2,
  Minimize2,
  Settings,
  HelpCircle,
  Camera,
  Image as ImageIcon,
  Video,
  ScanSearch,
  Crosshair,
  Scan,
  Bot,
} from 'lucide-react';
import {
  CameraConfig,
  StreamHealth,
  SurveillanceViewMode,
} from '../types/camera';
import { SnapshotNoticeBanner } from './SnapshotNoticeBanner';
import { ActionButton, BTN_ICON, BTN_PRIMARY, BTN_SECONDARY, BadgeTone, Code, StatusBadge } from './ui';
import { useNow } from '../hooks/useNow';
import { useObjectUrl } from '../hooks/useObjectUrl';
import type { SmartSnapshotApi } from '../hooks/useSmartSnapshot';
import { describeReachability, formatDuration } from '../services/streamStatusText';

export interface CameraFeedBoxProps {
  config: CameraConfig;
  streamUrl: string;
  isStreamConfigured: boolean;
  /** Live stream state, owned by StreamConnection (see useStreamConnection). */
  health: StreamHealth;
  /** Ref callback for the stream <img>; the connection manager sets its `src`. */
  attachImage: (element: HTMLImageElement | null) => void;
  isMixedContent: boolean;
  viewMode: SurveillanceViewMode;
  onToggleViewMode: (mode: SurveillanceViewMode) => void;
  onReconnect: () => void;
  onOpenSettings: () => void;
  onOpenNetworkGuide: () => void;
  /** Smart Snapshot: capture, gallery and notifications (see useSmartSnapshot). */
  smart: SmartSnapshotApi;
  /** Turns on Settings > "Allow snapshot capture" (the one-click remedy offered in a capture error). */
  onEnableCapture: () => void;
  /**
   * 'hero' (Dashboard): title row, large picture and the action buttons.
   * 'compact' (AI Detection): responsive sizing inside panel.
   */
  variant?: 'hero' | 'compact';
}

export interface CameraViewProps extends Partial<CameraFeedBoxProps> {
  config: CameraConfig;
  streamUrl: string;
  isStreamConfigured: boolean;
  health: StreamHealth;
  attachImage?: (element: HTMLImageElement | null) => void;
  getImage?: () => HTMLImageElement | null;
  isMixedContent: boolean;
  viewMode: SurveillanceViewMode;
  onToggleViewMode: (mode: SurveillanceViewMode) => void;
  onReconnect: () => void;
  onOpenSettings: () => void;
  onOpenNetworkGuide: () => void;
  smart: SmartSnapshotApi;
  onEnableCapture: () => void;
  variant?: 'hero' | 'compact';
  /** Hero only: the "AI Analyze" button opens AI Detection and starts one analysis there. */
  onAiAnalyze?: () => void;
  /** Hero only: shown under the action buttons (the camera information card). */
  sidePanel?: React.ReactNode;
  /** When a persistent feed slot is provided, CameraView renders the layout around it without unmounting the video. */
  feedSlot?: React.ReactNode;
}

type MessageTone = 'neutral' | 'warn' | 'bad';

const MESSAGE_ICON_BOX: Record<MessageTone, string> = {
  neutral: 'bg-raised border-edge text-slate-300',
  warn: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  bad: 'bg-rose-500/10 border-rose-500/30 text-rose-300',
};

/** A message shown in the middle of the picture area (not configured, blocked, unavailable). */
const FeedMessage: React.FC<{
  tone?: MessageTone;
  icon: React.ReactNode;
  title: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ tone = 'neutral', icon, title, actions, children }) => (
  <div className="max-w-md p-5 text-center z-10 space-y-3">
    <div className={`w-11 h-11 mx-auto rounded-lg border flex items-center justify-center ${MESSAGE_ICON_BOX[tone]}`}>
      {icon}
    </div>
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {children}
    </div>
    {actions && <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">{actions}</div>}
  </div>
);

/**
 * CameraFeedBox - The standalone, persistent video box holding the <img> element,
 * OSD overlays, fullscreen and fit controls. Can be safely reparented in the DOM
 * across page navigation so the underlying stream connection never disconnects.
 */
export const CameraFeedBox: React.FC<CameraFeedBoxProps> = ({
  config,
  streamUrl,
  isStreamConfigured,
  health,
  attachImage,
  isMixedContent,
  viewMode,
  onToggleViewMode,
  onReconnect,
  onOpenSettings,
  onOpenNetworkGuide,
  smart,
  onEnableCapture,
  variant = 'hero',
}) => {
  const hero = variant === 'hero';
  const containerRef = useRef<HTMLDivElement>(null);
  const streamImgRef = useRef<HTMLImageElement | null>(null);
  const setStreamImg = useCallback(
    (element: HTMLImageElement | null) => {
      streamImgRef.current = element;
      attachImage(element);
    },
    [attachImage],
  );

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showReticle, setShowReticle] = useState(false);
  const [objectFit, setObjectFit] = useState<'contain' | 'cover'>('contain');

  const status = health.status;
  const streamLoaded = status === 'connected';
  const streamFailed = status === 'error';
  const now = useNow(status === 'reconnecting');
  const retryInSec =
    health.nextRetryAt != null ? Math.max(0, Math.ceil((health.nextRetryAt - now) / 1000)) : null;
  const reachabilityNote = describeReachability(health);

  const [preview, setPreview] = useState<{ blob: Blob; capturedAt: number } | null>(null);
  const previewUrl = useObjectUrl(preview?.blob);
  const snapshotLoading = smart.capturing;
  const [snapshotIntervalSec, setSnapshotIntervalSec] = useState<number>(0);
  const snapshotSessionRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentFs = document.fullscreenElement === containerRef.current;
      setIsFullscreen(isCurrentFs);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        void containerRef.current.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
      }
    }
  };

  const snapshotView = viewMode === 'snapshot';
  useEffect(() => {
    if (!snapshotView) {
      snapshotSessionRef.current?.abort();
      snapshotSessionRef.current = null;
      setSnapshotIntervalSec(0);
    }
  }, [snapshotView]);

  const handleSnapshotCapture = useCallback(async () => {
    snapshotSessionRef.current?.abort();
    const ctrl = new AbortController();
    snapshotSessionRef.current = ctrl;

    const outcome = await smart.captureStill({
      kind: 'stream',
      url: streamUrl,
      signal: ctrl.signal,
    });
    if (outcome.status === 'saved' || outcome.status === 'session-only') {
      setPreview({ blob: outcome.item.blob, capturedAt: outcome.item.timestamp });
    }
  }, [smart, streamUrl]);

  useEffect(() => {
    if (!snapshotView || snapshotIntervalSec <= 0) return;
    const ms = Math.max(2, snapshotIntervalSec) * 1000;
    const timer = setInterval(() => {
      void handleSnapshotCapture();
    }, ms);
    return () => clearInterval(timer);
  }, [snapshotView, snapshotIntervalSec, handleSnapshotCapture]);

  const osd: { label: string; dot: string } = snapshotView
    ? { label: 'Snapshot mode', dot: 'bg-cyan-400' }
    : !isStreamConfigured
      ? { label: 'Not configured', dot: 'bg-slate-500' }
      : streamLoaded
        ? { label: 'Connected', dot: 'bg-emerald-400' }
        : streamFailed
          ? { label: 'Connection error', dot: 'bg-rose-400' }
          : status === 'reconnecting'
            ? { label: 'Reconnecting', dot: 'bg-amber-400 animate-pulse' }
            : { label: 'Connecting', dot: 'bg-amber-400 animate-pulse' };

  const frameStats =
    viewMode === 'stream' && health.evidence === 'frames' && health.frameStats ? health.frameStats : null;

  const showsMessage =
    isMixedContent || (snapshotView ? !previewUrl : !isStreamConfigured || !streamLoaded);
  const boxSize = hero ? 'max-h-[calc(100vh-15rem)]' : 'max-h-[26rem] sm:max-h-[30rem]';

  return (
    <div
      id="camera-feed-container"
      ref={containerRef}
      className={`relative w-full bg-black overflow-hidden flex items-center justify-center select-none ${
        isFullscreen
          ? 'h-full rounded-none border-0'
          : showsMessage
            ? `min-h-64 pt-14 ${snapshotView ? 'pb-16' : 'pb-5'} sm:aspect-video sm:min-h-[20rem] ${hero ? 'sm:max-h-[calc(100vh-15rem)]' : ''} rounded-xl border border-edge`
            : `aspect-video min-h-48 ${boxSize} rounded-xl border border-edge shadow-[0_0_44px_-18px_rgba(30,140,255,0.7)]`
      }`}
    >
      {/* ====================================================================
          VIEW STATE 1: Stream Not Configured
         ==================================================================== */}
      {!snapshotView && viewMode === 'stream' && !isStreamConfigured && !isMixedContent && (
        <FeedMessage
          icon={<SlidersHorizontal className="w-5 h-5" aria-hidden="true" />}
          title="Live Stream Endpoint Not Configured"
          actions={
            <>
              <button type="button" onClick={onOpenSettings} className={BTN_PRIMARY}>
                <Settings className="w-4 h-4" aria-hidden="true" />
                <span>Configure Stream URL</span>
              </button>
              {hero && (
                <button type="button" onClick={() => onToggleViewMode('snapshot')} className={BTN_SECONDARY}>
                  <Camera className="w-4 h-4" aria-hidden="true" />
                  <span>Switch to Snapshot Mode</span>
                </button>
              )}
            </>
          }
        >
          <p className="text-[13px] text-slate-400 leading-relaxed">
            The continuous video stream path is empty. Once your ESP32-CAM stream URL is confirmed (for example{' '}
            <Code>:81/stream</Code> or <Code>/stream</Code>), set it in Settings.
          </p>
        </FeedMessage>
      )}

      {/* ====================================================================
          The compact view cannot show Snapshot mode: say so and offer the way back
         ==================================================================== */}
      {!hero && viewMode === 'snapshot' && !isMixedContent && (
        <FeedMessage
          icon={<Camera className="w-5 h-5" aria-hidden="true" />}
          title="Snapshot mode is on"
          actions={
            <button type="button" onClick={() => onToggleViewMode('stream')} className={BTN_PRIMARY}>
              <Video className="w-4 h-4" aria-hidden="true" />
              <span>Switch to Live Stream</span>
            </button>
          }
        >
          <p className="text-[13px] text-slate-400 leading-relaxed">
            Motion detection and AI recognition read the live picture, so they need Live Stream mode.
          </p>
        </FeedMessage>
      )}

      {/* ====================================================================
          VIEW STATE 2: Mixed-Content Block Warning
         ==================================================================== */}
      {isMixedContent && (
        <FeedMessage
          tone="warn"
          icon={<AlertTriangle className="w-5 h-5" aria-hidden="true" />}
          title="Browser Mixed-Content Restriction"
          actions={
            <>
              <button type="button" onClick={onOpenNetworkGuide} className={BTN_PRIMARY}>
                <HelpCircle className="w-4 h-4" aria-hidden="true" />
                <span>Mixed-Content Guide</span>
              </button>
              <button type="button" onClick={onOpenSettings} className={BTN_SECONDARY}>
                <Settings className="w-4 h-4" aria-hidden="true" />
                <span>Settings</span>
              </button>
            </>
          }
        >
          <p className="text-[13px] text-amber-200/90 leading-relaxed">
            The browser blocks this secure HTTPS page from opening an unencrypted HTTP camera feed (
            <Code>{config.baseUrl || 'http://...'}</Code>). The camera is likely fine, but browser security prevents displaying it.
          </p>
        </FeedMessage>
      )}

      {/* ====================================================================
          VIEW STATE 3: Stream Error / Host Unreachable
         ==================================================================== */}
      {!snapshotView && viewMode === 'stream' && streamFailed && isStreamConfigured && !isMixedContent && (
        <FeedMessage
          tone="bad"
          icon={<WifiOff className="w-5 h-5" aria-hidden="true" />}
          title="Camera Stream Offline"
          actions={
            <>
              <button type="button" onClick={onReconnect} className={BTN_PRIMARY}>
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                <span>Reconnect</span>
              </button>
              <button type="button" onClick={onOpenSettings} className={BTN_SECONDARY}>
                <Settings className="w-4 h-4" aria-hidden="true" />
                <span>Camera Settings</span>
              </button>
            </>
          }
        >
          <p className="text-[13px] text-slate-300 leading-relaxed">
            {health.lastError || 'Could not establish connection to the ESP32-CAM video stream.'}
          </p>
          {reachabilityNote && <p className="text-xs text-slate-400 mt-1">{reachabilityNote}</p>}
        </FeedMessage>
      )}

      {/* ====================================================================
          STREAM ELEMENT (MJPEG over HTTP)
         ==================================================================== */}
      {viewMode === 'stream' && isStreamConfigured && (
        <>
          {/* Placeholder while the stream is connecting or recovering */}
          {!streamLoaded && !streamFailed && !isMixedContent && (
            <div className="relative z-10 flex flex-col items-center justify-center space-y-2 px-4 text-center" role="status">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" aria-hidden="true" />
              {status === 'reconnecting' ? (
                <>
                  <p className="text-[13px] text-amber-300 font-mono">
                    Reconnecting - attempt {Math.max(health.attempt, 1)} of {health.maxAttempts}
                    {retryInSec != null && retryInSec > 0 ? ` (next try in ${retryInSec}s)` : '...'}
                  </p>
                  {health.lastError && (
                    <p className="text-xs text-slate-400 font-mono max-w-md break-words">{health.lastError}</p>
                  )}
                  {reachabilityNote && <p className="text-xs text-slate-400 max-w-md">{reachabilityNote}</p>}
                </>
              ) : (
                <p className="text-[13px] text-slate-300 font-mono">
                  Connecting to stream: {config.streamPath || ':81/stream'}...
                </p>
              )}
            </div>
          )}

          {/* No `src` here on purpose: the connection manager owns it so it can close and reopen the connection. */}
          <img
            ref={setStreamImg}
            alt="ESP32-CAM Live Feed"
            className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${
              objectFit === 'cover' ? 'object-cover' : 'object-contain'
            } ${streamLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      )}

      {/* ====================================================================
          SNAPSHOT MODE VIEW
         ==================================================================== */}
      {snapshotView && (
        <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
          {previewUrl && preview ? (
            <>
              <img
                src={previewUrl}
                alt="ESP32-CAM Snapshot Frame"
                className={`w-full h-full ${objectFit === 'cover' ? 'object-cover' : 'object-contain'}`}
              />
              <div className="absolute bottom-3 right-3 z-20 bg-black/70 px-2 py-1 rounded text-xs font-mono tabular-nums text-slate-200">
                Frame from {new Date(preview.capturedAt).toLocaleTimeString(undefined, { hour12: false })}
              </div>
            </>
          ) : (
            <FeedMessage
              icon={<Camera className="w-5 h-5" aria-hidden="true" />}
              title="Snapshot Capture Mode"
              actions={
                <button
                  type="button"
                  onClick={() => void handleSnapshotCapture()}
                  disabled={snapshotLoading}
                  className={BTN_PRIMARY}
                >
                  <Camera className="w-4 h-4" aria-hidden="true" />
                  <span>{snapshotLoading ? 'Capturing Frame...' : 'Capture Frame Now'}</span>
                </button>
              }
            >
              <p className="text-[13px] text-slate-400 leading-relaxed">
                Snapshot mode takes single still frames from the stream without keeping a continuous video connection open.
              </p>
            </FeedMessage>
          )}

          {/* Snapshot mode top controls: capture once, interval and refresh */}
          <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSnapshotCapture()}
              disabled={snapshotLoading}
              className="bg-black/65 hover:bg-black/85 text-xs text-white px-2.5 py-1.5 rounded-md border border-white/20 flex items-center gap-1.5 backdrop-blur-sm transition-colors disabled:opacity-50"
            >
              <Camera className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
              <span>{snapshotLoading ? 'Capturing...' : 'Capture'}</span>
            </button>
            <div className="bg-black/65 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-mono text-slate-200 border border-white/10 flex items-center gap-1.5">
              <span>Auto:</span>
              <select
                value={snapshotIntervalSec}
                onChange={(e) => setSnapshotIntervalSec(Number(e.target.value))}
                className="bg-transparent text-cyan-300 font-semibold focus:outline-none cursor-pointer"
                aria-label="Automatic snapshot interval"
              >
                <option value={0} className="bg-slate-900 text-white">Manual</option>
                <option value={5} className="bg-slate-900 text-white">Every 5s</option>
                <option value={10} className="bg-slate-900 text-white">Every 10s</option>
                <option value={30} className="bg-slate-900 text-white">Every 30s</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => void handleSnapshotCapture()}
              disabled={snapshotLoading}
              className="bg-black/65 hover:bg-black/85 text-slate-200 p-1.5 rounded-md border border-white/20 backdrop-blur-sm transition-colors"
              title="Refresh frame"
              aria-label="Refresh frame"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${snapshotLoading ? 'animate-spin text-cyan-400' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Smart Snapshot notification */}
      <SnapshotNoticeBanner
        notice={smart.notice}
        onDismiss={smart.dismissNotice}
        onAction={(action) => {
          if (action === 'enable-capture') onEnableCapture();
        }}
        className="absolute top-14 left-1/2 -translate-x-1/2 z-30 w-[min(92%,34rem)]"
      />

      {/* Optional aiming reticle (off by default) */}
      {showReticle && (
        <div className="absolute inset-0 pointer-events-none z-10" aria-hidden="true">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 border border-cyan-400/30 rounded-full flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-cyan-300/70 rounded-full" />
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-cyan-400/25" />
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-cyan-400/25" />
          </div>
        </div>
      )}

      {/* OSD: stream status dot, camera label and FPS */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="bg-black/65 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-mono text-slate-100 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${osd.dot}`} aria-hidden="true" />
          <span>ESP32-CAM</span>
          <span className="text-slate-300">{osd.label}</span>
        </div>
        {frameStats && (
          <div className="bg-black/65 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-mono tabular-nums text-slate-300">
            {frameStats.fps5s} fps, longest gap {formatDuration(frameStats.longestGapMs5min)}
          </div>
        )}
      </div>

      {/* Fullscreen (top right of the picture) */}
      <button
        type="button"
        onClick={handleToggleFullscreen}
        className="absolute top-3 right-3 z-30 w-9 h-9 inline-flex items-center justify-center rounded-lg bg-black/60 hover:bg-black/80 text-slate-100 border border-white/20 transition-colors"
        title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
      >
        {isFullscreen ? (
          <Minimize2 className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Maximize2 className="w-4 h-4" aria-hidden="true" />
        )}
      </button>

      {/* Picture options (bottom right): aiming reticle and fit */}
      {!isFullscreen && !snapshotView && (
        <div className="absolute bottom-3 right-3 z-20 flex gap-1.5">
          <button
            type="button"
            onClick={() => setShowReticle((prev) => !prev)}
            aria-pressed={showReticle}
            className={`${BTN_ICON} !w-8 !h-8 backdrop-blur-sm ${
              showReticle ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60' : 'bg-black/60 text-slate-200 border-white/20 hover:bg-black/80'
            }`}
            title={showReticle ? 'Hide surveillance reticle' : 'Show surveillance reticle'}
            aria-label="Crosshair reticle"
          >
            <Crosshair className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setObjectFit((prev) => (prev === 'contain' ? 'cover' : 'contain'))}
            aria-pressed={objectFit === 'cover'}
            className={`${BTN_ICON} !w-8 !h-8 backdrop-blur-sm ${
              objectFit === 'cover' ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60' : 'bg-black/60 text-slate-200 border-white/20 hover:bg-black/80'
            }`}
            title={objectFit === 'cover' ? 'Fit feed inside canvas (Contain)' : 'Fill feed viewport (Cover)'}
            aria-label="Fill the viewport (crops the picture)"
          >
            <Scan className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};

export const CameraView: React.FC<CameraViewProps> = (props) => {
  const {
    variant = 'hero',
    sidePanel,
    onAiAnalyze,
    smart,
    viewMode,
    onToggleViewMode,
    isStreamConfigured,
    health,
    streamUrl,
    config,
    feedSlot,
    getImage,
  } = props;
  const hero = variant === 'hero';
  const status = health.status;
  const streamLoaded = status === 'connected';
  const streamFailed = status === 'error';
  const snapshotView = viewMode === 'snapshot';

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handleFullscreenChange = () => {
      const container = document.getElementById('camera-feed-container');
      setIsFullscreen(document.fullscreenElement === container);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = () => {
    const el = document.getElementById('camera-feed-container');
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.().catch(() => {});
    } else {
      void document.exitFullscreen?.().catch(() => {});
    }
  };

  const handleCaptureStill = async () => {
    if (viewMode === 'stream') {
      const img = getImage ? getImage() : (document.querySelector('#camera-feed-container img') as HTMLImageElement | null);
      await smart.captureStill({
        kind: 'live',
        image: img,
        connected: health.status === 'connected',
        statusLabel: health.status.replace('_', ' '),
        sourceUrl: streamUrl,
        corsRequested: Boolean(config.captureCors),
      });
      return;
    }
    await smart.captureStill({
      kind: 'stream',
      url: streamUrl,
    });
  };

  const liveBadge: { label: string; tone: BadgeTone } = snapshotView
    ? { label: 'SNAPSHOT MODE', tone: 'accent' }
    : !isStreamConfigured
      ? { label: 'NOT CONFIGURED', tone: 'neutral' }
      : streamLoaded
        ? { label: 'LIVE', tone: 'good' }
        : streamFailed
          ? { label: 'OFFLINE', tone: 'bad' }
          : status === 'reconnecting'
            ? { label: 'RECONNECTING', tone: 'warn' }
            : { label: 'CONNECTING', tone: 'accent' };

  const content = feedSlot || (
    props.attachImage ? (
      <CameraFeedBox {...(props as CameraFeedBoxProps)} />
    ) : null
  );

  if (!hero) return <>{content}</>;

  return (
    <section aria-labelledby="live-feed-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="w-10 h-10 rounded-xl bg-raised border border-edge flex items-center justify-center text-cyan-300"
          aria-hidden="true"
        >
          <Bot className="w-6 h-6" />
        </span>
        <h2 id="live-feed-title" className="text-xl sm:text-2xl font-bold tracking-tight text-white">
          Live Camera Feed
        </h2>
        <StatusBadge tone={liveBadge.tone} className="font-bold tracking-wide" role="status" aria-live="polite">
          {liveBadge.label}
        </StatusBadge>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] items-start">
        {content}

        <div className="space-y-4 min-w-0">
          <div role="group" aria-label="Camera actions" className="grid grid-cols-2 xl:grid-cols-1 gap-3">
            <ActionButton
              tone="primary"
              icon={Camera}
              busy={smart.capturing}
              onClick={() => void handleCaptureStill()}
              disabled={smart.capturing}
              title="Capture a still from the video and save it to the gallery"
            >
              {smart.capturing ? 'Capturing...' : 'Capture Still'}
            </ActionButton>
            <ActionButton
              tone="outline"
              icon={ScanSearch}
              onClick={onAiAnalyze}
              disabled={!onAiAnalyze}
              title="Open AI Detection and analyze the current frame (only if external AI processing is switched on there)"
            >
              AI Analyze
            </ActionButton>
            <ActionButton
              icon={viewMode === 'stream' ? ImageIcon : Video}
              onClick={() => onToggleViewMode(viewMode === 'stream' ? 'snapshot' : 'stream')}
              title={
                viewMode === 'stream'
                  ? 'Switch to discrete single-frame snapshot capture'
                  : 'Switch to continuous live video stream'
              }
            >
              {viewMode === 'stream' ? 'Snapshot Mode' : 'Live Stream'}
            </ActionButton>
            <ActionButton
              icon={isFullscreen ? Minimize2 : Maximize2}
              onClick={handleToggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              Fullscreen
            </ActionButton>
          </div>
          {sidePanel}
        </div>
      </div>
    </section>
  );
};

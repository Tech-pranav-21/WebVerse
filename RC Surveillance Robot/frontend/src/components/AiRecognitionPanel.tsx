/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Cpu,
  HelpCircle,
  Key,
  Loader2,
  RefreshCw,
  ScanSearch,
  Server,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { CameraConfig, StreamHealth, SurveillanceViewMode } from '../types/camera';
import type { AiEvent, AiProviderId } from '../types/ai';
import { useAiRecognition } from '../hooks/useAiRecognition';
import { useNow } from '../hooks/useNow';
import type { SmartSnapshotApi } from '../hooks/useSmartSnapshot';
import type { MotionEventBus } from '../services/motionEventBus';
import { createAiClient } from '../services/aiClient';
import {
  CATEGORY_LABELS,
  PROVIDER_METADATA,
} from '../services/aiSettings';
import { describeSnapshotLink } from '../services/snapshotLinkText';
import { formatEventTime } from '../services/streamStatusText';
import { SnapshotImage } from './SnapshotImage';
import { AiSettingsFields } from './settingsFields';
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BadgeTone,
  Disclosure,
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
  onEnableCapture: () => void;
  analyzePending?: boolean;
  onAnalyzeHandled?: () => void;
  onViewAll?: () => void;
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

  // Multi-Provider state
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>(settings.provider || 'groq');
  const [selectedModel, setSelectedModel] = useState<string>(settings.model || PROVIDER_METADATA[settings.provider || 'groq'].defaultModel);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status: string;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSuccessMsg, setConfigSuccessMsg] = useState<string | null>(null);

  const client = React.useMemo(() => createAiClient(), []);

  // Sync selected provider when settings change
  useEffect(() => {
    if (settings.provider && settings.provider !== selectedProvider) {
      setSelectedProvider(settings.provider);
      setSelectedModel(settings.model || PROVIDER_METADATA[settings.provider].defaultModel);
    }
  }, [settings.provider, settings.model]);

  // Keep selected model updated when switching providers
  const handleSelectProvider = (prov: AiProviderId) => {
    setSelectedProvider(prov);
    const defModel = backend.kind === 'ready' && backend.status.providers?.[prov]?.model
      ? backend.status.providers[prov].model
      : PROVIDER_METADATA[prov].defaultModel;
    setSelectedModel(defModel);
    setTestResult(null);
    setConfigSuccessMsg(null);
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    setConfigSuccessMsg(null);
    try {
      const res = await client.testConnection(selectedProvider, selectedModel);
      setTestResult({
        ok: res.ok,
        status: res.status,
        message: res.message,
        latencyMs: res.latencyMs,
      });
    } catch (err: any) {
      setTestResult({
        ok: false,
        status: 'failed',
        message: err.message || 'Connection test failed to complete.',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveActiveConfig = async () => {
    setIsSavingConfig(true);
    setConfigSuccessMsg(null);
    try {
      await client.updateConfig(selectedProvider, selectedModel);
      ai.configure({ provider: selectedProvider, model: selectedModel });
      await ai.refreshBackend();
      setConfigSuccessMsg(`Active AI provider set to ${PROVIDER_METADATA[selectedProvider].name} (${selectedModel}).`);
    } catch (err: any) {
      setTestResult({
        ok: false,
        status: 'failed',
        message: `Failed to update configuration: ${err.message}`,
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const blockedMs = state.blockedUntil !== null ? state.blockedUntil - now : 0;
  const waiting = blockedMs > 0;
  const backendStatus = backend.kind === 'ready' || backend.kind === 'not-configured' ? backend.status : undefined;

  const activeProvider = backendStatus?.activeProvider || settings.provider || 'groq';
  const activeProviderConf = backendStatus?.providers?.[activeProvider];
  const isCurrentProviderConfigured = Boolean(activeProviderConf?.configured);

  const canAnalyze =
    settings.enabled &&
    !state.analyzing &&
    !waiting &&
    viewMode === 'stream' &&
    isStreamConfigured &&
    isCurrentProviderConfigured;

  // "AI Analyze" trigger from Dashboard
  const [skippedNote, setSkippedNote] = useState<string | null>(null);
  const aiRef = useRef(ai);
  aiRef.current = ai;
  const readyRef = useRef(false);
  readyRef.current = canAnalyze && health.status === 'connected';

  useEffect(() => {
    if (!analyzePending) return;
    if (!settings.enabled) {
      setSkippedNote('AI Analyze did not run: external AI processing is off. Enable it below to analyze frames.');
      onAnalyzeHandled?.();
      return;
    }
    if (readyRef.current) {
      void aiRef.current.analyze();
      onAnalyzeHandled?.();
      return;
    }
    const timer = setTimeout(() => {
      setSkippedNote('AI Analyze timed out waiting for the camera stream or backend.');
      onAnalyzeHandled?.();
    }, PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [analyzePending, settings.enabled, onAnalyzeHandled]);

  // Overall Status Badge calculation
  const badge: { label: string; tone: BadgeTone; busy?: boolean } =
    !settings.enabled
      ? { label: 'AI Disabled', tone: 'neutral' }
      : backend.kind === 'checking'
        ? { label: 'Checking AI...', tone: 'neutral', busy: true }
        : backend.kind === 'unreachable'
          ? { label: 'Backend Offline', tone: 'bad' }
          : !isCurrentProviderConfigured
            ? { label: `${PROVIDER_METADATA[activeProvider].name} Key Missing`, tone: 'warn' }
            : waiting
              ? { label: `Rate Limit (${waitText(blockedMs)})`, tone: 'warn' }
              : state.analyzing
                ? { label: 'Analyzing Frame...', tone: 'good', busy: true }
                : { label: `${PROVIDER_METADATA[activeProvider].name} Ready`, tone: 'good' };

  useEffect(() => {
    onStatusChange?.(badge);
  }, [badge.label, badge.tone, badge.busy, onStatusChange]);

  const current = state.current;
  const currentThumb =
    current && current.snapshot.status === 'saved' && current.snapshot.snapshotId
      ? galleryById.get(current.snapshot.snapshotId)
      : undefined;

  const handleCaptureSnapshot = useCallback(async () => {
    await smart.captureStill({ kind: 'stream', url: streamUrl });
  }, [smart, streamUrl]);

  const camStatus =
    health.status === 'connected'
      ? { label: 'Camera Live', tone: 'good' as BadgeTone }
      : !isStreamConfigured
        ? { label: 'Camera Unconfigured', tone: 'neutral' as BadgeTone }
        : { label: 'Camera Disconnected', tone: 'neutral' as BadgeTone };

  return (
    <Panel
      id="ai"
      title="Multi-AI Vision Recognition"
      icon={ScanSearch}
      description="Visual scene analysis powered by configurable cloud AI providers (Groq, Google Gemini, OpenAI). Analyzes frames on demand or automatically upon motion detection."
      status={
        <StatusBadge role="status" aria-live="polite" tone={badge.tone} busy={badge.busy}>
          {badge.label}
        </StatusBadge>
      }
    >
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* LEFT COLUMN: Camera Source Preview */}
        <div className="lg:col-span-7 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              Live Source Preview
            </span>
            <StatusBadge tone={camStatus.tone} dot={true}>
              {camStatus.label}
            </StatusBadge>
          </div>

          <div className="w-full rounded-xl overflow-hidden border border-line bg-black shadow-[0_0_30px_-12px_rgba(30,140,255,0.3)]">
            {feedSlot}
          </div>

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
                Mode: {config.captureCors ? 'CORS Enabled' : 'Standard MJPEG'}
              </span>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: AI Provider Selector & Recognition Result */}
        <div className="lg:col-span-5 space-y-4 min-w-0">
          {/* PROVIDER SELECTION & CONFIGURATION CARD */}
          <div className="rounded-xl border border-line bg-sunken p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  AI Provider Configuration
                </h3>
              </div>
              <StatusBadge tone={isCurrentProviderConfigured ? 'good' : 'warn'}>
                {PROVIDER_METADATA[activeProvider].name}: {isCurrentProviderConfigured ? 'Configured' : 'No Key'}
              </StatusBadge>
            </div>

            {/* Provider Selector Tabs */}
            <div className="flex rounded-lg bg-raised p-1 border border-line gap-1">
              {(['groq', 'gemini', 'openai'] as AiProviderId[]).map((provId) => {
                const isSelected = selectedProvider === provId;
                const isActive = activeProvider === provId;
                const isConfigured = Boolean(backendStatus?.providers?.[provId]?.configured);
                return (
                  <button
                    key={provId}
                    type="button"
                    onClick={() => handleSelectProvider(provId)}
                    className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-all text-center flex flex-col items-center justify-center gap-0.5 ${
                      isSelected
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      {PROVIDER_METADATA[provId].name}
                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" title="Active provider" />}
                    </span>
                    <span className="text-[10px] opacity-75">
                      {isConfigured ? 'Key Set' : 'Missing'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Model Selection Row */}
            <div className="space-y-1.5">
              <label htmlFor="ai-model-select" className="text-xs font-medium text-slate-300 flex items-center justify-between">
                <span>Vision Model:</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {PROVIDER_METADATA[selectedProvider].name}
                </span>
              </label>
              <select
                id="ai-model-select"
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  setTestResult(null);
                }}
                className="w-full bg-raised border border-line rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              >
                {PROVIDER_METADATA[selectedProvider].availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m} {m === PROVIDER_METADATA[selectedProvider].defaultModel ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Test & Set Active Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={testingConnection}
                className={`${BTN_SECONDARY} flex-1 !h-8 !text-xs`}
                title="Test API credentials and model reachability"
              >
                {testingConnection ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                )}
                <span>{testingConnection ? 'Testing...' : 'Test Connection'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSaveActiveConfig()}
                disabled={isSavingConfig || (activeProvider === selectedProvider && activeProviderConf?.model === selectedModel)}
                className={`${BTN_PRIMARY} flex-1 !h-8 !text-xs`}
                title="Set selected provider as active"
              >
                {isSavingConfig ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>{activeProvider === selectedProvider ? 'Active' : 'Set Active'}</span>
              </button>
            </div>

            {/* Test feedback */}
            {testResult && (
              <div
                className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
                  testResult.ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : testResult.status === 'not_configured'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}
              >
                <div className="flex items-center justify-between font-semibold pb-0.5">
                  <span>Status: {testResult.status.toUpperCase()}</span>
                  {testResult.latencyMs != null && <span>{testResult.latencyMs} ms</span>}
                </div>
                <p>{testResult.message}</p>
              </div>
            )}

            {configSuccessMsg && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 p-2 rounded-lg">
                {configSuccessMsg}
              </p>
            )}

            {/* Credential security hint */}
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 border-t border-line/60 pt-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Keys stored server-side only in <code>.env</code>. Never exposed to browser.</span>
            </div>
          </div>

          {/* MAIN ACTION: ANALYZE FRAME */}
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
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              )}
              <span>
                {state.analyzing
                  ? `Analyzing with ${PROVIDER_METADATA[activeProvider].name}...`
                  : `Analyze Frame (${PROVIDER_METADATA[activeProvider].name})`}
              </span>
            </button>

            {!settings.enabled && (
              <p className="text-xs text-amber-300/90 text-center">
                AI processing is off. Enable it in Settings below to analyze frames.
              </p>
            )}
            {settings.enabled && !isCurrentProviderConfigured && (
              <p className="text-xs text-amber-300 text-center">
                {PROVIDER_METADATA[activeProvider].name} API key not set in server <code>.env</code>.
              </p>
            )}
            {settings.enabled && waiting && (
              <p className="text-xs text-amber-300 text-center">
                Rate limit active: {waitText(blockedMs)} remaining.
              </p>
            )}
            {skippedNote && !settings.enabled && (
              <Notice tone="info" role="status">
                <p className="text-xs">{skippedNote}</p>
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

          {/* LATEST RECOGNITION RESULT CARD */}
          <div
            className="rounded-xl border border-line bg-sunken p-4 space-y-3 min-w-0"
            aria-label="Current recognition result"
            aria-busy={state.analyzing}
          >
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>Recognition Result</span>
                {current?.provider && (
                  <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/30">
                    {PROVIDER_METADATA[current.provider]?.name || current.provider}
                  </span>
                )}
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
                  Requesting vision analysis from {PROVIDER_METADATA[activeProvider].name}...
                </p>
              </div>
            ) : !current ? (
              <div className="py-6 text-center text-xs text-slate-400 space-y-1">
                <p className="font-medium text-slate-300">No frame analyzed yet</p>
                <p>Click "Analyze Frame" above to run scene identification.</p>
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
                      <span>Model: {current.model || 'Unknown'}</span>
                      {current.latencyMs != null && <span>{(current.latencyMs / 1000).toFixed(1)}s latency</span>}
                      {current.usage && <span>{current.usage.promptTokens + current.usage.completionTokens} tokens</span>}
                    </div>
                  </div>
                </div>

                {/* Detected Objects with Categories and Certainty */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>Detected Objects ({current.objects.length})</span>
                    <span className="text-[10px] text-slate-500 font-normal">
                      Confidence: {current.objects.every((o) => !o.uncertain) ? 'High (Confirmed)' : 'Flagged by model'}
                    </span>
                  </div>
                  {current.objects.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No specific objects identified in frame</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {current.objects.map((o, i) => (
                        <li key={`${o.label}-${i}`} className={`${CHIP} border-cyan-500/40 bg-cyan-500/10 text-cyan-200`}>
                          <span className="font-semibold">{o.label}</span>
                          <span className="text-slate-400 ml-1">({singular(o.category)})</span>
                          {o.uncertain ? (
                            <span className="ml-1 text-amber-300 text-[10px]" title="Model flagged as uncertain">
                              [?]
                            </span>
                          ) : (
                            <span className="ml-1 text-emerald-400 text-[10px]" title="Confirmed detection">
                              ✓
                            </span>
                          )}
                          {typeof o.confidence === 'number' && (
                            <span className="ml-1 text-[10px] text-cyan-300 font-mono">
                              ({Math.round(o.confidence * 100)}%)
                            </span>
                          )}
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

      {/* ADVANCED AI SETTINGS & AUTOMATION (COLLAPSIBLE) */}
      <Disclosure summary="Automation & Filter Settings" defaultOpen={false}>
        <div className="space-y-4 pt-2">
          {/* Master Enablement Switch */}
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
                  Enable External AI Vision Processing
                </span>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Off by default. When enabled, captured JPEG frames are sent through your local backend to the active AI provider.
                  Switching this off ensures no camera data is transmitted upstream.
                </p>
              </div>
            </label>
          </div>

          <AiSettingsFields settings={settings} onChange={ai.configure} idPrefix="ai-panel" />

          {settings.autoOnMotion && state.autoCooldownUntil !== null && state.autoCooldownUntil > now && (
            <p className="text-xs font-mono text-slate-300">
              Next automatic analysis available in {waitText(state.autoCooldownUntil - now)}.
            </p>
          )}

          {/* Usage & History Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3 text-xs text-slate-400">
            <span>
              Session analyses: <strong className="text-slate-200">{state.requestsThisSession}</strong>
              {backendStatus && (
                <span className="ml-2 font-mono">
                  (Daily limit: {backendStatus.limits.perDay}, remaining: {backendStatus.limits.remainingToday})
                </span>
              )}
            </span>
            {onViewAll && (
              <button type="button" onClick={onViewAll} className={`${BTN_GHOST} !h-7 !text-xs`}>
                View Event History →
              </button>
            )}
          </div>
        </div>
      </Disclosure>
    </Panel>
  );
};

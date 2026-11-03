/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Check,
  AlertTriangle,
  Activity,
  Loader2,
  Server,
} from 'lucide-react';
import { CameraConfig, ConnectionProbeResult } from '../types/camera';
import {
  ESP32_PRESETS,
  resolveCameraUrl,
  validateCameraUrl,
} from '../config/cameraConfig';
import { probeCameraConnection } from '../services/connectionService';
import { DEFAULT_STREAM_POLICY } from '../services/streamConnectionService';
import { BTN_PRIMARY, BTN_SECONDARY, CHECK, Code, Disclosure, FIELD, Hint, Notice } from './ui';

interface CameraSettingsFormProps {
  currentConfig: CameraConfig;
  onSave: (newConfig: CameraConfig) => void;
}

const MIN_RETRY_DELAY_SEC = 1;
const MAX_RETRY_DELAY_SEC = 60;
/** How long the "saved" message stays. */
const SAVED_NOTICE_MS = 6000;

/** Parses the retry-delay field; falls back to the saved value and keeps it within 1 to 60 s. */
function clampRetryDelay(raw: string, fallback: number): number {
  const n = Number(raw);
  const base = Number.isFinite(n) && raw.trim() !== '' ? n : fallback;
  return Math.min(MAX_RETRY_DELAY_SEC, Math.max(MIN_RETRY_DELAY_SEC, Math.round(base)));
}

/** One group of settings: a heading, a line saying what it is for, then its controls. */
const Section: React.FC<{ id: string; title: string; hint?: string; children: React.ReactNode }> = ({
  id,
  title,
  hint,
  children,
}) => (
  <section aria-labelledby={id} className="space-y-3 pt-5 first:pt-0 border-t border-line first:border-0">
    <div>
      <h3 id={id} className="text-[15px] font-semibold text-white">
        {title}
      </h3>
      {hint && <p className="mt-0.5 text-[13px] text-slate-400">{hint}</p>}
    </div>
    {children}
  </section>
);

/**
 * The camera configuration (address, routes, stream recovery, snapshot capture) with the connection
 * test. It edits a draft; nothing changes until "Save Configuration" is pressed.
 */
export const CameraSettingsForm: React.FC<CameraSettingsFormProps> = ({ currentConfig, onSave }) => {
  const [baseUrl, setBaseUrl] = useState(currentConfig.baseUrl);
  const [streamPath, setStreamPath] = useState(currentConfig.streamPath);
  const [snapshotPath, setSnapshotPath] = useState(currentConfig.snapshotPath);
  const [autoReconnect, setAutoReconnect] = useState(currentConfig.autoReconnect);
  const [reconnectIntervalSec, setReconnectIntervalSec] = useState(String(currentConfig.reconnectIntervalSec));
  const [frameMonitor, setFrameMonitor] = useState(Boolean(currentConfig.frameMonitor));
  const [captureCors, setCaptureCors] = useState(Boolean(currentConfig.captureCors));

  // Testing connection state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionProbeResult | null>(null);

  // URL Validation state
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isMixedContentWarn, setIsMixedContentWarn] = useState(false);

  const [savedNotice, setSavedNotice] = useState(false);

  // Start from the saved configuration whenever it changes (for example after a reset to defaults).
  useEffect(() => {
    setBaseUrl(currentConfig.baseUrl);
    setStreamPath(currentConfig.streamPath);
    setSnapshotPath(currentConfig.snapshotPath);
    setAutoReconnect(currentConfig.autoReconnect);
    setReconnectIntervalSec(String(currentConfig.reconnectIntervalSec));
    setFrameMonitor(Boolean(currentConfig.frameMonitor));
    setCaptureCors(Boolean(currentConfig.captureCors));
    setTestResult(null);
    setValidationError(null);
  }, [currentConfig]);

  // "Test Connection" results are only shown for the run that is still current: leaving the page
  // (or starting another test) cancels the in-flight probe and discards its result.
  const testRunRef = useRef(0);
  const testAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      testRunRef.current++;
      testAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(false), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  // Real-time URL validation
  useEffect(() => {
    if (!baseUrl.trim()) {
      setValidationError('Base URL cannot be empty.');
      setIsMixedContentWarn(false);
      return;
    }

    const val = validateCameraUrl(baseUrl);
    if (!val.isValid) {
      setValidationError(val.error || 'Invalid URL format.');
    } else {
      setValidationError(null);
    }
    setIsMixedContentWarn(val.isMixedContent);
  }, [baseUrl]);

  const parsedIntervalSec = clampRetryDelay(reconnectIntervalSec, currentConfig.reconnectIntervalSec);
  const resolvedStream = resolveCameraUrl(baseUrl, streamPath);
  const resolvedSnapshot = resolveCameraUrl(baseUrl, snapshotPath);

  const handleTestConnection = async () => {
    if (!baseUrl.trim() || validationError) return;

    testAbortRef.current?.abort();
    const controller = new AbortController();
    testAbortRef.current = controller;
    const run = ++testRunRef.current;

    setIsTesting(true);
    setTestResult(null);

    // If stream or snapshot is specified, probe accordingly; otherwise probe host reachability
    const targetToTest = resolvedSnapshot || resolvedStream || baseUrl;
    const isImageEndpoint = Boolean(resolvedSnapshot || resolvedStream);
    const result = await probeCameraConnection(
      targetToTest,
      4500,
      isImageEndpoint ? 'image' : 'host',
      controller.signal
    );

    if (run !== testRunRef.current) return; // left the page, or superseded by a newer test
    setTestResult(result);
    setIsTesting(false);
  };

  const handleApplyPreset = (presetStream: string, presetSnapshot: string) => {
    setStreamPath(presetStream);
    setSnapshotPath(presetSnapshot);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) return;

    onSave({
      ...currentConfig,
      baseUrl: baseUrl.trim(),
      streamPath: streamPath.trim(),
      snapshotPath: snapshotPath.trim(),
      autoReconnect,
      reconnectIntervalSec: parsedIntervalSec,
      frameMonitor,
      captureCors,
    });
    setSavedNotice(true);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Camera address */}
      <Section id="settings-address" title="Camera address">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <label htmlFor="settings-base-url" className="text-[13px] font-medium text-slate-100">
              ESP32-CAM base URL / IP address
            </label>
          </div>
          <input
            id="settings-base-url"
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://192.168.1.100"
            aria-invalid={Boolean(validationError)}
            aria-describedby={validationError ? 'settings-base-url-error' : undefined}
            className={`${FIELD} w-full font-mono`}
          />
          {validationError && (
            <p id="settings-base-url-error" className="text-[13px] text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{validationError}</span>
            </p>
          )}
          {isMixedContentWarn && (
            <Notice tone="warn" className="mt-2">
              <p>
                <strong>Mixed-content alert:</strong> This dashboard is served via HTTPS, but the camera URL uses HTTP.
                Browser security policies prohibit loading unencrypted HTTP requests from HTTPS sites. Run Vite locally
                on HTTP (http://localhost:3000) for seamless local IP access.
              </p>
            </Notice>
          )}
        </div>
      </Section>

      {/* Endpoints */}
      <Section id="settings-endpoints" title="Stream and snapshot routes" hint="Click a preset to fill in the common ESP32-CAM endpoints.">
        <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2">
          {ESP32_PRESETS.map((preset) => {
            const isSelected =
              streamPath === preset.streamPath &&
              snapshotPath === preset.snapshotPath;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset.streamPath, preset.snapshotPath)}
                aria-pressed={isSelected}
                className={`text-left p-3 rounded-lg border text-[13px] transition-colors ${
                  isSelected
                    ? 'bg-cyan-500/10 border-cyan-400/50'
                    : 'bg-sunken border-line hover:border-edge'
                }`}
              >
                <div className="font-medium text-white flex items-center justify-between gap-2">
                  <span>{preset.label}</span>
                  {isSelected && <Check className="w-4 h-4 text-cyan-400" aria-hidden="true" />}
                </div>
                <div className="text-xs text-slate-400 font-mono mt-1 break-all">
                  Stream: {preset.streamPath || '(Unset)'}, Still: {preset.snapshotPath}
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 @xl:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="settings-stream-path" className="text-[13px] font-medium text-slate-100">
              Stream path / port
            </label>
            <input
              id="settings-stream-path"
              type="text"
              value={streamPath}
              onChange={(e) => setStreamPath(e.target.value)}
              placeholder=":81/stream or /stream"
              className={`${FIELD} w-full font-mono`}
            />
            <Hint>Leave blank if the streaming path has not yet been confirmed on the robot.</Hint>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="settings-snapshot-path" className="text-[13px] font-medium text-slate-100">
              Snapshot path
            </label>
            <input
              id="settings-snapshot-path"
              type="text"
              value={snapshotPath}
              onChange={(e) => setSnapshotPath(e.target.value)}
              placeholder="/capture"
              className={`${FIELD} w-full font-mono`}
            />
            <Hint>
              Default for OV2640 sketches: /capture. Not used by Capture Still or Snapshot mode, which read frames from
              the stream because many ESP32-CAM firmwares have no /capture endpoint.
            </Hint>
          </div>
        </div>

        {/* Resolved Target URL Preview */}
        <dl className="p-3 rounded-lg bg-sunken border border-line space-y-1.5 text-xs">
          <div className="grid grid-cols-[4.5rem_1fr] gap-2">
            <dt className="text-slate-400">Stream</dt>
            <dd className="font-mono text-cyan-300 break-all">
              {resolvedStream || '(Unconfigured, awaiting confirmation)'}
            </dd>
          </div>
          <div className="grid grid-cols-[4.5rem_1fr] gap-2">
            <dt className="text-slate-400">Snapshot</dt>
            <dd className="font-mono text-slate-200 break-all">{resolvedSnapshot}</dd>
          </div>
        </dl>
      </Section>

      {/* Stream recovery */}
      <Section
        id="settings-recovery"
        title="Stream recovery"
        hint="What the dashboard does when the live video stops or fails to start."
      >
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoReconnect}
            onChange={(e) => setAutoReconnect(e.target.checked)}
            className={`${CHECK} mt-0.5`}
          />
          <span className="text-[13px] text-slate-100">
            Reconnect automatically
            <span className="block text-xs text-slate-400 font-normal mt-0.5">
              Up to {DEFAULT_STREAM_POLICY.maxRetries} retries with growing delays (capped at {DEFAULT_STREAM_POLICY.maxDelayMs / 1000} s), then it stops and waits for the Reconnect button.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="retry-delay" className="text-[13px] text-slate-100">
            Base retry delay (seconds)
          </label>
          <input
            id="retry-delay"
            type="number"
            min={MIN_RETRY_DELAY_SEC}
            max={MAX_RETRY_DELAY_SEC}
            step={1}
            value={reconnectIntervalSec}
            onChange={(e) => setReconnectIntervalSec(e.target.value)}
            disabled={!autoReconnect}
            className={`${FIELD} w-20 font-mono`}
          />
          <span className="text-xs text-slate-400">
            The first retry after a working stream drops is quicker (at most 1 s); later retries double this delay.
          </span>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={frameMonitor}
            onChange={(e) => setFrameMonitor(e.target.checked)}
            className={`${CHECK} mt-0.5`}
          />
          <span className="text-[13px] text-slate-100">
            Frame monitor{' '}
            <span className="ml-1 text-xs text-amber-300 border border-amber-500/30 rounded px-1.5 py-0.5">
              Experimental
            </span>
            <span className="block text-xs text-slate-400 font-normal mt-0.5">
              Reads the video stream directly so the dashboard can see every frame, detect a frozen stream and reconnect,
              and report frame rate and the longest freeze.
            </span>
          </span>
        </label>
        <Disclosure summary="Frame monitor requirements">
          <p className="text-xs text-slate-400 leading-relaxed">
            Requires the camera to send an <Code>Access-Control-Allow-Origin</Code> header; if it does not, the stream will
            show an error and you should turn this off. With it off, the browser can only tell that the first frame of each
            connection arrived.
          </p>
        </Disclosure>
      </Section>

      {/* Smart Snapshot */}
      <Section id="settings-capture" title="Snapshot capture" hint={'How "Capture Still" gets a picture out of the live video.'}>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={captureCors}
            onChange={(e) => setCaptureCors(e.target.checked)}
            className={`${CHECK} mt-0.5`}
          />
          <span className="text-[13px] text-slate-100">
            Allow snapshot capture from the live stream
            <span className="block text-xs text-slate-400 font-normal mt-0.5">
              Requests the video with CORS so the browser lets this page read a frame. Needed for Capture Still in Live
              Stream mode, motion detection and AI recognition.
            </span>
          </span>
        </label>
        <Disclosure summary="When this works, and when it breaks the picture">
          <p className="text-xs text-slate-400 leading-relaxed">
            It only works if the camera sends <Code>Access-Control-Allow-Origin</Code> on its stream; if it does not, the
            browser refuses to show the stream, so turn this off again. It does not apply to Frame monitor, which already
            allows capture, and Snapshot mode does not need it.
          </p>
        </Disclosure>
      </Section>

      {/* Live Test Connection Box */}
      <Section
        id="settings-test"
        title="Connection diagnostic test"
        hint="Tests host reachability and verifies snapshot image decoding."
      >
        <div>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting || Boolean(validationError)}
            className={BTN_SECONDARY}
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" aria-hidden="true" />
            ) : (
              <Activity className="w-4 h-4 text-cyan-400" aria-hidden="true" />
            )}
            <span>{isTesting ? 'Probing...' : 'Test Connection'}</span>
          </button>
        </div>

        {/* Test Result Message */}
        {testResult && (
          <Notice
            tone={testResult.success ? 'good' : testResult.hostReachable ? 'warn' : 'bad'}
            role="status"
          >
            <p className="flex items-center gap-1.5 font-semibold">
              {testResult.success ? (
                <>
                  <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    {testResult.frameVerified
                      ? `Image frame verified, latency ${testResult.latencyMs}ms`
                      : `Host responded, latency ${testResult.latencyMs}ms`}
                  </span>
                </>
              ) : testResult.hostReachable ? (
                <>
                  <Server className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Host reachable (endpoint unverified)</span>
                </>
              ) : (
                <span>Connection probe failed</span>
              )}
            </p>
            {testResult.details && (
              <p className="text-xs font-mono leading-relaxed text-slate-200">{testResult.details}</p>
            )}
            {testResult.errorMessage && (
              <p className="text-xs font-mono leading-relaxed text-rose-200">{testResult.errorMessage}</p>
            )}
          </Notice>
        )}
      </Section>

      {/* Save */}
      <div className="pt-5 border-t border-line flex flex-wrap items-center gap-3">
        <button type="submit" disabled={Boolean(validationError)} className={BTN_PRIMARY}>
          Save Configuration
        </button>
        {savedNotice && (
          <p role="status" className="text-[13px] text-emerald-300 flex items-center gap-1.5">
            <Check className="w-4 h-4" aria-hidden="true" />
            Saved. The stream reconnects with the new settings.
          </p>
        )}
      </div>
    </form>
  );
};

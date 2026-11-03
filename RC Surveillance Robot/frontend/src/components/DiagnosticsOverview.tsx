/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  ClipboardCopy,
  ClipboardX,
  FileText,
  Loader2,
  Play,
  ScrollText,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CameraConfig, StreamHealth } from '../types/camera';
import type { DiagnosticTestItem } from './DiagnosticsPanel';
import { useNow } from '../hooks/useNow';
import { formatEventTime } from '../services/streamStatusText';
import { buildDiagnosticsSummary } from '../services/diagnosticsSummary';
import { buildDiagnosticReport } from '../services/diagnosticReport';
import { copyText } from '../services/clipboard';
import { hostOrigin } from '../services/connectionService';
import { BTN_PRIMARY, BTN_SECONDARY, Notice, Panel } from './ui';

interface DiagnosticsOverviewProps {
  health: StreamHealth;
  config: CameraConfig;
  tests: DiagnosticTestItem[];
  isRunningAll: boolean;
  onRunAll: () => void;
  /** The reachability request goes to the same host:port that serves the video. */
  probeSharesStreamOrigin: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}

type CheckState = 'pass' | 'fail' | 'warn' | 'unknown' | 'running';

interface CheckRow {
  id: string;
  label: string;
  state: CheckState;
  /** The result in one or two words ("Success", "Not Available"...). */
  result: string;
  /** Request time, when one was measured. */
  time?: string;
  note?: string;
}

const STATE_VIEW: Record<CheckState, { icon: LucideIcon; box: string; text: string }> = {
  pass: { icon: CheckCircle2, box: 'bg-emerald-500/15 text-emerald-300', text: 'text-emerald-300' },
  fail: { icon: XCircle, box: 'bg-rose-500/15 text-rose-300', text: 'text-rose-300' },
  warn: { icon: AlertTriangle, box: 'bg-amber-500/15 text-amber-300', text: 'text-amber-300' },
  unknown: { icon: CircleDashed, box: 'bg-raised text-slate-300', text: 'text-slate-300' },
  running: { icon: Loader2, box: 'bg-cyan-500/15 text-cyan-300', text: 'text-cyan-300' },
};

type CopyFeedback = { status: 'idle' } | { status: 'ok' | 'error'; message: string };

/**
 * The Diagnostics page at a glance: one line per check (camera reachability, stream, snapshot
 * endpoint, CORS request, connection history), each filled from a real probe, measurement or
 * record, plus the buttons to run the probes, open the detailed cards and copy the report.
 * A check that was not run says "Not tested yet"; nothing here is a fixed value.
 */
export const DiagnosticsOverview: React.FC<DiagnosticsOverviewProps> = ({
  health,
  config,
  tests,
  isRunningAll,
  onRunAll,
  probeSharesStreamOrigin,
  detailsOpen,
  onToggleDetails,
}) => {
  const now = useNow(true, 1000);
  const byId = (id: string) => tests.find((t) => t.id === id);

  const rows = useMemo<CheckRow[]>(() => {
    const out: CheckRow[] = [];
    const host = hostOrigin(config.baseUrl) || config.baseUrl || 'no address';
    const ms = (n?: number) => (n != null ? `${n} ms` : undefined);

    // Camera reachability: the probe if it was run, otherwise what the connection manager last measured.
    const ping = byId('base-ping');
    const reach: CheckRow = { id: 'reach', label: `Camera Reachability (${host})`, state: 'unknown', result: 'Not tested yet' };
    if (ping?.status === 'running') Object.assign(reach, { state: 'running', result: 'Testing...' });
    else if (ping?.status === 'passed') Object.assign(reach, { state: 'pass', result: 'Success', time: ms(ping.result?.latencyMs) });
    else if (ping?.status === 'failed') Object.assign(reach, { state: 'fail', result: 'No answer', note: ping.result?.errorMessage });
    else if (health.host.reachable === true) {
      Object.assign(reach, { state: 'pass', result: 'Success (earlier check)', time: ms(health.host.latencyMs) });
    } else if (health.host.reachable === false) {
      Object.assign(reach, { state: 'fail', result: 'No answer (earlier check)', note: health.host.error });
    }
    out.push(reach);

    // Stream endpoint
    const stream = byId('stream-probe');
    const streamRow: CheckRow = {
      id: 'stream',
      label: `Stream Endpoint (${config.streamPath?.trim() || 'not set'})`,
      state: 'unknown',
      result: 'Not tested yet',
    };
    if (stream?.status === 'unconfigured') Object.assign(streamRow, { result: 'Not configured', note: 'Set the stream path in Settings.' });
    else if (stream?.status === 'running') Object.assign(streamRow, { state: 'running', result: 'Testing...' });
    else if (stream?.status === 'passed') Object.assign(streamRow, { state: 'pass', result: 'Success', time: ms(stream.result?.latencyMs) });
    else if (stream?.status === 'failed') Object.assign(streamRow, { state: 'fail', result: 'Failed', note: stream.result?.errorMessage });
    out.push(streamRow);

    // Snapshot endpoint (/capture): many firmwares do not have one, and Capture Still does not need it.
    const snap = byId('snapshot-probe');
    const snapRow: CheckRow = {
      id: 'snapshot',
      label: `Snapshot Endpoint (${config.snapshotPath?.trim() || '/capture'})`,
      state: 'unknown',
      result: 'Not tested yet',
    };
    if (snap?.status === 'running') Object.assign(snapRow, { state: 'running', result: 'Testing...' });
    else if (snap?.status === 'passed') Object.assign(snapRow, { state: 'pass', result: 'Success', time: ms(snap.result?.latencyMs) });
    else if (snap?.status === 'failed') {
      Object.assign(snapRow, {
        state: 'fail',
        result: 'Not Available',
        note: 'The camera did not return an image from this path. Many ESP32-CAM firmwares have no /capture endpoint; Capture Still reads the stream instead and does not need it.',
      });
    }
    out.push(snapRow);

    // CORS: the page cannot read response headers, so this reports what was requested, not what the camera sent.
    out.push(
      config.captureCors
        ? {
            id: 'cors',
            label: 'Snapshot capture (CORS)',
            state: 'warn',
            result: 'Requested',
            note: 'The stream is requested with CORS (Settings). It only works if the camera sends Access-Control-Allow-Origin; a web page cannot read that header, so this is not verified here.',
          }
        : {
            id: 'cors',
            label: 'Snapshot capture (CORS)',
            state: 'unknown',
            result: 'Not requested',
            note: 'Turn on "Allow snapshot capture" in Settings so Capture Still, motion detection and AI can read frames.',
          },
    );

    // Connection history
    const events = health.history.filter((e) => e.type !== 'session_started');
    const problems = events.filter((e) => e.severity === 'warn' || e.severity === 'error');
    const lastProblem = problems[problems.length - 1];
    out.push(
      events.length === 0
        ? { id: 'history', label: 'Connection History', state: 'unknown', result: 'No events yet' }
        : problems.length === 0
          ? { id: 'history', label: 'Connection History', state: 'pass', result: 'Stable', note: `${events.length} event${events.length === 1 ? '' : 's'} recorded, no problems.` }
          : {
              id: 'history',
              label: 'Connection History',
              state: 'warn',
              result: `${problems.length} problem${problems.length === 1 ? '' : 's'} recorded`,
              note: `Last problem at ${formatEventTime(lastProblem.t, now)}: ${lastProblem.message}`,
            },
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tests, health.host, health.history, config.baseUrl, config.streamPath, config.snapshotPath, config.captureCors, now]);

  // ---- Copy report (the plain-text troubleshooting report, with credentials and query strings removed) ----
  const context = useMemo(
    () => ({ streamPathConfigured: Boolean(config.streamPath?.trim()), probeSharesStreamOrigin }),
    [config.streamPath, probeSharesStreamOrigin],
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<CopyFeedback>({ status: 'idle' });
  const [showReport, setShowReport] = useState(false);
  const [reportText, setReportText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mountedRef = useRef(true);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  // When copying failed, put the text in front of the user already selected.
  useEffect(() => {
    if (showReport && feedback.status === 'error' && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [showReport, feedback.status]);

  const generate = (): string => {
    const at = Date.now();
    return buildDiagnosticReport({
      generatedAt: at,
      health,
      summary: buildDiagnosticsSummary(health, context, at),
      config: {
        baseUrl: config.baseUrl,
        streamPath: config.streamPath,
        snapshotPath: config.snapshotPath,
        autoReconnect: config.autoReconnect,
        reconnectIntervalSec: config.reconnectIntervalSec,
        frameMonitor: Boolean(config.frameMonitor),
      },
      env: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        pageProtocol: typeof location !== 'undefined' ? location.protocol : undefined,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      },
    });
  };

  const showFeedback = (next: CopyFeedback) => {
    setFeedback(next);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    // Success fades away; a failure stays until the next attempt so it cannot be missed.
    if (next.status === 'ok') {
      feedbackTimer.current = setTimeout(() => {
        if (mountedRef.current) setFeedback({ status: 'idle' });
      }, 6000);
    }
  };

  const handleCopy = async () => {
    if (busy) return;
    setBusy(true);
    const text = generate();
    setReportText(text);
    let result;
    try {
      result = await copyText(text);
    } catch (err) {
      result = { ok: false as const, reason: 'failed' as const, message: `Copying failed (${err instanceof Error ? err.message : String(err)}). Select the report text below and copy it manually.` };
    }
    if (!mountedRef.current) return;
    setBusy(false);
    if (result.ok) {
      showFeedback({ status: 'ok', message: 'Report copied to the clipboard. It has no passwords, tokens or images, but it does show the camera address and your browser name.' });
    } else {
      showFeedback({ status: 'error', message: result.message });
      setShowReport(true);
    }
  };

  const togglePreview = () => {
    if (!showReport) setReportText(generate());
    setShowReport((v) => !v);
  };

  return (
    <Panel
      id="diag-overview"
      title="Diagnostics"
      icon={Activity}
      description="One line per check, each filled from a real test or record. A check you have not run says so."
      actions={
        <button type="button" onClick={onRunAll} disabled={isRunningAll} className={BTN_PRIMARY}>
          {isRunningAll ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="w-4 h-4" aria-hidden="true" />
          )}
          <span>{isRunningAll ? 'Running Tests...' : 'Run Full Test'}</span>
        </button>
      }
    >
      <ul aria-label="Diagnostic checks" className="rounded-lg border border-line bg-sunken divide-y divide-line">
        {rows.map((row) => {
          const view = STATE_VIEW[row.state];
          const Icon = view.icon;
          return (
            <li key={row.id} className="flex items-start gap-3 p-3 sm:p-4">
              <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${view.box}`}>
                <Icon className={`w-5 h-5 ${row.state === 'running' ? 'animate-spin' : ''}`} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 grid gap-x-4 gap-y-1 @lg:grid-cols-[minmax(0,1fr)_auto] items-start">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-white break-words">{row.label}</div>
                  {row.note && <p className="mt-1 text-xs leading-relaxed text-slate-400 break-words">{row.note}</p>}
                </div>
                <div className="flex items-baseline gap-3 @lg:justify-end @lg:text-right shrink-0">
                  <span className={`text-[13px] font-medium ${view.text}`}>{row.result}</span>
                  {row.time && <span className="text-[13px] font-mono tabular-nums text-slate-200">{row.time}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleDetails}
          aria-expanded={detailsOpen}
          aria-controls="diagnostics-details"
          className={BTN_SECONDARY}
        >
          <ScrollText className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          <span>{detailsOpen ? 'Hide Detailed Logs' : 'View Detailed Logs'}</span>
        </button>
        <button type="button" onClick={handleCopy} disabled={busy} className={BTN_SECONDARY}>
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <ClipboardCopy className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          )}
          <span>Copy Report</span>
        </button>
        <button type="button" onClick={togglePreview} className={BTN_SECONDARY} aria-expanded={showReport}>
          <FileText className="w-4 h-4 text-slate-300" aria-hidden="true" />
          <span>{showReport ? 'Hide report' : 'Show report'}</span>
        </button>
      </div>

      {/* Copy result: announced to screen readers, visible until dismissed or replaced */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {feedback.status === 'ok' && (
          <Notice tone="good">
            <p className="flex items-start gap-2">
              <ClipboardCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{feedback.message}</span>
            </p>
          </Notice>
        )}
        {feedback.status === 'error' && (
          <Notice tone="bad">
            <p className="flex items-start gap-2">
              <ClipboardX className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{feedback.message}</span>
            </p>
          </Notice>
        )}
      </div>

      {showReport && (
        <div className="space-y-1.5">
          <label htmlFor="diagnostic-report-text" className="block text-xs text-slate-300">
            Report text (plain text, safe to paste into a message)
          </label>
          <textarea
            id="diagnostic-report-text"
            ref={textareaRef}
            readOnly
            value={reportText}
            rows={14}
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full bg-sunken border border-line rounded-lg p-2 font-mono text-xs leading-relaxed text-slate-200 resize-y"
          />
        </div>
      )}
    </Panel>
  );
};

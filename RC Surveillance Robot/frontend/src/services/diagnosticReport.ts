/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConnectionEvent, StreamHealth } from '../types/camera';
import { CONNECTION_EVENT_LABELS } from './connectionHistory';
import { describeSample, formatRequestTime, type DiagnosticsSummary } from './diagnosticsSummary';
import { cleanMessage, sanitizeUrl } from './redact';

/**
 * Builds the plain-text diagnostic report the user can copy and paste into a message or issue.
 *
 * Content rules:
 *  - Only things the dashboard measured, each labelled as measured / not measured / unavailable.
 *  - Nothing secret: camera addresses lose credentials, query strings and fragments; messages
 *    pass through redactText; no snapshot or image data is ever included.
 *  - Nothing personal beyond what a bug report needs: the browser's user-agent string and whether
 *    the page is HTTP or HTTPS. No page host name, no account, no location, no time zone.
 */

export const DIAGNOSTICS_VERSION = 'Phase 2';

export interface ReportConfig {
  baseUrl: string;
  streamPath: string;
  snapshotPath: string;
  autoReconnect: boolean;
  reconnectIntervalSec: number;
  frameMonitor: boolean;
}

export interface ReportEnvironment {
  userAgent?: string;
  /** 'http:' or 'https:' (matters for mixed-content blocking). */
  pageProtocol?: string;
  online?: boolean | null;
}

export interface ReportInput {
  generatedAt: number;
  health: StreamHealth;
  summary: DiagnosticsSummary;
  config: ReportConfig;
  env?: ReportEnvironment;
  /** How many of the newest history events to include. */
  maxEvents?: number;
}

export const REPORT_LIMITATIONS: readonly string[] = [
  'Response time is a browser HTTP request to the camera\'s web server, timed until the response headers arrive. It includes connection set-up and the camera\'s own processing time. It is not Wi-Fi latency and not a ping.',
  'Wi-Fi signal strength and packet loss cannot be measured by a web page and are not reported.',
  'Reachability uses a request whose status code and headers the browser hides; any HTTP answer counts as "host answers". A failed check does not prove that an already-working stream failed, and an answering host does not prove video is flowing.',
  'Plain video mode: the page only learns about the first frame of each connection. A stall or freeze that fixes itself is invisible, and "connected" does not prove video is still advancing.',
  'Frame monitor mode: needs the camera to send an Access-Control-Allow-Origin header. It counts frames that arrive; it does not compare picture content.',
  'History is stored in this browser only (localStorage): capped, not shared between browsers, devices or tabs, and it can be cleared by the user or the browser. Response-time samples are not stored across reloads.',
  'Background tabs are throttled by browsers, so detection and retries can be delayed while the dashboard is not visible.',
  'Everything here was measured by the dashboard in the browser. No physical camera, power or Wi-Fi measurement is included.',
];

export function formatReportTime(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t)) return 'unknown time';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace('T', ' ');
}

function pathOnly(path: string): string {
  return cleanMessage((path ?? '').split(/[?#]/)[0], 120) || '(not set)';
}

const SEVERITY_TAG: Record<ConnectionEvent['severity'], string> = {
  info: 'INFO ',
  ok: 'OK   ',
  warn: 'WARN ',
  error: 'ERROR',
};

export function buildDiagnosticReport(input: ReportInput): string {
  const { health, summary, config, generatedAt } = input;
  const env = input.env ?? {};
  const maxEvents = Math.max(1, input.maxEvents ?? 25);
  const out: string[] = [];
  const line = (s = '') => out.push(s);

  line('RC Surveillance Robot - diagnostic report');
  line('==========================================');
  line(`Generated:      ${formatReportTime(generatedAt)} UTC`);
  line(`Diagnostics:    ${DIAGNOSTICS_VERSION}`);
  line(`Browser:        ${cleanMessage(env.userAgent, 200) || 'not available'}`);
  line(
    `Page:           served over ${env.pageProtocol ? env.pageProtocol.replace(':', '').toUpperCase() : 'unknown protocol'}` +
      (env.online == null ? '' : `; browser reports ${env.online ? 'online' : 'OFFLINE'}`),
  );
  line();

  line('CAMERA CONFIGURATION (credentials, query strings and fragments removed)');
  line(`  Camera address:   ${sanitizeUrl(config.baseUrl) || '(not set)'}`);
  line(`  Stream path:      ${pathOnly(config.streamPath)}`);
  line(`  Snapshot path:    ${pathOnly(config.snapshotPath)}`);
  line(`  Stream reading:   ${config.frameMonitor ? 'Frame monitor (fetch; every frame observable)' : 'Plain video element (first frame of each connection only)'}`);
  line(`  Auto-reconnect:   ${config.autoReconnect ? `on (base retry delay ${config.reconnectIntervalSec} s)` : 'off'}`);
  line();

  line('CURRENT STATE');
  line(`  Stream state:     ${summary.state.label}`);
  line(`  Detail:           ${cleanMessage(summary.state.explanation, 400)}`);
  line(`  Status value:     ${health.status}`);
  line();

  line('SUMMARY');
  for (const item of summary.items) {
    const tag = item.availability === 'measured' ? 'measured' : item.availability === 'not-measured' ? 'not measured' : 'unavailable';
    line(`  ${item.label}: ${cleanMessage(item.value, 300)} [${tag}]`);
    if (item.at != null) line(`      time: ${formatReportTime(item.at)} UTC`);
    if (item.note) line(`      note: ${cleanMessage(item.note, 400)}`);
  }
  line();

  line('CAMERA RESPONSE TIME (browser request to the camera, not Wi-Fi latency)');
  const rt = summary.responseTime;
  if (health.hostProbeBlockedReason) {
    line(`  unavailable: ${cleanMessage(health.hostProbeBlockedReason, 300)}`);
  } else if (rt.count === 0) {
    line('  not measured in this page session');
  } else {
    const last = rt.last!;
    line(`  Last measurement: ${describeSample(last, health.hostProbeTimeoutMs)} at ${formatReportTime(last.at)} UTC (${last.trigger})`);
    line(`  Requests in this session's list: ${rt.count} (${rt.answered} answered, ${rt.failed} failed or timed out)`);
    if (rt.minMs != null && rt.medianMs != null && rt.maxMs != null) {
      line(`  Answered requests: min ${formatRequestTime(rt.minMs)}, median ${formatRequestTime(rt.medianMs)}, max ${formatRequestTime(rt.maxMs)}`);
    }
    const recent = health.hostSamples
      .slice(-10)
      .map((s) => (s.ok ? formatRequestTime(s.elapsedMs) : s.failure === 'timeout' ? 'timeout' : 'error'))
      .join(', ');
    line(`  Last ${Math.min(10, rt.count)} (oldest first): ${recent}`);
  }
  line();

  line('MEASUREMENT AVAILABILITY');
  for (const c of summary.capabilities) {
    line(`  [${c.state}] ${c.label}: ${cleanMessage(c.detail, 400)}`);
  }
  line();

  const events = health.history;
  const shown = events.slice(-maxEvents);
  line(`RECENT CONNECTION EVENTS (${shown.length} of ${events.length} stored; oldest first)`);
  if (shown.length === 0) {
    line('  none recorded');
  } else {
    for (const e of shown) {
      const repeat = e.count > 1 ? ` (x${e.count}, last ${formatReportTime(e.lastT)})` : '';
      const earlier = e.restored ? ' [earlier page session]' : '';
      line(`  ${formatReportTime(e.t)}  ${SEVERITY_TAG[e.severity]}  ${CONNECTION_EVENT_LABELS[e.type]}: ${cleanMessage(e.message, 300)}${repeat}${earlier}`);
    }
  }
  line(`  History storage: ${health.historyStorage.status === 'persistent' ? 'saved in this browser' : 'memory only (lost when the page closes)'}${health.historyStorage.reason ? ` - ${cleanMessage(health.historyStorage.reason, 200)}` : ''}`);
  line();

  line('KNOWN MEASUREMENT LIMITATIONS');
  for (const l of REPORT_LIMITATIONS) line(`  - ${l}`);
  line();
  line('End of report. It contains no passwords, tokens, snapshot images or video data. It does show the camera address and browser name; edit them out before posting it publicly if you prefer.');
  return out.join('\n');
}

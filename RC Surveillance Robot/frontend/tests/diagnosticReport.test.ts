/**
 * Diagnostic report: pure text generation. Pins down that it is complete, readable, bounded, and
 * safe to paste into a public message (no credentials, tokens, images or personal details).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_LIMITATIONS,
  buildDiagnosticReport,
  formatReportTime,
  type ReportConfig,
} from '../src/services/diagnosticReport';
import { buildDiagnosticsSummary } from '../src/services/diagnosticsSummary';
import type { ConnectionEvent, StreamHealth } from '../src/types/camera';
import { healthFixture } from './helpers';

const NOW = Date.UTC(2026, 9, 16, 9, 12, 3, 120);
const CONFIG: ReportConfig = {
  baseUrl: 'http://192.168.1.100',
  streamPath: ':81/stream',
  snapshotPath: '/capture',
  autoReconnect: true,
  reconnectIntervalSec: 5,
  frameMonitor: false,
};

function report(over: Partial<StreamHealth> = {}, config: Partial<ReportConfig> = {}, extra: { maxEvents?: number; env?: object } = {}) {
  const health = healthFixture(over);
  const summary = buildDiagnosticsSummary(health, { streamPathConfigured: true, probeSharesStreamOrigin: false }, NOW);
  return buildDiagnosticReport({
    generatedAt: NOW,
    health,
    summary,
    config: { ...CONFIG, ...config },
    env: { userAgent: 'Mozilla/5.0 TestBrowser/1.0', pageProtocol: 'http:', online: true, ...(extra.env ?? {}) },
    maxEvents: extra.maxEvents,
  });
}

const ev = (id: number, over: Partial<ConnectionEvent> = {}): ConnectionEvent => ({
  id, t: NOW - (100 - id) * 1000, lastT: NOW - (100 - id) * 1000, count: 1, type: 'stream_disconnected', severity: 'error', message: `event ${id}`, ...over,
});

describe('report content', () => {
  it('contains the diagnostic time, app, browser, page protocol and the current state', () => {
    const r = report();
    assert.match(r, /Generated: {6}2026-10-16 09:12:03Z UTC/);
    assert.match(r, /Diagnostics: {4}Phase 2/);
    assert.match(r, /Browser: {8}Mozilla\/5\.0 TestBrowser\/1\.0/);
    assert.match(r, /served over HTTP; browser reports online/);
    assert.match(r, /Stream state: {5}Stream connected/);
    assert.match(r, /Status value: {5}connected/);
  });

  it('contains camera reachability, last frame, reconnect count and the most recent error', () => {
    const r = report({
      status: 'reconnecting',
      attempt: 2,
      totalReconnects: 3,
      lastFrameAt: NOW - 20_000,
      lastError: 'No frame received within 8s of opening the stream.',
      lastErrorAt: NOW - 5000,
      host: { reachable: true, checkedAt: NOW - 1000, latencyMs: 91 },
    });
    assert.match(r, /Camera host reachability: Answers \(request took 91 ms\)/);
    assert.match(r, /First frame of this connection: 20s ago/);
    assert.match(r, /time: 2026-10-16 09:11:43Z UTC/);
    assert.match(r, /Reconnection attempts: 2 of 6 in the current recovery; 3 reconnects since page load/);
    assert.match(r, /Most recent connection error: No frame received within 8s/);
  });

  it('labels every summary item as measured, not measured or unavailable', () => {
    const r = report();
    assert.match(r, /Camera host reachability: No check has run yet \[not measured\]/);
    assert.match(r, /\[measured\]/);
    const blocked = report({ hostProbeBlockedReason: 'blocked by mixed content' });
    assert.match(blocked, /\[unavailable\]/);
    assert.match(blocked, /unavailable: blocked by mixed content/);
  });

  it('lists recent events oldest first, with repeat counts and the earlier-session flag', () => {
    const r = report({
      history: [
        ev(1, { type: 'session_started', severity: 'info', message: 'Dashboard opened.', restored: true }),
        ev(2, { type: 'reconnect_failed', message: 'Reconnect attempt failed: timeout', count: 4, lastT: NOW - 1000 }),
      ],
    });
    assert.match(r, /RECENT CONNECTION EVENTS \(2 of 2 stored; oldest first\)/);
    assert.match(r, /INFO {3}Dashboard opened: Dashboard opened\. \[earlier page session\]/);
    assert.match(r, /ERROR {2}Reconnect failed: Reconnect attempt failed: timeout \(x4, last 2026-10-16 09:12:02Z\)/);
    assert.ok(r.indexOf('Dashboard opened.') < r.indexOf('Reconnect attempt failed'));
  });

  it('includes the response-time statistics, not just the last value', () => {
    const r = report({
      hostSamples: [
        { at: NOW - 3000, ok: true, elapsedMs: 40, trigger: 'auto' },
        { at: NOW - 2000, ok: false, elapsedMs: 2500, failure: 'timeout', trigger: 'auto' },
        { at: NOW - 1000, ok: true, elapsedMs: 60, trigger: 'manual' },
      ],
    });
    assert.match(r, /Last measurement: answered in 60 ms at 2026-10-16 09:12:02Z UTC \(manual\)/);
    assert.match(r, /3 \(2 answered, 1 failed or timed out\)/);
    assert.match(r, /min 40 ms, median 50 ms, max 60 ms/);
    assert.match(r, /Last 3 \(oldest first\): 40 ms, timeout, 60 ms/);
    assert.match(r, /not Wi-Fi latency/);
  });

  it('describes the configuration', () => {
    const r = report({}, { frameMonitor: true, autoReconnect: false });
    assert.match(r, /Camera address: {3}http:\/\/192\.168\.1\.100/);
    assert.match(r, /Stream path: {6}:81\/stream/);
    assert.match(r, /Frame monitor/);
    assert.match(r, /Auto-reconnect: {3}off/);
  });
});

describe('missing or unavailable data', () => {
  it('says so instead of inventing values', () => {
    const r = report({ lastFrameAt: null, history: [] }, { baseUrl: '' }, { env: { userAgent: undefined, pageProtocol: undefined, online: null } });
    assert.match(r, /Camera address: {3}\(not set\)/);
    assert.match(r, /No frame confirmed yet \[not measured\]/);
    assert.match(r, /not measured in this page session/);
    assert.match(r, /none recorded/);
    assert.match(r, /Browser: {8}not available/);
    assert.match(r, /unknown protocol/);
  });

  it('formats a missing or invalid time as unknown', () => {
    assert.equal(formatReportTime(null), 'unknown time');
    assert.equal(formatReportTime(undefined), 'unknown time');
    assert.equal(formatReportTime(NaN), 'unknown time');
    assert.equal(formatReportTime(8.64e15 + 1), 'unknown time');
  });

  it('reports memory-only history storage', () => {
    const r = report({ historyStorage: { status: 'memory-only', reason: 'Browser storage is full' } });
    assert.match(r, /memory only \(lost when the page closes\) - Browser storage is full/);
  });
});

describe('what the report must never contain', () => {
  it('strips credentials, query strings and fragments from the camera address and paths', () => {
    const r = report({}, {
      baseUrl: 'http://admin:hunter2@192.168.1.100:8080/?token=SECRETTOKEN#x',
      streamPath: ':81/stream?auth=abc123',
      snapshotPath: '/capture?password=pw',
    });
    for (const secret of ['hunter2', 'admin', 'SECRETTOKEN', 'abc123', 'password=pw']) assert.ok(!r.includes(secret), `leaked ${secret}`);
    assert.match(r, /Camera address: {3}http:\/\/192\.168\.1\.100:8080\n/);
  });

  it('redacts secrets that reached an event or error message', () => {
    const r = report({
      lastError: 'GET http://u:pw123@10.0.0.5/s?token=TOK failed, password=hunter2',
      history: [ev(1, { message: 'failed Authorization: Bearer abcdef.ghijkl.mnop' })],
    });
    for (const secret of ['pw123', 'TOK', 'hunter2', 'abcdef.ghijkl']) assert.ok(!r.includes(secret), `leaked ${secret}`);
  });

  it('contains no image or video data and does not name the page host', () => {
    const r = report({}, {}, { env: { pageProtocol: 'https:' } });
    assert.ok(!/data:image|base64|blob:/i.test(r));
    assert.ok(!/localhost|3000/.test(r));
  });

  it('says plainly that it still shows the camera address and the browser name', () => {
    const r = report({}, {}, { env: { userAgent: 'TestBrowser/1.0' } });
    assert.match(r, /TestBrowser\/1\.0/);
    assert.match(r, /It does show the camera address and browser name/);
  });

  it('is bounded even with long messages and a full history', () => {
    const history = Array.from({ length: 100 }, (_, i) => ev(i + 1, { message: 'x'.repeat(2000) }));
    const r = report({ history }, {}, { maxEvents: 25 });
    assert.match(r, /\(25 of 100 stored; oldest first\)/);
    assert.ok(r.length < 20_000, `report is ${r.length} characters`);
    assert.ok(!r.includes('x'.repeat(400)), 'one message must not be able to inflate the report');
  });
});

describe('known limitations', () => {
  it('always lists them, and they do not overclaim', () => {
    const r = report();
    for (const l of REPORT_LIMITATIONS) assert.ok(r.includes(l), `missing limitation: ${l.slice(0, 40)}`);
    assert.match(r, /not Wi-Fi latency and not a ping/);
    assert.match(r, /Wi-Fi signal strength and packet loss cannot be measured/);
    assert.match(r, /No physical camera, power or Wi-Fi measurement is included/);
  });
});

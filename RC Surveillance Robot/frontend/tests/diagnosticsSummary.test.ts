/**
 * Diagnostics summary: pure functions over a health snapshot. What these pin down is honesty:
 * every item says whether it was measured, not measured yet, or cannot be measured, and the
 * summary never lets "host answers" pass for "video is flowing" or a failed one-off check pass
 * for a failed stream.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiagnosticsSummary,
  describeSample,
  formatRequestTime,
  summarizeResponseTimes,
  type SummaryContext,
} from '../src/services/diagnosticsSummary';
import type { HostProbeSample, StreamHealth } from '../src/types/camera';
import { healthFixture } from './helpers';

const CTX: SummaryContext = { streamPathConfigured: true, probeSharesStreamOrigin: false };
const NOW = 1_060_000;
const build = (over: Partial<StreamHealth> = {}, ctx: Partial<SummaryContext> = {}) =>
  buildDiagnosticsSummary(healthFixture(over), { ...CTX, ...ctx }, NOW);
const item = (s: ReturnType<typeof build>, id: string) => s.items.find((i) => i.id === id)!;
const cap = (s: ReturnType<typeof build>, id: string) => s.capabilities.find((c) => c.id === id)!;
const sample = (ms: number, extra: Partial<HostProbeSample> = {}): HostProbeSample => ({
  at: 1, ok: true, elapsedMs: ms, trigger: 'manual', ...extra,
});

describe('stream state', () => {
  it('keeps the Phase 1 status values apart', () => {
    const keys = (over: Partial<StreamHealth>) => build(over).state.key;
    assert.equal(keys({ status: 'unconfigured' }), 'unconfigured');
    assert.equal(keys({ status: 'host_reachable' }), 'host_reachable');
    assert.equal(keys({ status: 'connecting' }), 'connecting');
    assert.equal(keys({ status: 'connected' }), 'connected');
    assert.equal(keys({ status: 'reconnecting' }), 'reconnecting');
    assert.equal(keys({ status: 'error', lastError: 'x' }), 'error');
    assert.equal(keys({ status: 'disconnected' }), 'disconnected');
  });

  it('says "stalled" only when a stall was actually detected', () => {
    assert.equal(build({ status: 'reconnecting', failureKind: 'stall', lastError: 'Stalled: no frame for 5.0s' }).state.key, 'stalled');
    assert.equal(build({ status: 'reconnecting', failureKind: 'connect-timeout', lastError: 'x' }).state.key, 'reconnecting');
    assert.match(build({ status: 'error', failureKind: 'stall', lastError: 'x' }).state.label, /stalled and did not recover/);
  });

  it('does not let plain video mode claim that video is advancing', () => {
    const plain = build({ status: 'connected', evidence: 'first-frame-only' }).state;
    assert.match(plain.explanation, /cannot observe a later stall/);
    assert.match(plain.explanation, /does not prove/);
    const monitor = build({ status: 'connected', evidence: 'frames', mode: 'monitor' }).state;
    assert.match(monitor.explanation, /Frames are arriving/);
  });

  it('a stream that is simply not open says so instead of a bare "Disconnected"', () => {
    const closed = build({ status: 'disconnected', active: false }).state;
    assert.equal(closed.key, 'disconnected');
    assert.match(closed.label, /stream not open on this page/);
    assert.match(closed.explanation, /only while the Live Feed is on screen/);
    assert.match(closed.explanation, /never add a second connection/);
    // An open stream that dropped keeps the plain word.
    assert.equal(build({ status: 'disconnected', active: true }).state.label, 'Disconnected');
  });

  it('a responding host with no stream path is not "connected"', () => {
    const s = build({ status: 'host_reachable' }).state;
    assert.notEqual(s.key, 'connected');
    assert.match(s.explanation, /no stream path/);
  });
});

describe('camera host item', () => {
  it('is "not measured" until something measured it', () => {
    const i = item(build(), 'host');
    assert.equal(i.availability, 'not-measured');
    assert.equal(i.value, 'No check has run yet');
  });

  it('shows that the host is checking', () => {
    assert.equal(item(build({ hostChecking: true }), 'host').value, 'Checking...');
  });

  it('a reachable host is measured, shows the request time, and warns it is not proof of video', () => {
    const i = item(build({ host: { reachable: true, checkedAt: NOW - 5000, latencyMs: 87 } }), 'host');
    assert.equal(i.availability, 'measured');
    assert.match(i.value, /Answers \(request took 87 ms\), 5s ago/);
    assert.match(i.note ?? '', /does not show that video is flowing/);
    assert.equal(i.tone, 'good');
  });

  it('a failed check while the stream is connected is a warning about one request, not a stream failure', () => {
    const i = item(build({ status: 'connected', host: { reachable: false, checkedAt: NOW - 1000, failure: 'timeout' } }), 'host');
    assert.equal(i.tone, 'warn');
    assert.match(i.value, /No answer \(timed out\)/);
    assert.match(i.note ?? '', /does not mean a working stream failed/);
  });

  it('a failed check while the stream is down is reported as a problem', () => {
    const i = item(build({ status: 'error', host: { reachable: false, checkedAt: NOW, failure: 'network' } }), 'host');
    assert.equal(i.tone, 'bad');
    assert.match(i.value, /network error/);
  });

  it('an old failed check is marked outdated once a video frame arrived after it', () => {
    const i = item(build({ status: 'connected', lastFrameAt: NOW - 1000, host: { reachable: false, checkedAt: NOW - 20_000, failure: 'timeout' } }), 'host');
    assert.match(i.value, /Earlier check: no answer \(timed out\)/);
    assert.match(i.value, /Outdated/);
    assert.match(i.note ?? '', /reachable again/);
    assert.equal(i.tone, 'neutral', 'must not keep showing a power/Wi-Fi warning');
    assert.doesNotMatch(i.note ?? '', /Check power/);
  });

  it('a failed check newer than the last frame is still a problem', () => {
    const i = item(build({ status: 'error', lastFrameAt: NOW - 20_000, host: { reachable: false, checkedAt: NOW - 1000, failure: 'network' } }), 'host');
    assert.equal(i.tone, 'bad');
    assert.match(i.note ?? '', /Check power/);
  });

  it('an old "answers" result is shown as measured, with its own age, and is not claimed to be current video', () => {
    const i = item(build({ lastFrameAt: NOW - 1000, host: { reachable: true, checkedAt: NOW - 20_000, latencyMs: 40 } }), 'host');
    assert.match(i.value, /Answers \(request took 40 ms\), 20s ago/);
    assert.match(i.note ?? '', /does not show that video is flowing/);
  });

  it('is "unavailable", not "unreachable", when the browser blocks the request', () => {
    const i = item(build({ hostProbeBlockedReason: 'mixed content' }), 'host');
    assert.equal(i.availability, 'unavailable');
    assert.equal(i.note, 'mixed content');
  });
});

describe('frame, error, attempts and recovery items', () => {
  it('plain mode labels the frame as the first frame of the connection and refuses to call it proof', () => {
    const i = item(build({ lastFrameAt: NOW - 3000 }), 'frame');
    assert.equal(i.label, 'First frame of this connection');
    assert.equal(i.availability, 'measured');
    assert.match(i.note ?? '', /not proof that video is still advancing/);
  });

  it('monitor mode labels it as the last confirmed frame and says content is not compared', () => {
    const i = item(build({ evidence: 'frames', mode: 'monitor', lastFrameAt: NOW - 500 }), 'frame');
    assert.equal(i.label, 'Last confirmed frame');
    assert.match(i.note ?? '', /picture content is not compared/);
  });

  it('labels the frame as belonging to the last connection when the stream is not open', () => {
    const closed = { status: 'disconnected' as const, active: false, lastFrameAt: NOW - 90_000 };
    assert.equal(item(build(closed), 'frame').label, 'First frame of the last connection');
    assert.equal(
      item(build({ ...closed, evidence: 'frames', mode: 'monitor' }), 'frame').label,
      'Last confirmed frame (before the stream was closed)',
    );
  });

  it('no frame yet is "not measured"', () => {
    const i = item(build({ lastFrameAt: null, active: false }), 'frame');
    assert.equal(i.availability, 'not-measured');
    assert.match(i.note ?? '', /only open while the Live Feed/);
  });

  it('reports the most recent error, and that the stream recovered since', () => {
    assert.equal(item(build(), 'error').value, 'None since the page was loaded');
    const e = item(build({ status: 'connected', lastError: 'Stalled', lastErrorAt: NOW - 20_000 }), 'error');
    assert.equal(e.value, 'Stalled');
    assert.match(e.note ?? '', /since then the stream reconnected/);
    assert.equal(e.tone, 'neutral');
    assert.equal(item(build({ status: 'error', lastError: 'x', lastErrorAt: NOW }), 'error').tone, 'bad');
  });

  it('counts reconnection attempts in the recovery and since the page loaded', () => {
    const a = item(build({ attempt: 2, maxAttempts: 6, totalReconnects: 5 }), 'attempts');
    assert.match(a.value, /2 of 6 in the current recovery; 5 reconnects since page load/);
    assert.match(item(build({ totalReconnects: 1 }), 'attempts').value, /1 reconnect since page load/);
  });

  it('answers "did reconnection succeed?" in each state', () => {
    const rec = (state: StreamHealth['recovery']['state']) =>
      item(build({ recovery: { state, startedAt: NOW - 8000, finishedAt: NOW - 1000, attempts: 2, reason: 'connection lost' } }), 'reconnect-result');
    assert.match(rec('in_progress').value, /Not yet/);
    assert.match(rec('succeeded').value, /^Yes, after 7\.0s/);
    assert.match(rec('failed').value, /^No/);
    assert.match(rec('none').value, /No reconnection was needed/);
    assert.match(rec('none').note ?? '', /invisible to the page/, 'plain mode must not claim there was no interruption');
  });

  it('does not say "no reconnection was needed" when a recovery was cut short', () => {
    const none = { state: 'none' as const, startedAt: null, finishedAt: null, attempts: 0, reason: null };
    const i = item(
      build({ status: 'disconnected', active: false, recovery: none, interruptedRecovery: { startedAt: NOW - 30_000, reason: 'Stalled: no frame for 5.0s', attempts: 2 } }),
      'reconnect-result',
    );
    assert.match(i.value, /^Unknown - recovery was interrupted/);
    assert.match(i.note ?? '', /Live Feed left/);
    assert.match(i.note ?? '', /Stalled: no frame/);
    assert.equal(i.tone, 'warn');
    assert.doesNotMatch(i.value, /No reconnection was needed/);
  });

  it('reports the most recent successful recovery of this session', () => {
    assert.match(item(build(), 'last-recovery').value, /None in this page session/);
    const r = item(build({ lastRecovery: { at: NOW - 30_000, durationMs: 4200, attempts: 2 } }), 'last-recovery');
    assert.match(r.value, /30s ago \(took 4\.2s, 2 automatic retries\)/);
    assert.equal(r.at, NOW - 30_000);
  });
});

describe('measurement availability', () => {
  it('Wi-Fi signal strength and packet loss are always unavailable and never invented', () => {
    for (const over of [{}, { evidence: 'frames' as const, mode: 'monitor' as const, frameStats: { framesTotal: 99, fps5s: 10, longestGapMs5min: 0 } }]) {
      const s = build(over);
      assert.equal(cap(s, 'wifi-rssi').state, 'unavailable');
      assert.equal(cap(s, 'packet-loss').state, 'unavailable');
      assert.equal(cap(s, 'frame-content').state, 'unavailable');
    }
  });

  it('stall detection is unavailable in plain mode and says what is needed', () => {
    const c = cap(build(), 'stall-detection');
    assert.equal(c.state, 'unavailable');
    assert.match(c.detail, /Frame monitor/);
    assert.match(c.detail, /Access-Control-Allow-Origin/);
  });

  it('stall detection is available when the Frame monitor is receiving frames', () => {
    const c = cap(build({ mode: 'monitor', evidence: 'frames', frameStats: { framesTotal: 40, fps5s: 8, longestGapMs5min: 120 } }), 'stall-detection');
    assert.equal(c.state, 'available');
  });

  it('stall detection is unavailable, with the CORS explanation, when the monitor never read a frame', () => {
    const c = cap(
      build({
        mode: 'monitor',
        evidence: 'frames',
        status: 'reconnecting',
        frameStats: { framesTotal: 0, fps5s: 0, longestGapMs5min: 0 },
        lastError: 'Could not read the stream. Either the network request failed, or the camera does not send "Access-Control-Allow-Origin"...',
      }),
      'stall-detection',
    );
    assert.equal(c.state, 'unavailable');
    assert.match(c.detail, /Access-Control-Allow-Origin/);
    assert.match(c.detail, /Turn it off/);
  });

  it('stall detection is merely "limited" while the monitor has not read a frame yet for another reason', () => {
    const c = cap(build({ mode: 'monitor', evidence: 'frames', status: 'connecting', frameStats: { framesTotal: 0, fps5s: 0, longestGapMs5min: 0 } }), 'stall-detection');
    assert.equal(c.state, 'limited');
  });

  it('request timing is available, labelled as a browser request, and warns when it shares the video port', () => {
    const normal = cap(build(), 'reachability');
    assert.equal(normal.state, 'available');
    assert.match(normal.detail, /timed until the response headers arrive/);
    assert.ok(!/ping/i.test(normal.detail) || /not a ping/i.test(normal.detail));
    const shared = cap(build({}, { probeSharesStreamOrigin: true }), 'reachability');
    assert.match(shared.detail, /same port as the video/);
    assert.equal(cap(build({ hostProbeBlockedReason: 'blocked' }), 'reachability').state, 'unavailable');
  });

  it('first-frame detection is available in both modes', () => {
    assert.equal(cap(build(), 'first-frame').state, 'available');
  });
});

describe('response-time statistics', () => {
  it('is empty-safe', () => {
    const s = summarizeResponseTimes([]);
    assert.deepEqual([s.count, s.answered, s.failed, s.last, s.minMs, s.medianMs, s.maxMs], [0, 0, 0, null, null, null, null]);
  });

  it('uses answered requests only, so a timeout is not mistaken for a latency', () => {
    const s = summarizeResponseTimes([sample(40), sample(2500, { ok: false, failure: 'timeout' }), sample(60), sample(50)]);
    assert.equal(s.count, 4);
    assert.equal(s.answered, 3);
    assert.equal(s.failed, 1);
    assert.equal(s.minMs, 40);
    assert.equal(s.maxMs, 60);
    assert.equal(s.medianMs, 50);
    assert.equal(s.last!.elapsedMs, 50);
  });

  it('computes the median of an even number of samples and handles all-failed lists', () => {
    assert.equal(summarizeResponseTimes([sample(10), sample(20), sample(30), sample(41)]).medianMs, 25);
    const failed = summarizeResponseTimes([sample(2500, { ok: false, failure: 'timeout' })]);
    assert.equal(failed.medianMs, null);
    assert.equal(failed.failed, 1);
  });

  it('formats request times and describes each outcome', () => {
    assert.equal(formatRequestTime(87.4), '87 ms');
    assert.equal(formatRequestTime(1234), '1.23 s');
    assert.equal(formatRequestTime(25_000), '25.0 s');
    assert.equal(formatRequestTime(-1), '-');
    assert.equal(formatRequestTime(NaN), '-');
    assert.equal(describeSample(sample(87), 2500), 'answered in 87 ms');
    assert.match(describeSample(sample(2500, { ok: false, failure: 'timeout' }), 2500), /no answer within 2\.50 s \(timed out\)/);
    assert.match(describeSample(sample(4, { ok: false, failure: 'network' }), 2500), /failed after 4 ms \(browser network error/);
  });

  it('the summary carries the statistics', () => {
    const s = build({ hostSamples: [sample(10), sample(30)] });
    assert.equal(s.responseTime.medianMs, 20);
  });
});

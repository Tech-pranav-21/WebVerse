/**
 * Status wording tests. The tooltip text must only claim what the evidence supports.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeReachability, describeStatus, formatAgo, formatDuration, formatEventTime, hostResultIsOutdated } from '../src/services/streamStatusText';
import { make } from './helpers';
import type { StreamHealth } from '../src/types/camera';

function health(patch: Partial<StreamHealth> = {}): StreamHealth {
  const h = make({ start: false });
  return { ...h.conn.getSnapshot(), ...patch };
}

describe('describeStatus', () => {
  it('says plainly that a connected plain <img> only proves the first frame', () => {
    const text = describeStatus(health({ status: 'connected', evidence: 'first-frame-only' }));
    assert.match(text, /first frame/i);
    assert.match(text, /Frame monitor/);
  });

  it('claims continuous frames only when the frame monitor provides them', () => {
    assert.match(describeStatus(health({ status: 'connected', evidence: 'frames' })), /Frames are arriving/);
  });

  it('reports retry progress while reconnecting', () => {
    const text = describeStatus(health({ status: 'reconnecting', attempt: 2, maxAttempts: 6, lastError: 'boom' }));
    assert.match(text, /2 of 6/);
    assert.match(text, /boom/);
  });

  it('does not blame a disconnected stream on an old, recovered error', () => {
    const text = describeStatus(health({ status: 'disconnected', lastError: 'Stalled: no frame for 5.0s' }));
    assert.doesNotMatch(text, /Stalled/);
  });

  it('explains a browser-blocked stream', () => {
    const text = describeStatus(health({ status: 'disconnected', blockedReason: 'mixed content' }));
    assert.equal(text, 'mixed content');
  });

  it('shows the error for the Error state', () => {
    assert.equal(describeStatus(health({ status: 'error', lastError: 'gave up' })), 'gave up');
  });
});

describe('describeReachability', () => {
  it('stays silent until the host has been checked', () => {
    assert.equal(describeReachability(health()), null);
  });

  it('distinguishes reachable and unreachable', () => {
    const ok = health({ host: { reachable: true, checkedAt: 1 } });
    const bad = health({ host: { reachable: false, checkedAt: 1 } });
    assert.match(describeReachability(ok)!, /answers/);
    assert.match(describeReachability(bad)!, /not answering/);
  });

  it('stops warning about power and Wi-Fi once a frame arrived after the failed check', () => {
    const stale = health({ lastFrameAt: 5000, host: { reachable: false, checkedAt: 1000 } });
    assert.equal(hostResultIsOutdated(stale), true);
    assert.match(describeReachability(stale)!, /reachable again/);
    assert.doesNotMatch(describeReachability(stale)!, /Check power/);
  });

  it('keeps warning when the failed check is newer than the last frame, or no frame ever arrived', () => {
    assert.equal(hostResultIsOutdated(health({ lastFrameAt: 1000, host: { reachable: false, checkedAt: 5000 } })), false);
    assert.equal(hostResultIsOutdated(health({ lastFrameAt: null, host: { reachable: false, checkedAt: 5000 } })), false);
    assert.match(describeReachability(health({ lastFrameAt: 1000, host: { reachable: false, checkedAt: 5000 } }))!, /Check power/);
  });

  it('never treats an "answers" result as outdated', () => {
    assert.equal(hostResultIsOutdated(health({ lastFrameAt: 9000, host: { reachable: true, checkedAt: 1000 } })), false);
  });
});

describe('formatting helpers', () => {
  it('formats durations', () => {
    assert.equal(formatDuration(850), '850ms');
    assert.equal(formatDuration(3200), '3.2s');
    assert.equal(formatDuration(125_000), '2m 05s');
    assert.equal(formatDuration(-1), '-');
    assert.equal(formatDuration(Number.NaN), '-');
  });

  it('formats relative times', () => {
    assert.equal(formatAgo(null, 10_000), 'never');
    assert.equal(formatAgo(9_500, 10_000), 'just now');
    assert.equal(formatAgo(0, 12_000), '12s ago');
    assert.equal(formatAgo(0, 180_000), '3m ago');
    assert.equal(formatAgo(20_000, 10_000), 'just now', 'clock skew never produces a negative age');
  });
});

describe('formatEventTime (Phase 2)', () => {
  const clockOf = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour12: false });

  it('shows only the clock time for something that happened today', () => {
    const now = new Date(2026, 9, 16, 15, 0, 0).getTime();
    const t = new Date(2026, 9, 16, 9, 30, 5).getTime();
    assert.equal(formatEventTime(t, now), clockOf(t));
  });

  it('adds the date for an older event, because the saved history spans page loads', () => {
    const now = new Date(2026, 9, 16, 15, 0, 0).getTime();
    const t = new Date(2026, 9, 14, 9, 30, 5).getTime();
    const out = formatEventTime(t, now);
    assert.ok(out.endsWith(clockOf(t)));
    assert.ok(out.length > clockOf(t).length);
  });

  it('does not throw on an invalid time', () => {
    assert.equal(formatEventTime(NaN, Date.now()), '-');
  });
});

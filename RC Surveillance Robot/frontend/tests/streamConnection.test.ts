/**
 * StreamConnection behaviour tests.
 *
 * MOCKED: these run against a fake clock and a fake transport. They prove the supervisor's logic
 * (status transitions, retry bounds, duplicate prevention, stale-event handling, cleanup). They do
 * NOT prove anything about a real ESP32-CAM, Wi-Fi or the browser's <img> behaviour; see
 * PHASE1_STABILITY_REPORT.md for what was checked against a mock camera and what needs hardware.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CAM, CONNECT_TIMEOUT_MS, Harness, MakeOptions, flush, make } from './helpers';

const harnesses: Harness[] = [];
function mk(options?: MakeOptions): Harness {
  const h = make(options);
  harnesses.push(h);
  return h;
}

// Whatever a scenario does, two stream connections must never be open at once.
afterEach(() => {
  for (const h of harnesses) {
    assert.ok(h.transport.maxConcurrent <= 1, `more than one stream was open at once (${h.transport.maxConcurrent})`);
  }
  harnesses.length = 0;
});

const status = (h: Harness) => h.conn.getSnapshot().status;
const snap = (h: Harness) => h.conn.getSnapshot();
const STREAM = CAM.url;

/** Fail the current attempt with a connect timeout. */
function timeoutAttempt(h: Harness): void {
  h.clock.advance(CONNECT_TIMEOUT_MS);
}

describe('initial connection', () => {
  it('opens exactly one stream with the configured URL and reports Connecting until a frame arrives', () => {
    const h = mk();
    assert.equal(h.transport.sessions.length, 1);
    assert.equal(h.transport.last.url, STREAM, 'first attempt must use the configured URL untouched');
    assert.equal(status(h), 'connecting');
    assert.equal(snap(h).connectedSince, null);
    assert.equal(snap(h).active, true);
  });

  it('reports Connected only after the first frame, and records when', () => {
    const h = mk();
    h.clock.advance(1234);
    h.transport.last.firstFrame();
    const s = snap(h);
    assert.equal(s.status, 'connected');
    assert.equal(s.connectedSince, h.clock.now());
    assert.equal(s.lastFrameAt, h.clock.now());
    assert.equal(s.attempt, 0);
  });

  it('does not probe the camera host while the stream is healthy', async () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.clock.advance(30_000);
    await flush();
    assert.equal(h.hostCalls.length, 0);
  });

  it('is honest about what a plain <img> can observe', () => {
    const h = mk();
    h.transport.last.firstFrame();
    assert.equal(snap(h).evidence, 'first-frame-only');
    assert.equal(snap(h).frameStats, null);
  });

  it('cannot see a mid-stream stall in plain <img> mode (documented limitation)', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.clock.advance(120_000); // two minutes of silence, no event from the browser
    assert.equal(status(h), 'connected', 'with only a first-frame signal this cannot be detected');
    assert.equal(h.transport.sessions.length, 1);
  });
});

describe('connect timeout and automatic recovery', () => {
  it('times out, goes to Reconnecting, retries with a cache-busting URL and recovers', () => {
    const h = mk();
    const first = h.transport.last;

    h.clock.advance(CONNECT_TIMEOUT_MS - 1);
    assert.equal(status(h), 'connecting');
    h.clock.advance(1);

    assert.equal(status(h), 'reconnecting');
    assert.match(snap(h).lastError ?? '', /No frame received within 8s/);
    assert.equal(first.closed, true, 'the dead attempt must be closed');
    assert.equal(snap(h).attempt, 1);
    assert.equal(snap(h).recovery.state, 'in_progress');
    assert.equal(snap(h).nextRetryAt, h.clock.now() + 5000);

    h.clock.advance(4999);
    assert.equal(h.transport.sessions.length, 1, 'no retry before the delay has passed');
    h.clock.advance(1);
    assert.equal(h.transport.sessions.length, 2);
    assert.equal(h.transport.last.url, `${STREAM}?_rc=2`);
    assert.equal(status(h), 'reconnecting', 'a retry that has not delivered a frame is not "Connected"');

    h.transport.last.firstFrame();
    assert.equal(status(h), 'connected');
    const r = snap(h).recovery;
    assert.equal(r.state, 'succeeded');
    assert.equal(r.attempts, 1);
    assert.ok(snap(h).events.some((e) => e.level === 'ok' && /recovered/i.test(e.message)));
  });

  it('keeps the camera-host check separate: it is requested once on failure and never decides stream status', async () => {
    const h = mk();
    timeoutAttempt(h);
    assert.equal(h.hostCalls.length, 1);
    assert.equal(h.hostCalls[0].baseUrl, CAM.baseUrl);
    assert.equal(snap(h).hostChecking, true);

    h.hostCalls[0].resolve({ reachable: true, latencyMs: 12 });
    await flush();
    assert.equal(snap(h).host.reachable, true);
    assert.equal(snap(h).hostChecking, false);
    assert.equal(status(h), 'reconnecting', 'host answering must not turn the status to Connected');
  });

  it('a host that does not answer does not override a stream that is delivering frames', async () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.conn.checkHost();
    h.hostCalls[0].resolve({ reachable: false, error: 'timeout' });
    await flush();
    assert.equal(snap(h).host.reachable, false);
    assert.equal(status(h), 'connected');
  });

  it('coalesces host checks: failures while a probe is running do not start another', () => {
    const h = mk();
    timeoutAttempt(h); // starts probe
    h.conn.checkHost();
    h.conn.checkHost();
    assert.equal(h.hostCalls.length, 1);
  });
});

describe('connection lost after it was working', () => {
  it('retries once quickly (1 s), then recovers', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.clock.advance(20_000);
    h.transport.last.error('connection reset');

    assert.equal(status(h), 'reconnecting');
    assert.equal(snap(h).recovery.reason, 'connection lost');
    assert.equal(snap(h).nextRetryAt, h.clock.now() + 1000);
    h.clock.advance(1000);
    assert.equal(h.transport.sessions.length, 2);
    h.transport.last.firstFrame();
    assert.equal(status(h), 'connected');
    assert.equal(snap(h).recovery.state, 'succeeded');
  });

  it('treats a clean end of the response as a loss too', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.transport.last.ended('the response ended.');
    assert.equal(status(h), 'reconnecting');
    assert.match(snap(h).lastError ?? '', /Camera closed the stream/);
  });

  it('a connection that flaps does not get the fast retry again until it has been stable', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.transport.last.error('drop 1'); // retry 1 -> 1 s
    h.clock.advance(1000);
    h.transport.last.firstFrame();
    h.clock.advance(2000); // up for only 2 s: not stable yet
    h.transport.last.error('drop 2');
    assert.equal(snap(h).attempt, 2, 'retry counter must not reset before stableAfterMs');
    assert.equal(snap(h).nextRetryAt, h.clock.now() + 5000, 'second retry waits the base delay');
  });

  it('resets the retry counter once the connection has been stable for 10 s', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.transport.last.error('drop');
    h.clock.advance(1000);
    h.transport.last.firstFrame();
    assert.equal(snap(h).attempt, 1);
    h.clock.advance(9999);
    assert.equal(snap(h).attempt, 1);
    h.clock.advance(1);
    assert.equal(snap(h).attempt, 0);

    h.transport.last.error('a later, unrelated drop');
    assert.equal(snap(h).nextRetryAt, h.clock.now() + 1000, 'a fresh recovery gets the quick first retry again');
  });
});

describe('camera restart', () => {
  it('keeps retrying with growing delays while the camera reboots, then recovers when it is back', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.clock.advance(60_000);

    const t0 = h.clock.now();
    h.transport.last.error('connection reset'); // camera lost power / rebooted
    // retry 1 at +1 s: camera still booting, connection refused immediately
    h.clock.advance(1000);
    h.transport.last.error('connection refused');
    assert.equal(snap(h).nextRetryAt, h.clock.now() + 5000);
    // retry 2 at +6 s: still refused
    h.clock.advance(5000);
    h.transport.last.error('connection refused');
    assert.equal(snap(h).nextRetryAt, h.clock.now() + 10_000);
    assert.equal(status(h), 'reconnecting');
    // retry 3 at +16 s: camera is back
    h.clock.advance(10_000);
    h.transport.last.firstFrame();

    assert.equal(status(h), 'connected');
    assert.equal(h.clock.now() - t0, 16_000);
    const r = snap(h).recovery;
    assert.equal(r.state, 'succeeded');
    assert.equal(r.attempts, 3);
    assert.equal(snap(h).totalReconnects, 3);
    assert.equal(snap(h).lastError, 'connection refused', 'the last error stays visible for diagnosis');
  });

  it('a camera that answers the connection but never sends a frame is retried, not reported Connected', () => {
    const h = mk();
    timeoutAttempt(h);
    h.clock.advance(5000);
    assert.equal(status(h), 'reconnecting');
    timeoutAttempt(h);
    assert.equal(status(h), 'reconnecting');
    assert.equal(snap(h).attempt, 2);
  });
});

describe('bounded retries', () => {
  it('uses exponential back-off capped at 60 s, then stops after 6 retries', () => {
    const h = mk();
    const expected = [5000, 10_000, 20_000, 40_000, 60_000, 60_000];
    for (const delay of expected) {
      timeoutAttempt(h);
      assert.equal(status(h), 'reconnecting');
      assert.equal(snap(h).nextRetryAt! - h.clock.now(), delay);
      h.clock.advance(delay);
    }
    assert.equal(h.transport.sessions.length, 7); // initial + 6 retries
    timeoutAttempt(h); // the 7th attempt fails: out of retries

    const s = snap(h);
    assert.equal(s.status, 'error');
    assert.equal(s.nextRetryAt, null);
    assert.equal(s.recovery.state, 'failed');
    assert.equal(s.active, false);
    assert.ok(s.events.some((e) => /Gave up after 6 automatic retries/.test(e.message)));

    const before = h.transport.sessions.length;
    h.clock.advance(60 * 60_000); // an hour later: still nothing, no runaway loop
    assert.equal(h.transport.sessions.length, before);
    assert.equal(h.clock.pendingTimers(), 0, 'no timers left running after giving up');
  });

  it('manual Reconnect still works after the automatic retries are exhausted', () => {
    const h = mk({ policy: { maxRetries: 1 } });
    timeoutAttempt(h);
    h.clock.advance(5000);
    timeoutAttempt(h);
    assert.equal(status(h), 'error');

    h.conn.reconnect();
    assert.equal(status(h), 'reconnecting');
    assert.equal(snap(h).attempt, 0, 'manual reconnect resets the retry budget');
    h.transport.last.firstFrame();
    assert.equal(status(h), 'connected');
    assert.equal(snap(h).recovery.state, 'succeeded');
  });

  it('with automatic reconnect off, a failure goes straight to Error and nothing is scheduled', () => {
    const h = mk({ target: { autoReconnect: false } });
    timeoutAttempt(h);
    const s = snap(h);
    assert.equal(s.status, 'error');
    assert.equal(s.nextRetryAt, null);
    assert.equal(h.clock.pendingTimers(), 0);
    assert.ok(s.events.some((e) => /Automatic reconnect is off/.test(e.message)));
    h.clock.advance(10 * 60_000);
    assert.equal(h.transport.sessions.length, 1);

    h.conn.reconnect(); // manual still works
    h.transport.last.firstFrame();
    assert.equal(status(h), 'connected');
  });

  it('honours the configured base delay', () => {
    const h = mk({ target: { baseDelayMs: 2000 } });
    timeoutAttempt(h);
    assert.equal(snap(h).nextRetryAt! - h.clock.now(), 2000);
  });
});

describe('manual reconnect and duplicate prevention', () => {
  it('closes the old connection before opening exactly one new one', () => {
    const h = mk();
    const first = h.transport.last;
    first.firstFrame();
    h.conn.reconnect();
    assert.equal(first.closed, true);
    assert.equal(h.transport.sessions.length, 2);
    assert.equal(h.transport.openSessions().length, 1);
    assert.equal(h.transport.last.url, `${STREAM}?_rc=2`, 'a reconnect must not reuse the old URL');
    assert.equal(status(h), 'reconnecting');
  });

  it('collapses rapid repeated clicks into a single attempt', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.conn.reconnect();
    h.conn.reconnect();
    h.conn.reconnect();
    assert.equal(h.transport.sessions.length, 2);
    assert.equal(snap(h).totalReconnects, 1);
    assert.equal(h.hostCalls.length, 1, 'and one host check, not three');

    h.clock.advance(1000); // debounce window over: a deliberate second click is honoured
    h.conn.reconnect();
    assert.equal(h.transport.sessions.length, 3);
  });

  it('cancels a pending automatic retry so the two cannot both open a stream', () => {
    const h = mk();
    timeoutAttempt(h);
    h.clock.advance(2000);
    h.conn.reconnect();
    assert.equal(h.transport.sessions.length, 2);
    h.transport.last.firstFrame();
    h.clock.advance(60_000);
    assert.equal(h.transport.sessions.length, 2, 'the old retry timer must not fire afterwards');
  });

  it('a manual reconnect that fails again is not cut short by the retry timer it replaced', () => {
    const h = mk();
    timeoutAttempt(h); // automatic retry scheduled for +5 s
    h.clock.advance(2000);
    h.conn.reconnect();
    const manual = h.transport.last;
    manual.error('refused'); // fails at once -> a new wait of 5 s starts now
    assert.equal(h.transport.sessions.length, 2);

    h.clock.advance(3000); // the replaced timer would have fired here
    assert.equal(h.transport.sessions.length, 2, 'the old retry timer must not start an early attempt');
    h.clock.advance(2000); // the new wait is over
    assert.equal(h.transport.sessions.length, 3);
    assert.equal(h.clock.pendingTimers(), 1, 'one connect timer, no stray retry timers');
  });

  it('only checks the camera host when the Live Feed is not open', () => {
    const h = mk();
    h.conn.setViewing(false);
    const sessionsBefore = h.transport.sessions.length;
    h.conn.reconnect();
    assert.equal(h.transport.sessions.length, sessionsBefore);
    assert.equal(h.hostCalls.length, 1);
  });

  it('is a no-op when no camera is configured', () => {
    const h = mk({ target: { baseUrl: '', baseConfigured: false, url: '' } });
    h.conn.reconnect();
    assert.equal(h.transport.sessions.length, 0);
    assert.equal(h.hostCalls.length, 0);
    assert.equal(status(h), 'unconfigured');
  });
});

describe('stale events and stale results', () => {
  it('ignores every late event from a superseded attempt', () => {
    const h = mk();
    const s1 = h.transport.last;
    s1.firstFrame();
    h.conn.reconnect();
    const s2 = h.transport.last;

    s1.firstFrame();
    s1.frame();
    s1.error('late error from the old connection');
    s1.ended('late end');
    assert.equal(status(h), 'reconnecting', 'old events must not change the state of the new attempt');
    assert.equal(snap(h).lastError, null);
    assert.equal(snap(h).connectedSince, null);

    s2.firstFrame();
    assert.equal(status(h), 'connected');
  });

  it('a first frame arriving from an attempt that already timed out does not mark the stream Connected', () => {
    const h = mk();
    const s1 = h.transport.last;
    timeoutAttempt(h);
    s1.firstFrame(); // the browser finally got a frame for the abandoned request
    assert.equal(status(h), 'reconnecting');
    assert.equal(snap(h).connectedSince, null);
  });

  it('ignores a host probe result that belongs to a camera address that has since changed', async () => {
    const h = mk();
    timeoutAttempt(h);
    const staleProbe = h.hostCalls[0];

    h.conn.configure({ baseUrl: 'http://10.0.0.99', url: 'http://10.0.0.99:81/stream' });
    assert.equal(staleProbe.signal.aborted, true, 'the old probe is cancelled');
    staleProbe.resolve({ reachable: true, latencyMs: 5 }); // resolves anyway, too late
    await flush();

    assert.equal(snap(h).host.reachable, null, 'the old address result must not be attributed to the new one');
    assert.equal(snap(h).hostChecking, false);
  });

  it('a host probe that finishes after shutdown changes nothing and notifies nobody', async () => {
    const h = mk();
    timeoutAttempt(h);
    h.conn.shutdown();
    const count = h.notifications;
    h.hostCalls[0].resolve({ reachable: true });
    await flush();
    assert.equal(h.notifications, count);
    assert.equal(snap(h).host.reachable, null);
  });

  it('a rejected host probe is recorded as unreachable without throwing', async () => {
    const h = mk();
    h.conn.checkHost();
    h.hostCalls[0].reject(new Error('boom'));
    await flush();
    assert.equal(snap(h).host.reachable, false);
    assert.match(snap(h).host.error ?? '', /boom/);
  });
});

describe('monitor mode (frame-level evidence)', () => {
  const monitor = { mode: 'monitor' as const };

  it('requests the monitor transport and reports frame-level evidence and statistics', () => {
    const h = mk({ target: monitor });
    assert.deepEqual(h.modesRequested, ['monitor']);
    h.transport.last.firstFrame();
    for (let i = 0; i < 40; i++) {
      h.clock.advance(100);
      h.transport.last.frame();
    }
    h.clock.advance(1000); // statistics are published on the 1 s tick
    const s = snap(h);
    assert.equal(s.evidence, 'frames');
    assert.ok(s.frameStats);
    assert.equal(s.frameStats!.framesTotal, 41);
    assert.equal(s.frameStats!.fps5s, 8.2); // 41 frames inside the 5 s window / 5 s
    assert.equal(s.frameStats!.longestGapMs5min, 1000, 'only the still-open 1 s since the last frame; 100 ms spacing is not a gap');
  });

  it('detects a stall while the connection stays open, reconnects, and measures the freeze', () => {
    const h = mk({ target: monitor });
    const stalled = h.transport.last;
    stalled.firstFrame();
    for (let i = 0; i < 20; i++) {
      h.clock.advance(100);
      stalled.frame();
    }
    const lastFrameAt = h.clock.now();

    // The socket stays open but no more frames arrive. Ticks run every 1 s.
    h.clock.advance(5000);
    assert.equal(status(h), 'connected', 'a gap of exactly 5 s is still within tolerance');
    h.clock.advance(1000);
    assert.equal(status(h), 'reconnecting');
    assert.match(snap(h).lastError ?? '', /Stalled: no frame for 6\.\d+s/);
    assert.equal(stalled.closed, true, 'the stalled connection must be closed, not left open');
    assert.equal(snap(h).recovery.reason, 'connection lost');

    h.clock.advance(1000); // quick first retry
    assert.equal(h.transport.sessions.length, 2);
    h.transport.last.firstFrame();
    assert.equal(status(h), 'connected');
    assert.equal(snap(h).recovery.state, 'succeeded');
    assert.equal(
      snap(h).frameStats!.longestGapMs5min,
      h.clock.now() - lastFrameAt,
      'the freeze is measured as the viewer saw it, across the reconnect',
    );
  });

  it('keeps a healthy stream open indefinitely', () => {
    const h = mk({ target: monitor });
    h.transport.last.firstFrame();
    for (let i = 0; i < 600; i++) {
      h.clock.advance(100);
      h.transport.last.frame();
    }
    assert.equal(status(h), 'connected');
    assert.equal(h.transport.sessions.length, 1);
  });

  it('ignores frames from a closed session', () => {
    const h = mk({ target: monitor });
    const s1 = h.transport.last;
    s1.firstFrame();
    h.conn.reconnect();
    s1.frame();
    s1.frame();
    h.transport.last.firstFrame(); // publishes a snapshot
    assert.equal(snap(h).frameStats!.framesTotal, 2, 'one frame from each connection; the two late frames are not counted');
  });
});

describe('plain <img> display watchdog', () => {
  it('treats an undecodable image that persists as a lost stream', () => {
    const h = mk();
    const s = h.transport.last;
    s.firstFrame();
    s.pollResult = 'broken';
    h.clock.advance(2000); // tick 1 starts the grace period, tick 2 sees 1 s of breakage
    assert.equal(status(h), 'connected');
    h.clock.advance(1000); // tick 3: 2 s of continuous breakage
    assert.equal(status(h), 'reconnecting');
    assert.match(snap(h).lastError ?? '', /no longer holds a decodable image/);
  });

  it('does not react to a single bad moment', () => {
    const h = mk();
    const s = h.transport.last;
    s.firstFrame();
    s.pollResult = 'broken';
    h.clock.advance(1000);
    s.pollResult = 'ok';
    h.clock.advance(10_000);
    assert.equal(status(h), 'connected');
    s.pollResult = 'broken';
    h.clock.advance(1000);
    s.pollResult = 'ok';
    h.clock.advance(5000);
    assert.equal(status(h), 'connected');
  });
});

describe('transport failures while opening', () => {
  it('handles a transport that fails synchronously inside open()', () => {
    const h = mk({ start: false });
    h.transport.duringOpen = (session) => session.error('refused instantly');
    h.conn.configure(CAM);
    h.conn.setElementAvailable(true);
    h.conn.setViewing(true);

    assert.equal(status(h), 'reconnecting');
    assert.equal(h.transport.sessions.length, 1);
    assert.equal(h.transport.sessions[0].closed, true, 'a session whose attempt already failed must be closed');
    assert.equal(h.clock.pendingTimers(), 1, 'exactly one retry timer, no connect timer for the dead attempt');

    h.transport.duringOpen = null;
    h.clock.advance(5000);
    h.transport.last.firstFrame();
    assert.equal(status(h), 'connected');
  });

  it('handles open() throwing', () => {
    const h = mk({ start: false });
    h.transport.throwOnOpen = new Error('no element');
    h.conn.configure(CAM);
    h.conn.setElementAvailable(true);
    h.conn.setViewing(true);
    assert.equal(status(h), 'reconnecting');
    assert.match(snap(h).lastError ?? '', /Could not open the stream: no element/);
  });

  it('waits for a video element before opening anything', () => {
    const h = mk({ start: false });
    h.conn.configure(CAM);
    h.conn.setViewing(true);
    assert.equal(h.transport.sessions.length, 0);
    assert.equal(status(h), 'disconnected');
    h.conn.setElementAvailable(true);
    assert.equal(h.transport.sessions.length, 1);
  });
});

describe('Live Feed visibility', () => {
  it('closes the connection when the feed is hidden and opens one fresh connection when it returns', () => {
    const h = mk();
    const s1 = h.transport.last;
    s1.firstFrame();

    h.conn.setViewing(false);
    assert.equal(s1.closed, true);
    assert.equal(status(h), 'disconnected');
    assert.equal(snap(h).active, false);
    assert.equal(h.clock.pendingTimers(), 0);

    h.conn.setViewing(true);
    assert.equal(h.transport.sessions.length, 2);
    assert.equal(h.transport.last.url, `${STREAM}?_rc=2`);
    assert.equal(status(h), 'connecting');
  });

  it('cancels a scheduled retry when the feed is hidden', () => {
    const h = mk();
    timeoutAttempt(h);
    h.conn.setViewing(false);
    h.clock.advance(120_000);
    assert.equal(h.transport.sessions.length, 1);
    assert.equal(h.clock.pendingTimers(), 0);
  });

  it('closes the connection when the video element goes away', () => {
    const h = mk();
    const s1 = h.transport.last;
    h.conn.setElementAvailable(false);
    assert.equal(s1.closed, true);
    assert.equal(h.transport.openSessions().length, 0);
  });
});

describe('configuration changes', () => {
  it('switches to the new address: old connection closed, one new connection, diagnostics cleared', () => {
    const h = mk();
    timeoutAttempt(h);
    const old = h.transport.last;
    assert.ok(snap(h).lastError);

    h.conn.configure({ baseUrl: 'http://10.0.0.77', url: 'http://10.0.0.77:81/stream' });
    assert.equal(old.closed, true);
    assert.equal(h.transport.openSessions().length, 1);
    assert.ok(h.transport.last.url.startsWith('http://10.0.0.77:81/stream'));
    assert.equal(snap(h).lastError, null);
    assert.equal(snap(h).recovery.state, 'none');
    assert.equal(snap(h).attempt, 0);
    assert.equal(h.clock.pendingTimers(), 1, 'only the new attempt\'s connect timer remains');
  });

  it('applying an identical configuration does not restart the stream', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.conn.configure({ ...CAM });
    h.conn.configure({ ...CAM, autoReconnect: true });
    assert.equal(h.transport.sessions.length, 1);
    assert.equal(status(h), 'connected');
  });

  it('changing the retry settings does not restart a working stream', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.conn.configure({ autoReconnect: false, baseDelayMs: 1000 });
    assert.equal(h.transport.sessions.length, 1);
    assert.equal(status(h), 'connected');
  });

  it('switching Frame monitor on swaps the transport once', () => {
    const h = mk();
    const s1 = h.transport.last;
    h.conn.configure({ mode: 'monitor' });
    assert.equal(s1.closed, true);
    assert.deepEqual(h.modesRequested, ['img', 'monitor']);
    assert.equal(h.transport.openSessions().length, 1);
    assert.equal(snap(h).evidence, 'frames');
  });

  it('turning snapshot capture (CORS) on reconnects once; repeating or an unset value does not', () => {
    const h = mk();
    const s1 = h.transport.last;
    s1.firstFrame();
    h.conn.configure({ corsCapture: false }); // unset -> false is not a change
    assert.equal(h.transport.sessions.length, 1);

    h.conn.configure({ corsCapture: true });
    assert.equal(s1.closed, true, 'an <img> only honours crossorigin when it is set before src, so the stream restarts');
    assert.equal(h.transport.sessions.length, 2);
    assert.equal(h.transport.openSessions().length, 1);

    h.conn.configure({ corsCapture: true });
    assert.equal(h.transport.sessions.length, 2);
  });

  it('does not open a stream when the browser blocks it as mixed content', () => {
    const h = mk({ target: { mixedContent: true } });
    assert.equal(h.transport.sessions.length, 0);
    assert.equal(h.modesRequested.length, 0);
    assert.equal(status(h), 'disconnected');
    assert.match(snap(h).lastError ?? '', /mixed content/i);
    assert.match(snap(h).blockedReason ?? '', /mixed content/i);
  });

  it('clearing the stream path stops the stream and falls back to a host check only', async () => {
    const h = mk();
    const s1 = h.transport.last;
    s1.firstFrame();
    h.conn.configure({ url: '' });
    assert.equal(s1.closed, true);
    assert.notEqual(status(h), 'connected');
    h.conn.checkHost();
    assert.equal(status(h), 'connecting');
    h.hostCalls[h.hostCalls.length - 1].resolve({ reachable: true });
    await flush();
    assert.equal(status(h), 'host_reachable', 'a responding host without a stream path is not "Connected"');
  });
});

describe('no stream path / not configured', () => {
  it('reports Unconfigured without a camera address', () => {
    const h = mk({ target: { baseUrl: '', baseConfigured: false, url: '' } });
    assert.equal(status(h), 'unconfigured');
    assert.equal(h.transport.sessions.length, 0);
  });

  it('host unreachable without a stream path is an Error', async () => {
    const h = mk({ target: { url: '' } });
    h.conn.checkHost();
    h.hostCalls[0].resolve({ reachable: false, error: 'timed out' });
    await flush();
    assert.equal(status(h), 'error');
    assert.equal(snap(h).lastError, 'timed out');
    assert.equal(h.transport.sessions.length, 0);
  });
});

describe('shutdown and cleanup', () => {
  it('closes the connection, clears every timer and aborts the host probe', () => {
    const h = mk();
    timeoutAttempt(h); // retry timer pending, host probe in flight
    h.clock.advance(5000); // retry opens a new connection (connect timer pending)
    const open = h.transport.last;
    assert.equal(open.closed, false);

    h.conn.shutdown();
    assert.equal(open.closed, true);
    assert.equal(h.clock.pendingTimers(), 0);
    assert.equal(h.hostCalls[0].signal.aborted, true);
    assert.equal(status(h), 'disconnected');
  });

  it('closes a healthy connection and its watchdog timers too', () => {
    const h = mk({ target: { mode: 'monitor' } });
    h.transport.last.firstFrame();
    assert.ok(h.clock.pendingTimers() > 0);
    h.conn.shutdown();
    assert.equal(h.clock.pendingTimers(), 0);
    assert.equal(h.transport.openSessions().length, 0);
  });

  it('late events after shutdown do nothing', () => {
    const h = mk();
    const s = h.transport.last;
    h.conn.shutdown();
    const count = h.notifications;
    s.firstFrame();
    s.error('late');
    h.clock.advance(120_000);
    assert.equal(h.notifications, count);
    assert.equal(status(h), 'disconnected');
    assert.equal(h.transport.sessions.length, 1);
  });

  it('is safe to call repeatedly and allows a clean restart (React StrictMode mount/unmount/mount)', () => {
    const h = mk();
    h.conn.shutdown();
    h.conn.shutdown();
    h.conn.setElementAvailable(true);
    h.conn.setViewing(true);
    assert.equal(h.transport.openSessions().length, 1);
    assert.equal(status(h), 'connecting');
  });

  it('closing a session twice (idempotent close) does not break bookkeeping', () => {
    const h = mk();
    const s = h.transport.last;
    h.conn.reconnect();
    s.close();
    s.close();
    assert.equal(h.transport.openSessions().length, 1);
  });
});

describe('subscription contract (useSyncExternalStore)', () => {
  it('returns the same snapshot object until something changes', () => {
    const h = mk();
    const a = h.conn.getSnapshot();
    const b = h.conn.getSnapshot();
    assert.equal(a, b);
    h.transport.last.firstFrame();
    assert.notEqual(h.conn.getSnapshot(), a);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const h = mk({ start: false });
    let calls = 0;
    const unsubscribe = h.conn.subscribe(() => {
      calls++;
    });
    h.conn.configure(CAM);
    assert.ok(calls > 0);
    const before = calls;
    unsubscribe();
    h.conn.setElementAvailable(true);
    h.conn.setViewing(true);
    assert.equal(calls, before);
  });

  it('keeps a bounded event log', () => {
    const h = mk({ policy: { maxRetries: 1_000_000, maxDelayMs: 250 }, target: { baseDelayMs: 250 } });
    for (let i = 0; i < 200; i++) {
      h.transport.last.error(`failure ${i}`);
      h.clock.advance(250);
    }
    assert.ok(snap(h).events.length <= 100);
  });
});

/**
 * Phase 2 behaviour of StreamConnection: the typed connection history, camera-reachability
 * measurements, the opt-in periodic measurement, and the rules that stop them misleading anyone.
 *
 * MOCKED: fake clock, fake transport, fake host probe, fake localStorage. These tests prove the
 * bookkeeping logic. They say nothing about a physical ESP32-CAM or real Wi-Fi.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CAM, CONNECT_TIMEOUT_MS, FakeStore, Harness, MakeOptions, flush, make } from './helpers';
import { CONNECTION_HISTORY_KEY } from '../src/services/connectionHistory';
import { StreamConnection } from '../src/services/streamConnectionService';
import type { ConnectionEvent, ConnectionEventType, StreamFailureKind } from '../src/types/camera';

const harnesses: Harness[] = [];
function mk(options?: MakeOptions): Harness {
  const h = make(options);
  harnesses.push(h);
  return h;
}
afterEach(() => {
  for (const h of harnesses) assert.ok(h.transport.maxConcurrent <= 1, 'two streams were open at once');
  harnesses.length = 0;
});

const snap = (h: Harness) => h.conn.getSnapshot();
const status = (h: Harness) => snap(h).status;
const history = (h: Harness): ConnectionEvent[] => snap(h).history;
const types = (h: Harness): ConnectionEventType[] => history(h).map((e) => e.type);
const ofType = (h: Harness, type: ConnectionEventType) => history(h).filter((e) => e.type === type);
const timeoutAttempt = (h: Harness) => h.clock.advance(CONNECT_TIMEOUT_MS);

/** Answer the oldest unanswered reachability request. */
async function answer(h: Harness, result: Parameters<Harness['hostCalls'][number]['resolve']>[0]): Promise<void> {
  const call = h.hostCalls.find((c) => !(c as { done?: boolean }).done);
  assert.ok(call, 'no reachability request is waiting');
  (call as { done?: boolean }).done = true;
  call.resolve(result);
  await flush();
}
const pending = (h: Harness) => h.hostCalls.filter((c) => !(c as { done?: boolean }).done).length;

describe('connection event recording', () => {
  it('records connecting and the confirmed first frame', () => {
    const h = mk();
    h.clock.advance(1500);
    h.transport.last.firstFrame();
    assert.deepEqual(types(h), ['session_started', 'stream_connecting', 'stream_first_frame']);
    assert.deepEqual(history(h).map((e) => e.severity), ['info', 'info', 'ok']);
    assert.match(history(h)[2].message, /First frame confirmed 1\.5s/);
  });

  it('records a lost stream, the reconnect attempt and the recovery in order', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.clock.advance(3000);
    h.transport.last.error('connection reset');
    h.clock.advance(1000); // a working stream that dropped is retried within 1 s
    h.transport.last.firstFrame();
    assert.deepEqual(types(h).slice(2), ['stream_first_frame', 'stream_disconnected', 'reconnect_started', 'reconnect_succeeded']);
    const lost = ofType(h, 'stream_disconnected')[0];
    assert.equal(lost.severity, 'error');
    assert.equal(lost.message, 'connection reset', 'the label already says "Stream lost"; the message is only the cause');
    assert.match(ofType(h, 'reconnect_started')[0].message, /attempt 1 of 6/);
    assert.equal(ofType(h, 'reconnect_succeeded')[0].severity, 'ok');
    assert.match(ofType(h, 'reconnect_succeeded')[0].message, /recovered after 1\.0s \(1 automatic retry\)/i);
  });

  it('records a measurable stall as a stall, not as a generic disconnect', () => {
    const h = mk({ target: { mode: 'monitor' } });
    h.transport.last.firstFrame();
    for (let i = 0; i < 10; i++) {
      h.clock.advance(100);
      h.transport.last.frame();
    }
    h.clock.advance(7000); // no more frames while the connection stays open
    assert.equal(ofType(h, 'stream_stalled').length, 1);
    assert.equal(ofType(h, 'stream_disconnected').length, 0);
    assert.equal(ofType(h, 'stream_stalled')[0].severity, 'warn');
    assert.match(ofType(h, 'stream_stalled')[0].message, /^No frame for \d+\.\ds while the connection stayed open\. Reconnecting\.$/);
  });

  it('never records a stall in plain video mode, where one cannot be observed', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.clock.advance(60_000); // frames could have stopped; the page cannot know
    assert.equal(ofType(h, 'stream_stalled').length, 0);
    assert.equal(status(h), 'connected');
  });

  it('records a failure to connect at all as such', () => {
    const h = mk();
    timeoutAttempt(h);
    assert.equal(ofType(h, 'stream_connect_failed').length, 1);
    assert.match(ofType(h, 'stream_connect_failed')[0].message, /^No frame received within 8s/);
  });

  it('records a camera that closes the stream and a blank display', () => {
    const a = mk();
    a.transport.last.firstFrame();
    a.transport.last.ended('the response ended.');
    assert.match(ofType(a, 'stream_disconnected')[0].message, /Camera closed the stream/);

    const b = mk();
    b.transport.last.firstFrame();
    b.transport.last.pollResult = 'broken';
    b.clock.advance(4000);
    assert.match(ofType(b, 'stream_disconnected')[0].message, /no longer holds a decodable image/);
  });

  it('records the changed settings once, but not the first configuration', () => {
    const h = mk();
    assert.equal(ofType(h, 'config_changed').length, 0);
    h.conn.configure({ url: 'http://10.0.0.5:81/other' });
    assert.equal(ofType(h, 'config_changed').length, 1);
    h.conn.configure({ url: 'http://10.0.0.5:81/other' }); // nothing changed
    assert.equal(ofType(h, 'config_changed').length, 1);
  });

  it('keeps the Phase 1 verbose stream log working and unchanged in wording', () => {
    const h = mk();
    h.transport.last.firstFrame();
    assert.ok(snap(h).events.some((e) => e.message === 'Stream connected (first frame received).'));
    assert.ok(snap(h).events.some((e) => e.message === 'Connecting to the stream...'));
  });

  it('keeps credentials and tokens out of stored messages', () => {
    const h = mk();
    h.transport.last.error('request to http://admin:hunter2@10.0.0.5:81/stream?token=abc failed');
    const all = JSON.stringify(history(h));
    assert.ok(!all.includes('hunter2'));
    assert.ok(!all.includes('token=abc'));
  });
});

describe('duplicate prevention during one continuous failure', () => {
  it('folds identical failed reconnect attempts into one entry with a count', () => {
    const h = mk();
    timeoutAttempt(h); // initial attempt fails
    h.clock.advance(5000); // retry 1 starts
    timeoutAttempt(h);
    h.clock.advance(10_000); // retry 2 starts
    timeoutAttempt(h);
    assert.equal(ofType(h, 'stream_connect_failed').length, 1);
    const failed = ofType(h, 'reconnect_failed');
    assert.equal(failed.length, 1, 'the same cause must not be listed again and again');
    assert.equal(failed[0].count, 2);
    assert.ok(failed[0].lastT > failed[0].t);
    assert.equal(ofType(h, 'reconnect_started').length, 2, 'each attempt is still its own, distinct entry');
    assert.ok(history(h).length < 10);
  });

  it('keeps different causes as separate entries', () => {
    const h = mk();
    h.transport.last.error('refused'); // 1st failure
    h.clock.advance(5000);
    timeoutAttempt(h); // different cause
    h.clock.advance(10_000);
    h.transport.last.error('refused'); // back to the first cause, now as a reconnect failure
    const msgs = history(h).filter((e) => e.type === 'stream_connect_failed' || e.type === 'reconnect_failed').map((e) => e.message);
    assert.equal(msgs.length, 3);
    assert.ok(msgs[0].includes('refused') && msgs[1].includes('No frame received') && msgs[2].includes('refused'));
  });

  it('records "gave up" once, even when manual reconnects fail again in the same failure', () => {
    const h = mk({ policy: { maxRetries: 1 } });
    timeoutAttempt(h);
    h.clock.advance(5000);
    timeoutAttempt(h); // out of retries
    assert.equal(ofType(h, 'reconnect_stopped').length, 1);
    assert.match(ofType(h, 'reconnect_stopped')[0].message, /Gave up after 1 automatic retries/);
    h.conn.reconnect(); // the manual attempt gets a fresh retry budget
    assert.match(ofType(h, 'reconnect_started').at(-1)!.message, /Manual reconnect started/);
    timeoutAttempt(h);
    h.clock.advance(5000);
    timeoutAttempt(h); // out of retries again
    const stopped = ofType(h, 'reconnect_stopped');
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0].count, 2);
    assert.equal(ofType(h, 'stream_connect_failed').length, 1);
  });

  it('says so when automatic reconnect is off', () => {
    const h = mk({ target: { autoReconnect: false } });
    timeoutAttempt(h);
    assert.deepEqual(types(h).slice(2), ['stream_connect_failed', 'reconnect_stopped']);
    assert.match(ofType(h, 'reconnect_stopped')[0].message, /Automatic reconnect is off/);
  });

  it('starts new entries after the stream recovered, so flapping stays visible', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.transport.last.error('reset');
    h.clock.advance(1000);
    h.transport.last.firstFrame(); // recovered
    h.transport.last.error('reset'); // fails again, same cause
    const lost = ofType(h, 'stream_disconnected');
    assert.equal(lost.length, 2);
    assert.deepEqual(lost.map((e) => e.count), [1, 1]);
  });

  it('does not treat a feed that was closed on purpose as the same continuous failure', () => {
    const h = mk();
    timeoutAttempt(h);
    h.conn.setViewing(false);
    h.conn.setViewing(true);
    timeoutAttempt(h);
    assert.equal(ofType(h, 'stream_connect_failed').length, 2);
  });
});

describe('camera reachability events', () => {
  async function failing(): Promise<Harness> {
    const h = mk();
    timeoutAttempt(h); // the failure starts a reachability request
    assert.equal(pending(h), 1);
    return h;
  }

  it('records "unreachable" once however many checks fail during one continuous failure', async () => {
    const h = await failing();
    for (let i = 0; i < 5; i++) {
      await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500, error: 'timed out' });
      if (i < 4) h.conn.checkHost();
    }
    assert.equal(snap(h).hostSamples.length, 5, 'every measurement is kept');
    assert.equal(ofType(h, 'host_unreachable').length, 1, 'but the news is reported once');
    assert.match(ofType(h, 'host_unreachable')[0].message, /no answer within 2\.5s/);
  });

  it('records "reachable again" only after it was unreachable, and a later drop again', async () => {
    const h = await failing();
    await answer(h, { reachable: false, failure: 'network', latencyMs: 12, error: 'Failed to fetch' });
    h.conn.checkHost();
    await answer(h, { reachable: true, latencyMs: 80 });
    h.conn.checkHost();
    await answer(h, { reachable: true, latencyMs: 75 });
    assert.equal(ofType(h, 'host_reachable').length, 1);
    assert.match(ofType(h, 'host_reachable')[0].message, /answers again \(request took 80 ms\)/);
    h.conn.checkHost();
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    assert.equal(ofType(h, 'host_unreachable').length, 2);
  });

  it('records no reachability event for a host that simply answers', async () => {
    const h = mk();
    h.transport.last.firstFrame();
    assert.ok(h.conn.measureHost());
    await answer(h, { reachable: true, latencyMs: 30 });
    assert.equal(ofType(h, 'host_reachable').length, 0);
    assert.equal(ofType(h, 'host_unreachable').length, 0);
    assert.equal(snap(h).hostSamples.length, 1);
  });

  it('says "cause could not be determined" once when the host answers but the stream keeps failing', async () => {
    const h = await failing();
    await answer(h, { reachable: true, latencyMs: 90 });
    h.conn.checkHost();
    await answer(h, { reachable: true, latencyMs: 95 });
    const unknown = ofType(h, 'diagnosis_inconclusive');
    assert.equal(unknown.length, 1);
    assert.match(unknown[0].message, /cannot tell why/);
    assert.equal(unknown[0].severity, 'warn');
  });

  it('a failed check never changes the status of a stream that is connected, and the event says so', async () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.conn.measureHost();
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    assert.equal(status(h), 'connected');
    assert.equal(snap(h).host.reachable, false);
    assert.match(ofType(h, 'host_unreachable')[0].message, /still reported connected.*does not mean the stream failed/);
    assert.equal(ofType(h, 'stream_disconnected').length, 0);
  });

  it('ignores a late "no answer" that was overtaken by a recovered stream', async () => {
    const h = await failing(); // request A is in flight
    h.clock.advance(5000); // retry
    h.transport.last.firstFrame(); // the stream is back: the camera was alive
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    assert.equal(ofType(h, 'host_unreachable').length, 0, 'would be a misleading event');
    assert.equal(snap(h).hostSamples[0].superseded, true);
    assert.equal(status(h), 'connected');
    // ...and it does not poison the next genuine outage
    h.transport.last.error('reset');
    await flush();
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    assert.equal(ofType(h, 'host_unreachable').length, 1);
  });

  it('does not claim the cause is unknown when the stream has already recovered', async () => {
    const h = await failing();
    h.clock.advance(5000);
    h.transport.last.firstFrame();
    await answer(h, { reachable: true, latencyMs: 60 });
    assert.equal(ofType(h, 'diagnosis_inconclusive').length, 0);
  });

  it('reports a new outage after an earlier one that ended with a working stream', async () => {
    const h = await failing();
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    h.clock.advance(5000);
    h.transport.last.firstFrame(); // the camera is back
    h.transport.last.error('reset');
    await flush();
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    assert.equal(ofType(h, 'host_unreachable').length, 2);
  });

  it('discards a result that belongs to the previous camera address', async () => {
    const h = await failing();
    const old = h.hostCalls[0];
    h.conn.configure({ baseUrl: 'http://10.0.0.9', url: 'http://10.0.0.9:81/stream' });
    assert.equal(old.signal.aborted, true, 'the old request is cancelled');
    old.resolve({ reachable: false, failure: 'timeout', latencyMs: 2500 });
    await flush();
    assert.equal(snap(h).hostSamples.length, 0);
    assert.equal(snap(h).host.reachable, null);
    assert.equal(ofType(h, 'host_unreachable').length, 0);
  });

  it('discards a result that arrives after shutdown', async () => {
    const h = await failing();
    const call = h.hostCalls[0];
    h.conn.shutdown();
    assert.equal(call.signal.aborted, true);
    call.resolve({ reachable: false, failure: 'timeout' });
    await flush();
    assert.equal(snap(h).hostSamples.length, 0);
    assert.equal(ofType(h, 'host_unreachable').length, 0);
  });
});

describe('response-time measurements', () => {
  it('records a successful measurement with its trigger and passes the time limit to the probe', async () => {
    const h = mk();
    h.conn.checkHost();
    assert.equal(h.hostCalls[0].timeoutMs, 2500);
    await answer(h, { reachable: true, latencyMs: 42 });
    assert.deepEqual(
      { ok: snap(h).hostSamples[0].ok, ms: snap(h).hostSamples[0].elapsedMs, trigger: snap(h).hostSamples[0].trigger },
      { ok: true, ms: 42, trigger: 'manual' },
    );
    assert.equal(snap(h).host.latencyMs, 42);
    assert.equal(snap(h).hostProbeTimeoutMs, 2500);
  });

  it('uses the configured time limit', async () => {
    const h = mk({ policy: { hostProbeTimeoutMs: 1000 } });
    h.conn.checkHost();
    assert.equal(h.hostCalls[0].timeoutMs, 1000);
    assert.equal(snap(h).hostProbeTimeoutMs, 1000);
  });

  it('keeps timeouts and network errors apart', async () => {
    const h = mk();
    h.conn.checkHost();
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500, error: 'timed out' });
    h.conn.checkHost();
    await answer(h, { reachable: false, failure: 'network', latencyMs: 4, error: 'Failed to fetch' });
    const [a, b] = snap(h).hostSamples;
    assert.equal(a.failure, 'timeout');
    assert.equal(b.failure, 'network');
    assert.equal(b.elapsedMs, 4);
    assert.equal(snap(h).host.failure, 'network');
  });

  it('records a probe that throws as a failed measurement', async () => {
    const h = mk();
    h.conn.checkHost();
    h.hostCalls[0].reject(new Error('boom'));
    await flush();
    assert.equal(snap(h).hostSamples[0].ok, false);
    assert.equal(snap(h).hostSamples[0].failure, 'network');
    assert.match(snap(h).host.error ?? '', /boom/);
  });

  it('does not count a cancelled request as a measurement or an event', async () => {
    const h = mk();
    h.conn.checkHost();
    await answer(h, { reachable: false, failure: 'cancelled', latencyMs: 3, error: 'Probe cancelled.' });
    assert.equal(snap(h).hostSamples.length, 0);
    assert.equal(snap(h).hostChecking, false);
    assert.equal(ofType(h, 'host_unreachable').length, 0);
    assert.equal(snap(h).host.reachable, null);
  });

  it('ignores a request that FAILS after the camera settings changed (stale rejection)', async () => {
    const h = mk();
    h.conn.measureHost();
    const old = h.hostCalls[0];
    h.conn.configure({ baseUrl: 'http://10.0.0.9', url: 'http://10.0.0.9:81/stream' });
    old.reject(new Error('Failed to fetch'));
    await flush();
    const s = snap(h);
    assert.equal(s.hostSamples.length, 0, 'a result for the old camera is not a measurement of the new one');
    assert.equal(s.host.reachable, null);
    assert.equal(ofType(h, 'host_unreachable').length, 0);
  });

  it('ignores a request that ANSWERS after the camera settings changed (stale result)', async () => {
    const h = mk();
    h.conn.measureHost();
    const old = h.hostCalls[0];
    h.conn.configure({ baseUrl: 'http://10.0.0.9', url: 'http://10.0.0.9:81/stream' });
    old.resolve({ reachable: true, latencyMs: 5 });
    await flush();
    assert.equal(snap(h).hostSamples.length, 0);
    assert.equal(snap(h).host.reachable, null);
  });

  it('never runs two requests at once', async () => {
    const h = mk();
    assert.equal(h.conn.measureHost(), true);
    assert.equal(h.conn.measureHost(), false);
    h.conn.checkHost();
    h.conn.reconnect(); // also asks for a host check
    assert.equal(h.hostCalls.length, 1);
    assert.equal(snap(h).hostChecking, true);
    await answer(h, { reachable: true, latencyMs: 10 });
    assert.equal(h.conn.measureHost(), true, 'free again once the first one finished');
    assert.equal(h.hostCalls.length, 2);
  });

  it('keeps a bounded list of the newest 30 measurements', async () => {
    const h = mk();
    for (let i = 1; i <= 40; i++) {
      h.conn.measureHost();
      await answer(h, { reachable: true, latencyMs: i });
      h.clock.advance(100);
    }
    const s = snap(h).hostSamples;
    assert.equal(s.length, 30);
    assert.equal(s[0].elapsedMs, 11);
    assert.equal(s[29].elapsedMs, 40);
  });

  it('cannot measure without a probe or without a camera address', () => {
    const noProbe = mk({ withHostProbe: false });
    assert.equal(noProbe.conn.measureHost(), false);
    const noBase = mk({ start: false });
    noBase.conn.configure({ ...CAM, baseUrl: '', baseConfigured: false, url: '' });
    assert.equal(noBase.conn.measureHost(), false);
  });

  it('does not probe when the browser would block the request (mixed content) and says why', () => {
    const h = mk({ target: { mixedContent: true } });
    assert.equal(h.conn.measureHost(), false);
    h.conn.checkHost();
    h.conn.reconnect();
    assert.equal(h.hostCalls.length, 0);
    assert.match(snap(h).hostProbeBlockedReason ?? '', /mixed content/);
    assert.equal(snap(h).host.reachable, null, 'unknown, not "unreachable"');
    assert.equal(ofType(h, 'host_unreachable').length, 0);
  });

  it('does not let periodic samples flood the Phase 1 verbose log', async () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.conn.setAutoMeasure(5000);
    await answer(h, { reachable: true, latencyMs: 20 });
    const before = snap(h).events.length;
    for (let i = 0; i < 20; i++) {
      h.clock.advance(5000);
      await answer(h, { reachable: true, latencyMs: 20 + i });
    }
    assert.equal(snap(h).events.length, before);
    assert.equal(snap(h).hostSamples.length, 21);
  });
});

describe('opt-in periodic measurement', () => {
  const connected = (options?: MakeOptions) => {
    const h = mk(options);
    h.transport.last.firstFrame();
    return h;
  };

  it('measures at once, then at the interval, and stops when switched off', async () => {
    const h = connected();
    h.conn.setAutoMeasure(10_000);
    assert.equal(h.hostCalls.length, 1);
    assert.equal(snap(h).autoMeasureMs, 10_000);
    assert.equal(snap(h).hostChecking, true);
    await answer(h, { reachable: true, latencyMs: 10 });
    h.clock.advance(10_000);
    assert.equal(h.hostCalls.length, 2);
    await answer(h, { reachable: true, latencyMs: 11 });
    h.clock.advance(10_000);
    assert.equal(h.hostCalls.length, 3);
    await answer(h, { reachable: true, latencyMs: 12 });
    h.conn.setAutoMeasure(null);
    h.clock.advance(120_000);
    assert.equal(h.hostCalls.length, 3);
    assert.equal(snap(h).autoMeasureMs, null);
    assert.ok(snap(h).hostSamples.every((s) => s.trigger === 'auto'));
  });

  it('switching it off removes its timer, not just its effect', () => {
    const h = connected();
    const before = h.clock.pendingTimers();
    h.conn.setAutoMeasure(10_000);
    assert.equal(h.clock.pendingTimers(), before + 1, 'exactly one timer drives the periodic measurement');
    h.conn.setAutoMeasure(null);
    assert.equal(h.clock.pendingTimers(), before);
  });

  it('raises a too-small interval to the minimum so the camera is not hammered', () => {
    const h = connected();
    h.conn.setAutoMeasure(200);
    assert.equal(snap(h).autoMeasureMs, 5000);
  });

  it('turning on the same interval twice does not start an extra request', () => {
    const h = connected();
    h.conn.setAutoMeasure(5000);
    h.conn.setAutoMeasure(5000);
    assert.equal(h.hostCalls.length, 1);
  });

  it('skips a tick while the previous request is still running', async () => {
    const h = connected();
    h.conn.setAutoMeasure(5000);
    h.clock.advance(30_000);
    assert.equal(h.hostCalls.length, 1, 'six ticks passed but only one request may be in flight');
    await answer(h, { reachable: true, latencyMs: 1 });
    h.clock.advance(5000);
    assert.equal(h.hostCalls.length, 2);
  });

  it('does nothing while the page is hidden', async () => {
    let visible = false;
    const h = connected({ isPageVisible: () => visible });
    h.conn.setAutoMeasure(5000);
    assert.equal(h.hostCalls.length, 0);
    h.clock.advance(20_000);
    assert.equal(h.hostCalls.length, 0);
    visible = true;
    h.clock.advance(5000);
    assert.equal(h.hostCalls.length, 1);
  });

  it('shutdown cancels the timer and the request in flight', async () => {
    const h = connected();
    h.conn.setAutoMeasure(5000);
    const call = h.hostCalls[0];
    h.conn.shutdown();
    assert.equal(call.signal.aborted, true);
    h.clock.advance(120_000);
    assert.equal(h.hostCalls.length, 1);
    assert.equal(snap(h).autoMeasureMs, null);
    assert.equal(h.clock.pendingTimers(), 0, 'no timer may survive shutdown');
  });

  it('reports a periodic failure once and never touches the stream status', async () => {
    const h = connected();
    h.conn.setAutoMeasure(5000);
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    h.clock.advance(5000);
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    h.clock.advance(5000);
    await answer(h, { reachable: false, failure: 'timeout', latencyMs: 2500 });
    assert.equal(ofType(h, 'host_unreachable').length, 1);
    assert.equal(status(h), 'connected');
    assert.equal(ofType(h, 'stream_disconnected').length, 0);
  });

  it('follows a changed camera address with a fresh measurement list', async () => {
    const h = connected();
    h.conn.setAutoMeasure(5000);
    await answer(h, { reachable: true, latencyMs: 10 });
    h.conn.configure({ baseUrl: 'http://10.0.0.9', url: 'http://10.0.0.9:81/stream' });
    assert.equal(snap(h).hostSamples.length, 0, 'old camera, old numbers');
    h.clock.advance(5000);
    assert.equal(h.hostCalls.at(-1)!.baseUrl, 'http://10.0.0.9');
  });
});

describe('failure classification and recovery summary', () => {
  const cases: Array<[StreamFailureKind, (h: Harness) => void, MakeOptions?]> = [
    ['connect-timeout', (h) => timeoutAttempt(h)],
    ['transport-error', (h) => h.transport.last.error('reset')],
    ['ended', (h) => h.transport.last.ended('bye')],
    [
      'display-lost',
      (h) => {
        h.transport.last.firstFrame();
        h.transport.last.pollResult = 'broken';
        h.clock.advance(4000);
      },
    ],
    [
      'stall',
      (h) => {
        h.transport.last.firstFrame();
        h.clock.advance(7000);
      },
      { target: { mode: 'monitor' } },
    ],
  ];
  for (const [kind, act, options] of cases) {
    it(`labels the failure "${kind}"`, () => {
      const h = mk(options);
      assert.equal(snap(h).failureKind, null);
      act(h);
      assert.equal(snap(h).failureKind, kind);
    });
  }

  it('labels a transport that cannot be opened "open-failed"', () => {
    const h = mk({ start: false });
    h.transport.throwOnOpen = new Error('no socket');
    h.conn.configure(CAM);
    h.conn.setElementAvailable(true);
    h.conn.setViewing(true);
    assert.equal(snap(h).failureKind, 'open-failed');
  });

  it('remembers the most recent successful recovery', () => {
    const h = mk();
    assert.equal(snap(h).lastRecovery, null);
    h.transport.last.firstFrame();
    h.clock.advance(2000);
    h.transport.last.error('reset');
    h.clock.advance(1000);
    h.transport.last.firstFrame();
    const r = snap(h).lastRecovery!;
    assert.equal(r.at, h.clock.now());
    assert.equal(r.durationMs, 1000);
    assert.equal(r.attempts, 1);
  });

  it('does not call a manual refresh of a healthy stream a recovery', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.clock.advance(2000);
    h.conn.reconnect();
    h.transport.last.firstFrame();
    assert.equal(snap(h).lastRecovery, null);
    assert.equal(ofType(h, 'reconnect_succeeded').length, 0);
  });

  it('remembers that a recovery was cut short when the Live Feed was left', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.clock.advance(2000);
    h.transport.last.error('connection reset');
    h.clock.advance(1000);
    timeoutAttempt(h); // the first retry never delivers a frame
    assert.equal(snap(h).recovery.state, 'in_progress');
    h.conn.setViewing(false);
    const s = snap(h);
    assert.equal(s.recovery.state, 'none', 'the Phase 1 recovery state is unchanged by this');
    assert.ok(s.interruptedRecovery, 'but the interruption is not forgotten');
    assert.match(s.interruptedRecovery!.reason ?? '', /reset|lost|connection/i);
    assert.ok(s.interruptedRecovery!.attempts >= 1);
    // A healthy stream afterwards clears it: the question has been answered.
    h.conn.setViewing(true);
    h.transport.last.firstFrame();
    assert.equal(snap(h).interruptedRecovery, null);
  });

  it('a stream that was healthy when it was closed leaves no interruption behind', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.conn.setViewing(false);
    assert.equal(snap(h).interruptedRecovery, null);
  });

  it('forgets an interrupted recovery when the camera settings change', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.transport.last.error('reset');
    h.conn.setViewing(false);
    assert.ok(snap(h).interruptedRecovery);
    h.conn.configure({ url: 'http://10.0.0.5:81/other' });
    assert.equal(snap(h).interruptedRecovery, null);
  });

  it('forgets the recovery of the old camera when the settings change', () => {
    const h = mk();
    h.transport.last.firstFrame();
    h.transport.last.error('reset');
    h.clock.advance(1000);
    h.transport.last.firstFrame();
    assert.ok(snap(h).lastRecovery);
    h.conn.configure({ url: 'http://10.0.0.5:81/other' });
    assert.equal(snap(h).lastRecovery, null);
    assert.equal(snap(h).failureKind, null);
  });
});

describe('clearing and storing the history', () => {
  it('clearHistory empties the log, tells subscribers, and later events are recorded again', () => {
    const store = new FakeStore();
    const h = mk({ store });
    h.transport.last.firstFrame();
    assert.ok(history(h).length >= 3);
    const before = h.notifications;
    h.conn.clearHistory();
    assert.deepEqual(history(h), []);
    assert.ok(h.notifications > before);
    assert.equal(store.data.has(CONNECTION_HISTORY_KEY), false);
    h.transport.last.error('reset');
    assert.equal(ofType(h, 'stream_disconnected').length, 1);
  });

  it('a history survives a reload; the new page load is marked and old events are flagged as earlier', () => {
    const store = new FakeStore();
    const first = mk({ store, sessionId: 'page-1' });
    first.transport.last.firstFrame();
    first.transport.last.error('reset');

    const second = mk({ store, sessionId: 'page-2' });
    const events = history(second);
    assert.ok(events.filter((e) => e.restored).length >= 4);
    assert.ok(events.some((e) => e.restored && e.type === 'stream_disconnected'));
    const last = events.filter((e) => e.type === 'session_started').at(-1)!;
    assert.equal(last.session, 'page-2');
    assert.equal(snap(second).historyStorage.status, 'persistent');
  });

  it('the same page load creating the connection twice (StrictMode) does not duplicate the marker', () => {
    const store = new FakeStore();
    mk({ store, sessionId: 'same-page' });
    const second = mk({ store, sessionId: 'same-page' });
    assert.equal(ofType(second, 'session_started').length, 1);
  });

  it('keeps working in memory and reports it when browser storage fails', () => {
    const store = new FakeStore();
    store.failSet = new Error('blocked');
    const h = mk({ store });
    h.transport.last.firstFrame();
    assert.ok(history(h).length >= 3);
    assert.equal(snap(h).historyStorage.status, 'memory-only');
    assert.match(snap(h).historyStorage.reason ?? '', /blocked/);
  });

  it('stays bounded through a very long outage', () => {
    const h = mk({ policy: { maxRetries: 1_000_000, maxDelayMs: 1000 } });
    for (let i = 0; i < 500; i++) {
      h.clock.advance(CONNECT_TIMEOUT_MS + 1000);
    }
    assert.ok(history(h).length <= 100);
    assert.ok(snap(h).events.length <= 100);
    assert.ok(ofType(h, 'reconnect_failed').length <= 1, 'identical failures are folded, not listed 500 times');
  });
});

describe('a snapshot never leaks mutable internals', () => {
  it('history and samples in a snapshot are copies', async () => {
    const h = mk();
    h.conn.measureHost();
    await answer(h, { reachable: true, latencyMs: 5 });
    const s = snap(h);
    s.history[0].message = 'tampered';
    s.hostSamples[0].elapsedMs = 999;
    h.conn.measureHost(); // publishes a new snapshot built from the internal state
    assert.notEqual(snap(h).history[0].message, 'tampered');
    assert.equal(snap(h).hostSamples[0].elapsedMs, 5);
  });

  it('is a StreamConnection', () => {
    assert.ok(mk().conn instanceof StreamConnection);
  });
});

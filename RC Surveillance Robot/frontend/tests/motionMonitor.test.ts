/**
 * MotionMonitor tests.
 *
 * SIMULATED: a fake clock, a scripted frame sampler (the test decides what "the camera shows"),
 * generated frames and a fake visibility API. They prove the supervisor's rules: when it is
 * STARTING / ACTIVE, when it alerts, the cooldown, confirmation, lifecycle, error handling and
 * cleanup. They say nothing about how a real ESP32-CAM picture behaves (noise, exposure, frame
 * rate); that is unverified until it is run against the camera.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CameraInput,
  MAX_CONSECUTIVE_FAILURES,
  MOTION_DISPLAY_MS,
  MotionMonitor,
  STALE_FRAMES_MS,
  linkFromCaptureOutcome,
} from '../src/services/motionMonitor';
import { MotionHistory } from '../src/services/motionHistory';
import { CanvasFrameSampler } from '../src/services/frameSampler';
import { DEFAULT_MOTION_SETTINGS, normalizeSettings } from '../src/services/motionSettings';
import type { MotionEvent, MotionSettings, MotionSnapshotLink, MotionStatus } from '../src/types/motion';
import type { CaptureOutcome } from '../src/services/snapshotActions';
import { FakeClock, FakeStore, flush } from './helpers';
import {
  FakeVisibility,
  RECT_3,
  RECT_5,
  RECT_BIG,
  RECT_BIG_RIGHT,
  ScriptedSampler,
  frame,
  samplerCanvasFactory,
} from './motionFakes';
import { jpegBlob, namedError } from './snapshotFakes';

interface SetupOptions {
  settings?: Partial<MotionSettings>;
  camera?: Partial<CameraInput>;
  capture?: () => Promise<MotionSnapshotLink>;
  onMotionEvent?: (event: MotionEvent) => void;
}

function setup(options: SetupOptions = {}) {
  const clock = new FakeClock();
  const sampler = new ScriptedSampler();
  const store = new FakeStore();
  const history = new MotionHistory({ store });
  const visibility = new FakeVisibility();
  const saved: MotionSettings[] = [];
  let n = 0;
  const monitor = new MotionMonitor({
    clock,
    sampler,
    history,
    visibility,
    settings: normalizeSettings({ ...DEFAULT_MOTION_SETTINGS, ...options.settings }),
    persistSettings: (s) => saved.push(s),
    makeId: () => `m${++n}`,
    captureSnapshot: options.capture,
    onMotionEvent: options.onMotionEvent,
  });
  monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected', ...options.camera });

  const statuses: MotionStatus[] = [];
  monitor.subscribe(() => statuses.push(monitor.getSnapshot().status));
  return {
    clock,
    sampler,
    store,
    history,
    visibility,
    monitor,
    saved,
    statuses,
    state: () => monitor.getSnapshot(),
    events: () => history.getSnapshot().events,
    /** The first check after start() is due immediately. */
    first(f: Uint8Array) {
      sampler.show(f);
      clock.advance(0);
    },
    /** One more check, one interval later. */
    next(f: Uint8Array) {
      sampler.show(f);
      clock.advance(monitor.getSnapshot().settings.intervalMs);
    },
  };
}

type Harness = ReturnType<typeof setup>;

const BG = () => frame();
const quiet = (seed: number) => frame({ noise: 4, seed });
const A = () => frame({ rects: [RECT_BIG] });
const B = () => frame({ rects: [RECT_BIG_RIGHT] });

/** Reach a quiet ACTIVE state: baseline plus one compared frame. */
function reachActive(h: Harness) {
  h.monitor.start();
  h.first(quiet(1));
  h.next(quiet(2));
  assert.equal(h.state().status, 'active');
}

describe('STARTING, ACTIVE and identical frames', () => {
  it('is OFF and does nothing until started', () => {
    const h = setup();
    assert.equal(h.state().status, 'off');
    h.clock.advance(60_000);
    assert.equal(h.sampler.samples, 0);
    assert.equal(h.clock.pendingTimers(), 0);
  });

  it('is STARTING until two different frames have been compared, and never shows ACTIVE earlier', () => {
    const h = setup();
    h.monitor.start();
    assert.equal(h.state().status, 'starting');
    assert.match(h.state().message ?? '', /first camera frame/);
    h.first(quiet(1)); // baseline only
    assert.equal(h.state().status, 'starting');
    assert.match(h.state().message ?? '', /Waiting for a different frame/);
    assert.equal(h.state().framesCompared, 0);
    h.next(quiet(2)); // first comparison
    assert.equal(h.state().status, 'active');
    assert.equal(h.state().framesCompared, 1);
    assert.ok(!h.statuses.slice(0, h.statuses.indexOf('active')).includes('active'));
  });

  it('finds no motion between identical frames, skips them instead of re-processing, and does not claim ACTIVE', () => {
    const h = setup();
    h.monitor.start();
    h.first(BG());
    for (let i = 0; i < 5; i++) h.next(BG());
    assert.equal(h.state().duplicateFramesSkipped, 5, 'the same picture is recognised and skipped');
    assert.equal(h.state().framesCompared, 0, 'nothing was compared');
    assert.equal(h.state().lastChangedPercent, null);
    assert.equal(h.state().status, 'starting', 'no valid comparison has happened, so it is not ACTIVE');
    assert.equal(h.events().length, 0);
  });

  it('compares noisy but unchanged frames and reports no motion', () => {
    const h = setup();
    h.monitor.start();
    h.first(frame({ noise: 8, seed: 1 }));
    for (let seed = 2; seed <= 7; seed++) h.next(frame({ noise: 8, seed }));
    assert.equal(h.state().framesCompared, 6);
    assert.equal(h.state().status, 'active');
    assert.equal(h.state().lastChangedPercent, 0);
    assert.equal(h.events().length, 0);
  });
});

describe('detecting motion', () => {
  it('alerts when the picture changes for the confirmed number of consecutive frames, and records the measurements', () => {
    const h = setup(); // Medium, 2 frames
    h.monitor.start();
    h.first(BG());
    h.next(A());
    assert.equal(h.events().length, 0, 'one changed frame is not enough with confirmation of 2');
    assert.notEqual(h.state().status, 'motion');
    h.next(B());

    assert.equal(h.state().status, 'motion');
    assert.equal(h.events().length, 1);
    const e = h.events()[0];
    assert.equal(e.id, 'm1');
    assert.equal(e.t, h.clock.now());
    assert.equal(e.changedPercent, 31.3, '960 of 3072 pixels (A vanished, B appeared)');
    assert.equal(e.thresholdPercent, 4);
    assert.equal(e.pixelThreshold, 28);
    assert.equal(e.sensitivity, 'medium');
    assert.equal(e.confirmFrames, 2);
    assert.equal(e.region, 'full');
    assert.deepEqual(e.snapshot, { status: 'off' });
    assert.deepEqual(h.state().lastEvent, e);
    assert.equal(h.store.data.size >= 1, true, 'the event was saved');
  });

  it('one changed comparison followed by calm does not alert (confirmation resets)', () => {
    const h = setup();
    h.monitor.start();
    h.first(BG());
    h.next(A());
    h.next(frame({ rects: [RECT_BIG], noise: 4, seed: 9 })); // same scene again: no change
    h.next(frame({ rects: [RECT_BIG], noise: 4, seed: 10 }));
    h.next(frame({ rects: [RECT_BIG, RECT_BIG_RIGHT] })); // a new change, but a fresh streak of 1
    assert.equal(h.events().length, 0);
  });

  it('alerts on a single changed frame when confirmation is 1', () => {
    const h = setup({ settings: { confirmFrames: 1 } });
    h.monitor.start();
    h.first(BG());
    h.next(A());
    assert.equal(h.events().length, 1);
  });

  it('returns from MOTION DETECTED to ACTIVE after the display time', () => {
    const h = setup();
    h.monitor.start();
    h.first(BG());
    h.next(A());
    h.next(B()); // alert at t = 2000
    assert.equal(h.state().status, 'motion');
    const alertAt = h.clock.now();
    let seed = 20;
    while (h.clock.now() - alertAt < MOTION_DISPLAY_MS - 1000) h.next(frame({ rects: [RECT_BIG_RIGHT], noise: 4, seed: seed++ }));
    assert.equal(h.state().status, 'motion');
    h.next(frame({ rects: [RECT_BIG_RIGHT], noise: 4, seed: seed++ }));
    assert.equal(h.clock.now() - alertAt, MOTION_DISPLAY_MS);
    assert.equal(h.state().status, 'active');
  });

  it('sensitivity changes the outcome: a 3% movement alerts at High, not at Medium or Low', () => {
    const run = (sensitivity: 'low' | 'medium' | 'high') => {
      const h = setup({ settings: { sensitivity, confirmFrames: 1 } });
      h.monitor.start();
      h.first(BG());
      h.next(frame({ rects: [RECT_3] }));
      return h.events().length;
    };
    assert.deepEqual([run('low'), run('medium'), run('high')], [0, 0, 1]);
  });

  it('a 5% movement alerts at Medium and High but not at Low', () => {
    const run = (sensitivity: 'low' | 'medium' | 'high') => {
      const h = setup({ settings: { sensitivity, confirmFrames: 1 } });
      h.monitor.start();
      h.first(BG());
      h.next(frame({ rects: [RECT_5] }));
      return h.events().length;
    };
    assert.deepEqual([run('low'), run('medium'), run('high')], [0, 1, 1]);
  });

  it('sensor noise below the tolerance never alerts, even at High sensitivity', () => {
    const h = setup({ settings: { sensitivity: 'high', confirmFrames: 1 } });
    h.monitor.start();
    h.first(frame({ noise: 8, seed: 1 }));
    for (let seed = 2; seed <= 30; seed++) h.next(frame({ noise: 8, seed }));
    assert.equal(h.events().length, 0);
    assert.equal(h.state().framesCompared, 29);
  });

  it('the minimum changed area can be set explicitly: 10% hides a 5% movement, 2% shows a 3% one', () => {
    const strict = setup({ settings: { confirmFrames: 1, minChangedPercent: 10 } });
    strict.monitor.start();
    strict.first(BG());
    strict.next(frame({ rects: [RECT_5] }));
    assert.equal(strict.events().length, 0);

    const keen = setup({ settings: { confirmFrames: 1, minChangedPercent: 2 } });
    keen.monitor.start();
    keen.first(BG());
    keen.next(frame({ rects: [RECT_3] }));
    assert.equal(keen.events().length, 1);
    assert.equal(keen.events()[0].thresholdPercent, 2);
  });

  it('a value below the 0.5% floor is raised, so noise-sized changes never alert', () => {
    const h = setup({ settings: { confirmFrames: 1, minChangedPercent: 0.01, sensitivity: 'high' } });
    assert.equal(h.state().settings.minChangedPercent, 0.5);
    h.monitor.start();
    h.first(BG());
    h.next(frame({ rects: [{ x: 0, y: 0, w: 3, h: 3, level: 230 }] })); // 9 px = 0.29%
    assert.equal(h.events().length, 0);
  });

  it('a whole-picture brightness change (auto exposure) does not alert', () => {
    const h = setup({ settings: { confirmFrames: 1, sensitivity: 'high' } });
    h.monitor.start();
    h.first(BG());
    h.next(frame({ shift: 60 }));
    assert.equal(h.events().length, 0);
    assert.equal(h.state().lastChangedPercent, 0);
  });

  it('only the watched area counts', () => {
    const h = setup({ settings: { confirmFrames: 1, region: 'right' } });
    h.monitor.start();
    h.first(BG());
    h.next(A()); // movement on the left
    assert.equal(h.events().length, 0);
    h.next(frame({ rects: [RECT_BIG, RECT_BIG_RIGHT] })); // now also on the right
    assert.equal(h.events().length, 1);
    assert.equal(h.events()[0].region, 'right');
  });
});

describe('cooldown', () => {
  /** Motion on every check: frames alternate between A and B. */
  function motionEveryCheck(h: Harness, checks: number) {
    h.monitor.start();
    h.first(BG());
    let flip = false;
    for (let i = 0; i < checks; i++) {
      h.next(flip ? B() : A());
      flip = !flip;
    }
  }

  it('produces one alert per cooldown, not one per frame', () => {
    const h = setup({ settings: { cooldownSec: 15 } });
    h.monitor.start();
    h.first(BG());
    const start = h.clock.now();
    let flip = false;
    const counts: number[] = [];
    for (let s = 1; s <= 17; s++) {
      h.next(flip ? B() : A());
      flip = !flip;
      counts.push(h.events().length);
    }
    assert.equal(h.clock.now() - start, 17_000);
    // First alert on the 2nd changed frame (t = 2 s); motion continues but nothing new until 15 s later (t = 17 s).
    assert.equal(counts[0], 0);
    assert.equal(counts[1], 1);
    assert.equal(counts[15], 1, 'still one alert at t = 16 s');
    assert.equal(counts[16], 2, 'the next one only when the cooldown has ended');
    assert.equal(h.events()[0].t - h.events()[1].t, 15_000, 'the two alerts are exactly one cooldown apart (newest first)');
  });

  it('reports the cooldown end while it runs and clears it afterwards', () => {
    const h = setup({ settings: { cooldownSec: 5 } });
    motionEveryCheck(h, 2); // alert on the second changed check
    assert.equal(h.events().length, 1);
    assert.equal(h.state().cooldownUntil, h.events()[0].t + 5000);
    h.next(quiet(5));
    h.next(quiet(6));
    h.next(quiet(7));
    h.next(quiet(8));
    h.next(quiet(9));
    assert.equal(h.state().cooldownUntil, null);
  });

  it('a shorter cooldown applies to the very next alert', () => {
    const h = setup({ settings: { cooldownSec: 1, confirmFrames: 1 } });
    h.monitor.start();
    h.first(BG());
    h.next(A());
    h.next(B());
    h.next(A());
    assert.equal(h.events().length, 3, 'one alert per second at a 1 s cooldown');
  });
});

describe('no duplicate processing loops', () => {
  it('Start clicked several times still runs exactly one timer chain', () => {
    const h = setup();
    h.monitor.start();
    h.monitor.start();
    h.monitor.start();
    assert.equal(h.clock.pendingTimers(), 1);
    assert.equal(h.visibility.listeners.size, 1, 'and exactly one visibility listener');
    h.sampler.show(quiet(1));
    h.clock.advance(0);
    h.clock.advance(5000);
    assert.equal(h.sampler.samples, 6, 'one check now plus one per second, not three');
    assert.equal(h.clock.pendingTimers(), 1);
    h.monitor.stop();
    assert.equal(h.visibility.listeners.size, 0, 'one Stop releases everything, however often Start was clicked');
  });

  it('a second Start while detection is running changes nothing: it does not drop back to STARTING or lose its baseline', () => {
    const h = setup({ settings: { confirmFrames: 1 } });
    reachActive(h);
    const compared = h.state().framesCompared;
    h.monitor.start();
    assert.equal(h.state().status, 'active', 'still ACTIVE, not reset to STARTING');
    h.next(frame({ rects: [RECT_BIG] })); // compared with the baseline from before the second click
    assert.equal(h.state().framesCompared, compared + 1);
    assert.equal(h.events().length, 1);
  });

  it('reconnecting and changing the interval never leave a second timer behind', () => {
    const h = setup();
    reachActive(h);
    for (let i = 0; i < 4; i++) {
      h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'reconnecting' });
      assert.equal(h.clock.pendingTimers(), 0);
      h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
      assert.equal(h.clock.pendingTimers(), 1);
    }
    h.monitor.configure({ intervalMs: 500 });
    h.monitor.configure({ intervalMs: 2000 });
    h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' }); // same state again
    assert.equal(h.clock.pendingTimers(), 1);
  });

  it('a changed interval applies at once instead of after the old wait', () => {
    const h = setup({ settings: { intervalMs: 5000 } });
    h.monitor.start();
    h.first(quiet(1));
    const before = h.sampler.samples;
    h.monitor.configure({ intervalMs: 250 });
    h.sampler.show(quiet(2));
    h.clock.advance(250);
    assert.equal(h.sampler.samples, before + 1);
  });
});

describe('Start and Stop', () => {
  it('Stop clears the timer, releases the canvas, removes the visibility listener and goes OFF', () => {
    const h = setup();
    reachActive(h);
    assert.equal(h.visibility.listeners.size, 1);
    const releasesBefore = h.sampler.releases;
    h.monitor.stop();
    assert.equal(h.state().status, 'off');
    assert.equal(h.clock.pendingTimers(), 0);
    assert.ok(h.sampler.releases > releasesBefore);
    assert.equal(h.visibility.listeners.size, 0);
    const samples = h.sampler.samples;
    h.clock.advance(60_000);
    assert.equal(h.sampler.samples, samples, 'no checks after Stop');
  });

  it('Stop is harmless when not running, and the monitor can be started again with a fresh baseline', () => {
    const h = setup({ settings: { confirmFrames: 1 } });
    h.monitor.stop();
    h.monitor.start();
    h.first(BG());
    h.monitor.stop();
    h.monitor.start();
    h.first(A()); // very different from BG, but it is only the new baseline
    assert.equal(h.events().length, 0);
    assert.equal(h.state().status, 'starting');
    h.next(frame({ rects: [RECT_BIG], noise: 3, seed: 5 }));
    assert.equal(h.state().status, 'active');
  });

  it('Start while the camera is not connected waits, and begins when it connects', () => {
    const h = setup({ camera: { connected: false, statusLabel: 'connecting' } });
    h.monitor.start();
    assert.equal(h.state().status, 'camera-disconnected');
    assert.equal(h.clock.pendingTimers(), 0);
    assert.equal(h.sampler.samples, 0);
    h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
    assert.equal(h.state().status, 'starting');
    assert.equal(h.clock.pendingTimers(), 1);
  });
});

describe('camera disconnection and reconnection', () => {
  it('stops checking and shows CAMERA DISCONNECTED when the stream drops', () => {
    const h = setup();
    reachActive(h);
    h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'reconnecting' });
    assert.equal(h.state().status, 'camera-disconnected');
    assert.match(h.state().message ?? '', /not connected \(reconnecting\)/);
    assert.equal(h.clock.pendingTimers(), 0);
    const samples = h.sampler.samples;
    h.clock.advance(30_000);
    assert.equal(h.sampler.samples, samples, 'nothing is read while the camera is down');
  });

  it('leaves MOTION DETECTED at once when the camera drops', () => {
    const h = setup({ settings: { confirmFrames: 1 } });
    h.monitor.start();
    h.first(BG());
    h.next(A());
    assert.equal(h.state().status, 'motion');
    h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'error' });
    assert.equal(h.state().status, 'camera-disconnected');
  });

  it('after reconnecting it starts over: the first frame is a new baseline, never compared with a frame from before the gap', () => {
    const h = setup({ settings: { confirmFrames: 1, sensitivity: 'high' } });
    h.monitor.start();
    h.first(BG());
    h.next(quiet(3));
    h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'reconnecting' });
    h.clock.advance(20_000);
    h.sampler.show(A()); // what the (stale or new) picture shows after the gap is nothing like BG
    h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
    assert.equal(h.state().status, 'starting', 'not ACTIVE until frames are compared again');
    h.clock.advance(0);
    assert.equal(h.events().length, 0, 'no alert from comparing across the outage');
    assert.equal(h.state().status, 'starting');
    h.next(frame({ rects: [RECT_BIG], noise: 3, seed: 8 }));
    assert.equal(h.state().status, 'active');
    assert.equal(h.events().length, 0);
  });

  it('a frozen picture during an outage cannot cause an alert (identical frames are never a change)', () => {
    const h = setup({ settings: { confirmFrames: 1, sensitivity: 'high' } });
    reachActive(h);
    h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'reconnecting' });
    h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
    h.first(quiet(2));
    for (let i = 0; i < 5; i++) h.next(quiet(2));
    assert.equal(h.events().length, 0);
  });

  it('does not resume while the tab is still hidden', () => {
    const h = setup();
    reachActive(h);
    h.visibility.set(false);
    h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'reconnecting' });
    h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
    assert.equal(h.state().status, 'paused');
    assert.equal(h.clock.pendingTimers(), 0);
  });
});

describe('leaving the Live Stream view and tab visibility', () => {
  it('pauses while Snapshot mode (no live picture) is showing and resumes with a fresh baseline', () => {
    const h = setup();
    reachActive(h);
    h.monitor.setCamera({ viewing: false, connected: false, statusLabel: 'disconnected' });
    assert.equal(h.state().status, 'paused');
    assert.match(h.state().message ?? '', /Live Stream view is not showing/);
    assert.equal(h.clock.pendingTimers(), 0);
    h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
    assert.equal(h.state().status, 'starting');
    assert.equal(h.clock.pendingTimers(), 1);
  });

  it('pauses while the tab is hidden: no timer, no checks; resumes with a fresh baseline when shown', () => {
    const h = setup({ settings: { confirmFrames: 1 } });
    reachActive(h);
    h.visibility.set(false);
    assert.equal(h.state().status, 'paused');
    assert.match(h.state().message ?? '', /tab is hidden/);
    assert.equal(h.clock.pendingTimers(), 0);
    const samples = h.sampler.samples;
    h.clock.advance(120_000);
    assert.equal(h.sampler.samples, samples);

    h.visibility.set(true);
    assert.equal(h.state().status, 'starting');
    h.first(A()); // very different from anything before the pause: baseline only
    assert.equal(h.events().length, 0);
    h.next(frame({ rects: [RECT_BIG], noise: 3, seed: 4 }));
    assert.equal(h.state().status, 'active');
  });

  it('ignores visibility changes while Detection is off', () => {
    const h = setup();
    h.visibility.set(false);
    h.visibility.set(true);
    assert.equal(h.state().status, 'off');
    assert.equal(h.clock.pendingTimers(), 0);
    assert.equal(h.visibility.listeners.size, 0);
  });

  it('starts as PAUSED when the tab is already hidden', () => {
    const h = setup();
    h.visibility.visible = false;
    h.monitor.start();
    assert.equal(h.state().status, 'paused');
    assert.equal(h.clock.pendingTimers(), 0);
  });
});

describe('frame decoding errors', () => {
  it('keeps waiting through occasional failed checks without raising an error', () => {
    const h = setup();
    h.monitor.start();
    h.sampler.fail('no-frame');
    h.clock.advance(0);
    for (let i = 0; i < 3; i++) h.clock.advance(1000);
    assert.equal(h.state().status, 'starting');
    assert.equal(h.clock.pendingTimers(), 1, 'it keeps trying');
    h.next(quiet(1)); // the next check finds a picture: baseline
    h.next(quiet(2));
    assert.equal(h.state().status, 'active');
  });

  it('turns repeated failures into ERROR and stops checking instead of retrying forever', () => {
    const h = setup();
    h.monitor.start();
    h.sampler.fail('decode-failed', 'The browser could not read the current frame.');
    h.clock.advance(0);
    for (let i = 1; i < MAX_CONSECUTIVE_FAILURES; i++) h.clock.advance(1000);
    assert.equal(h.state().status, 'error');
    assert.match(h.state().message ?? '', new RegExp(`${MAX_CONSECUTIVE_FAILURES} checks in a row`));
    assert.equal(h.clock.pendingTimers(), 0);
    assert.equal(h.sampler.samples, MAX_CONSECUTIVE_FAILURES);
    h.clock.advance(60_000);
    assert.equal(h.sampler.samples, MAX_CONSECUTIVE_FAILURES, 'no further checks');
    assert.equal(h.events().length, 0);
  });

  it('a successful check resets the failure count', () => {
    const h = setup();
    h.monitor.start();
    h.sampler.fail('no-frame');
    h.clock.advance(0);
    for (let i = 1; i < MAX_CONSECUTIVE_FAILURES - 1; i++) h.clock.advance(1000); // 9 failures in total
    h.sampler.show(quiet(1));
    h.clock.advance(1000); // success
    h.sampler.fail('no-frame');
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) h.clock.advance(1000); // 9 more
    assert.notEqual(h.state().status, 'error');
  });

  it('a canvas that cannot be created is an immediate ERROR', () => {
    const h = setup();
    h.monitor.start();
    h.sampler.fail('canvas-unavailable', 'This browser could not create a canvas to read the frame.');
    h.clock.advance(0);
    assert.equal(h.state().status, 'error');
    assert.equal(h.clock.pendingTimers(), 0);
  });

  it('an unexpected exception becomes ERROR and does not escape or leave a timer behind', () => {
    const h = setup();
    h.monitor.start();
    h.sampler.throwOnSample = new Error('boom');
    h.clock.advance(0);
    assert.equal(h.state().status, 'error');
    assert.match(h.state().message ?? '', /Unexpected error.*boom/);
    assert.equal(h.clock.pendingTimers(), 0);
  });

  it('recovers after a reconnect or Stop + Start', () => {
    const h = setup();
    h.monitor.start();
    h.sampler.fail('canvas-unavailable');
    h.clock.advance(0);
    assert.equal(h.state().status, 'error');
    h.sampler.show(quiet(1));
    h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'reconnecting' });
    h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
    assert.equal(h.state().status, 'starting');
    h.clock.advance(0);
    h.next(quiet(2));
    assert.equal(h.state().status, 'active');
  });
});

describe('FRAME ACCESS BLOCKED (canvas SecurityError)', () => {
  it('reports it, never claims ACTIVE, makes no events, and stops checking', () => {
    const h = setup({ settings: { confirmFrames: 1, sensitivity: 'high' } });
    h.monitor.start();
    h.sampler.fail('blocked');
    h.clock.advance(0);

    assert.equal(h.state().status, 'blocked');
    assert.match(h.state().message ?? '', /will not let this page read the live picture/);
    assert.equal(h.clock.pendingTimers(), 0, 'no endless retries');
    h.clock.advance(60_000);
    assert.equal(h.sampler.samples, 1);
    assert.equal(h.events().length, 0, 'no fake motion events');
    assert.ok(!h.statuses.includes('active') && !h.statuses.includes('motion'));
    assert.equal(h.state().framesCompared, 0);
  });

  it('is retried when the stream reconnects (for example after enabling CORS capture), and works once pixels are readable', () => {
    const h = setup();
    h.monitor.start();
    h.sampler.fail('blocked');
    h.clock.advance(0);
    assert.equal(h.state().status, 'blocked');

    h.sampler.show(quiet(1)); // after the reconnect with CORS the pixels are readable
    h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'reconnecting' });
    h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
    assert.equal(h.state().status, 'starting');
    h.clock.advance(0);
    h.next(quiet(2));
    assert.equal(h.state().status, 'active');
  });

  it('is retried by Stop + Start', () => {
    const h = setup();
    h.monitor.start();
    h.sampler.fail('blocked');
    h.clock.advance(0);
    h.monitor.stop();
    h.monitor.start();
    h.clock.advance(0);
    assert.equal(h.sampler.samples, 2);
    assert.equal(h.state().status, 'blocked', 'still blocked, still honest');
  });

  it('works end to end with the real canvas sampler: a tainted canvas gives BLOCKED', () => {
    const clock = new FakeClock();
    const history = new MotionHistory({ store: new FakeStore() });
    const { createCanvas } = samplerCanvasFactory({
      getImageDataThrows: namedError('SecurityError', 'The canvas has been tainted by cross-origin data.'),
    });
    const monitor = new MotionMonitor({
      clock,
      history,
      visibility: new FakeVisibility(),
      sampler: new CanvasFrameSampler(() => ({ complete: true, naturalWidth: 640, naturalHeight: 480 }), { createCanvas }),
    });
    monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
    monitor.start();
    clock.advance(0);
    assert.equal(monitor.getSnapshot().status, 'blocked');
    assert.equal(history.getSnapshot().events.length, 0);
    assert.equal(clock.pendingTimers(), 0);
  });
});

describe('stale frames', () => {
  it('says so when no new picture arrives for a long time, and clears the warning when one does', () => {
    const h = setup();
    reachActive(h);
    assert.equal(h.state().framesStale, false);
    for (let i = 0; i < STALE_FRAMES_MS / 1000 + 2; i++) h.next(quiet(2)); // the camera keeps showing the same picture
    assert.equal(h.state().framesStale, true);
    assert.match(h.state().message ?? '', /No new camera picture for \d+ s/);
    assert.equal(h.events().length, 0);
    h.next(quiet(3));
    assert.equal(h.state().framesStale, false);
  });
});

describe('a frozen camera that starts again', () => {
  it('does not compare the first new picture with the one from before the freeze', () => {
    const h = setup({ settings: { confirmFrames: 1, sensitivity: 'high' } });
    reachActive(h);
    const compared = h.state().framesCompared;
    for (let i = 0; i < STALE_FRAMES_MS / 1000 + 2; i++) h.next(quiet(2)); // frozen: the very same picture
    assert.equal(h.state().framesStale, true);

    h.next(A()); // frames flow again, and the picture is nothing like the one before the freeze
    assert.equal(h.events().length, 0, 'no alert from comparing across the freeze');
    assert.equal(h.state().framesCompared, compared, 'it was only a new baseline');
    assert.equal(h.state().framesStale, false);
    assert.equal(h.state().status, 'active', 'it keeps running; nothing needs to be restarted');

    h.next(B()); // now there is a real change between two fresh pictures
    assert.equal(h.events().length, 1);
  });

  it('an ordinary gap between pictures below the stale limit is still compared', () => {
    const h = setup({ settings: { confirmFrames: 1 } });
    reachActive(h);
    for (let i = 0; i < 5; i++) h.next(quiet(2)); // 5 s of identical pictures: well under the limit
    h.next(A());
    assert.equal(h.events().length, 1);
  });
});

describe('optional snapshot on motion', () => {
  /** A capture whose result the test releases by hand. */
  function gate() {
    const calls: Array<(link: MotionSnapshotLink) => void> = [];
    return {
      calls,
      capture: () => new Promise<MotionSnapshotLink>((resolve) => calls.push(resolve)),
    };
  }
  const motionTwice = (h: Harness) => {
    h.monitor.start();
    h.first(BG());
    h.next(A());
    h.next(B());
  };

  it('does not capture anything when the option is off, and detection still works', () => {
    let captures = 0;
    const h = setup({ settings: { captureSnapshot: false }, capture: async () => (captures++, { status: 'saved' }) });
    motionTwice(h);
    assert.equal(h.events().length, 1);
    assert.equal(captures, 0);
    assert.deepEqual(h.events()[0].snapshot, { status: 'off' });
  });

  it('captures one snapshot per alert and links it to the event when it succeeds', async () => {
    const g = gate();
    const h = setup({ settings: { captureSnapshot: true }, capture: g.capture });
    motionTwice(h);
    assert.equal(g.calls.length, 1);
    assert.equal(h.events()[0].snapshot.status, 'pending');
    assert.equal(h.state().lastEvent?.snapshot.status, 'pending');

    g.calls[0]({ status: 'saved', snapshotId: 'snap-42' });
    await flush();
    assert.deepEqual(h.events()[0].snapshot, { status: 'saved', snapshotId: 'snap-42' });
    assert.deepEqual(h.state().lastEvent?.snapshot, { status: 'saved', snapshotId: 'snap-42' });
    assert.match(h.store.data.get('rc_surveillance_motion_history_v1') ?? '', /snap-42/, 'the link is saved with the event');
  });

  it('records a failed snapshot honestly (the event itself is kept)', async () => {
    const h = setup({
      settings: { captureSnapshot: true },
      capture: async () => ({ status: 'failed', note: 'The browser blocked reading this frame (canvas security).' }),
    });
    motionTwice(h);
    await flush();
    assert.equal(h.events().length, 1);
    assert.equal(h.events()[0].snapshot.status, 'failed');
    assert.match(h.events()[0].snapshot.note ?? '', /blocked/);
    assert.equal(h.events()[0].snapshot.snapshotId, undefined);
  });

  it('records an exception during the snapshot as a failure', async () => {
    const h = setup({
      settings: { captureSnapshot: true },
      capture: async () => {
        throw new Error('gallery unavailable');
      },
    });
    motionTwice(h);
    await flush();
    assert.equal(h.events()[0].snapshot.status, 'failed');
    assert.match(h.events()[0].snapshot.note ?? '', /gallery unavailable/);
  });

  it('records a snapshot that was captured but could not be stored', async () => {
    const h = setup({
      settings: { captureSnapshot: true },
      capture: async () => ({ status: 'session-only', snapshotId: 'snap-1', note: 'storage full' }),
    });
    motionTwice(h);
    await flush();
    assert.deepEqual(h.events()[0].snapshot, { status: 'session-only', snapshotId: 'snap-1', note: 'storage full' });
  });

  it('never takes a second snapshot during the cooldown', () => {
    let captures = 0;
    const h = setup({ settings: { captureSnapshot: true, cooldownSec: 15 }, capture: async () => (captures++, { status: 'saved' }) });
    h.monitor.start();
    h.first(BG());
    let flip = false;
    for (let s = 1; s <= 16; s++) {
      h.next(flip ? B() : A());
      flip = !flip;
    }
    assert.equal(h.events().length, 1);
    assert.equal(captures, 1, 'sixteen seconds of constant motion, one alert, one snapshot');
  });

  it('skips (and says so) rather than queueing when the previous snapshot is still being captured', async () => {
    const g = gate();
    const h = setup({ settings: { captureSnapshot: true, cooldownSec: 1, confirmFrames: 1 }, capture: g.capture });
    h.monitor.start();
    h.first(BG());
    h.next(A()); // alert 1 -> capture starts and does not finish
    h.next(B()); // alert 2 (cooldown over) -> previous capture still running
    assert.equal(h.events().length, 2);
    assert.equal(g.calls.length, 1, 'only one capture at a time');
    assert.equal(h.events()[0].snapshot.status, 'skipped');
    assert.match(h.events()[0].snapshot.note ?? '', /still being captured/);
    g.calls[0]({ status: 'saved', snapshotId: 'first' });
    await flush();
    assert.equal(h.events()[1].snapshot.status, 'saved');
  });

  it('turning the option on or off applies to the next alert', () => {
    let captures = 0;
    const h = setup({ settings: { captureSnapshot: false, cooldownSec: 1, confirmFrames: 1 }, capture: async () => (captures++, { status: 'saved' }) });
    h.monitor.start();
    h.first(BG());
    h.next(A());
    h.monitor.configure({ captureSnapshot: true });
    h.next(B());
    assert.equal(captures, 1);
    assert.equal(h.events()[1].snapshot.status === 'off', true, 'the first alert had no snapshot');
  });

  it('maps every Smart Snapshot outcome to a motion snapshot status', () => {
    const item = { id: 'snap-7', blob: jpegBlob() } as never;
    const cases: Array<[CaptureOutcome, MotionSnapshotLink]> = [
      [{ status: 'saved', item }, { status: 'saved', snapshotId: 'snap-7' }],
      [{ status: 'session-only', item, error: 'full' }, { status: 'session-only', snapshotId: 'snap-7', note: 'full' }],
      [{ status: 'failed', failure: { kind: 'blocked', message: 'blocked' } }, { status: 'failed', note: 'blocked' }],
      [{ status: 'busy' }, { status: 'skipped', note: 'Another snapshot was already being captured.' }],
    ];
    for (const [outcome, expected] of cases) assert.deepEqual(linkFromCaptureOutcome(outcome), expected);
  });
});

describe('listener for new alerts (used by AI recognition)', () => {
  it('is told about each new alert exactly once, with the event that was recorded', () => {
    const heard: MotionEvent[] = [];
    const h = setup({ settings: { cooldownSec: 15 }, onMotionEvent: (e) => heard.push(e) });
    h.monitor.start();
    h.first(BG());
    let flip = false;
    for (let i = 0; i < 10; i++) {
      h.next(flip ? B() : A());
      flip = !flip;
    }
    assert.equal(heard.length, 1, 'constant motion inside the cooldown is one alert, so one notification');
    assert.deepEqual(heard[0], h.events()[0]);
    assert.equal(heard[0].snapshot.status, 'off');
  });

  it('tells it when a snapshot is pending, so the listener can avoid taking a second one', () => {
    const heard: MotionEvent[] = [];
    const h = setup({ settings: { captureSnapshot: true }, capture: async () => ({ status: 'saved', snapshotId: 's1' }), onMotionEvent: (e) => heard.push(e) });
    h.monitor.start();
    h.first(BG());
    h.next(A());
    h.next(B());
    assert.equal(heard[0].snapshot.status, 'pending');
  });

  it('a listener that throws does not disturb detection, history or the snapshot', async () => {
    const h = setup({
      settings: { captureSnapshot: true },
      capture: async () => ({ status: 'saved', snapshotId: 's1' }),
      onMotionEvent: () => {
        throw new Error('listener exploded');
      },
    });
    h.monitor.start();
    h.first(BG());
    h.next(A());
    h.next(B());
    assert.equal(h.events().length, 1);
    await flush();
    assert.equal(h.events()[0].snapshot.status, 'saved');
    assert.equal(h.state().status, 'motion');
  });

  it('is optional', () => {
    const h = setup();
    h.monitor.start();
    h.first(BG());
    h.next(A());
    h.next(B());
    assert.equal(h.events().length, 1);
  });
});

describe('cleanup', () => {
  it('shutdown (the panel unmounts) leaves no timer, listener or canvas behind, and stale callbacks do nothing', () => {
    const h = setup();
    reachActive(h);
    const releases = h.sampler.releases;
    h.monitor.shutdown();
    assert.equal(h.clock.pendingTimers(), 0);
    assert.equal(h.visibility.listeners.size, 0);
    assert.ok(h.sampler.releases > releases);
    assert.equal(h.state().status, 'off');
    const samples = h.sampler.samples;
    h.clock.advance(600_000);
    assert.equal(h.sampler.samples, samples);
    h.monitor.shutdown(); // idempotent
    h.visibility.set(false); // nobody is listening any more
    assert.equal(h.state().status, 'off');
  });

  it('can be started again after a shutdown (React may remount)', () => {
    const h = setup();
    reachActive(h);
    h.monitor.shutdown();
    h.monitor.start();
    h.first(quiet(1));
    h.next(quiet(2));
    assert.equal(h.state().status, 'active');
    assert.equal(h.clock.pendingTimers(), 1);
  });

  it('keeps no timer after a long run with every kind of interruption', () => {
    const h = setup();
    h.monitor.start();
    for (let round = 0; round < 6; round++) {
      h.first(quiet(round * 3 + 1));
      h.next(quiet(round * 3 + 2));
      h.visibility.set(false);
      h.visibility.set(true);
      h.monitor.setCamera({ viewing: true, connected: false, statusLabel: 'reconnecting' });
      h.monitor.setCamera({ viewing: true, connected: true, statusLabel: 'connected' });
      assert.ok(h.clock.pendingTimers() <= 1);
    }
    h.monitor.stop();
    assert.equal(h.clock.pendingTimers(), 0);
  });
});

describe('settings and state', () => {
  it('configure() normalizes, saves and applies the new settings', () => {
    const h = setup();
    h.monitor.configure({ sensitivity: 'high', cooldownSec: 9999, captureSnapshot: true });
    assert.equal(h.state().settings.sensitivity, 'high');
    assert.equal(h.state().settings.cooldownSec, 600, 'clamped');
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].captureSnapshot, true);
  });

  it('changing the sensitivity restarts the confirmation streak', () => {
    const h = setup();
    h.monitor.start();
    h.first(BG());
    h.next(A()); // streak 1
    h.monitor.configure({ sensitivity: 'low' });
    h.next(B()); // streak would have been 2
    assert.equal(h.events().length, 0);
  });

  it('keeps the same state object until something changes (useSyncExternalStore contract)', () => {
    const h = setup();
    const s = h.state();
    assert.equal(h.state(), s);
    h.monitor.start();
    assert.notEqual(h.state(), s);
    const s2 = h.state();
    assert.equal(h.state(), s2);
  });

  it('reports the measurements it uses for the live readout', () => {
    const h = setup({ settings: { confirmFrames: 3 } });
    h.monitor.start();
    h.first(BG());
    h.next(A());
    assert.equal(h.state().framesCompared, 1);
    assert.ok(Math.abs((h.state().lastChangedPercent ?? 0) - 15.625) < 1e-9);
    assert.equal(h.state().lastCheckAt, h.clock.now());
  });
});

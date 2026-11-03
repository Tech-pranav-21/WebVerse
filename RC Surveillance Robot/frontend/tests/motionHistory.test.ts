/**
 * Motion detection: event history storage and the clear-confirmation gate (MOCKED storage and clock).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_HISTORY_KEY,
  MOTION_HISTORY_MAX_BYTES,
  MOTION_HISTORY_MAX_EVENTS,
  MotionHistory,
} from '../src/services/motionHistory';
import { ConfirmGate } from '../src/services/confirmGate';
import type { MotionEvent } from '../src/types/motion';
import { FakeClock, FakeStore } from './helpers';

function ev(n: number, over: Partial<MotionEvent> = {}): MotionEvent {
  return {
    id: `e${n}`,
    t: 1_000_000 + n * 1000,
    changedPercent: 7.5,
    thresholdPercent: 4,
    pixelThreshold: 28,
    sensitivity: 'medium',
    confirmFrames: 2,
    region: 'full',
    snapshot: { status: 'off' },
    ...over,
  };
}

describe('MotionHistory', () => {
  it('records events with their measurements and lists them newest first', () => {
    const h = new MotionHistory({ store: new FakeStore() });
    h.add(ev(1));
    h.add(ev(2, { changedPercent: 12.3, sensitivity: 'high', region: 'left' }));
    const { events } = h.getSnapshot();
    assert.deepEqual(events.map((e) => e.id), ['e2', 'e1']);
    assert.equal(events[0].changedPercent, 12.3);
    assert.equal(events[0].sensitivity, 'high');
    assert.equal(events[0].region, 'left');
    assert.equal(events[0].thresholdPercent, 4);
    assert.equal(events[0].pixelThreshold, 28);
    assert.equal(events[0].confirmFrames, 2);
  });

  it('keeps the same snapshot object until something changes, and notifies subscribers', () => {
    const h = new MotionHistory({ store: new FakeStore() });
    const a = h.getSnapshot();
    assert.equal(h.getSnapshot(), a);
    let calls = 0;
    const off = h.subscribe(() => calls++);
    h.add(ev(1));
    assert.equal(calls, 1);
    assert.notEqual(h.getSnapshot(), a);
    off();
    h.add(ev(2));
    assert.equal(calls, 1);
  });

  it('survives a page reload: a new instance on the same storage finds the events', () => {
    const store = new FakeStore();
    const first = new MotionHistory({ store });
    first.add(ev(1));
    first.add(ev(2, { snapshot: { status: 'saved', snapshotId: 'snap-9' } }));
    const reloaded = new MotionHistory({ store });
    assert.deepEqual(reloaded.getSnapshot().events.map((e) => e.id), ['e2', 'e1']);
    assert.deepEqual(reloaded.getSnapshot().events[0].snapshot, { status: 'saved', snapshotId: 'snap-9' });
    assert.equal(reloaded.getSnapshot().storage.status, 'persistent');
  });

  it('is bounded: only the newest MOTION_HISTORY_MAX_EVENTS are kept, in memory and in storage', () => {
    assert.equal(MOTION_HISTORY_MAX_EVENTS, 100);
    const store = new FakeStore();
    const h = new MotionHistory({ store, maxEvents: 5 });
    for (let i = 1; i <= 8; i++) h.add(ev(i));
    assert.deepEqual(h.getSnapshot().events.map((e) => e.id), ['e8', 'e7', 'e6', 'e5', 'e4']);
    assert.equal(JSON.parse(store.data.get(MOTION_HISTORY_KEY)!).events.length, 5, 'the stored copy is bounded too');
    assert.equal(new MotionHistory({ store, maxEvents: 5 }).getSnapshot().events.length, 5);
  });

  it('keeps the stored JSON under the byte limit and the newest events win', () => {
    assert.equal(MOTION_HISTORY_MAX_BYTES, 40_000);
    const store = new FakeStore();
    const h = new MotionHistory({ store, maxEvents: 500, maxBytes: 1500 });
    for (let i = 1; i <= 40; i++) h.add(ev(i));
    assert.ok(store.data.get(MOTION_HISTORY_KEY)!.length <= 1500);
    const ids = h.getSnapshot().events.map((e) => e.id);
    assert.equal(ids[0], 'e40');
    assert.ok(ids.length < 40 && ids.length >= 1);
  });

  it('a full browser store keeps the newest half and says so; a blocked one falls back to memory with the reason', () => {
    const quota = new FakeStore();
    const h = new MotionHistory({ store: quota });
    for (let i = 1; i <= 4; i++) h.add(ev(i));
    const oneEventLength = JSON.stringify({ v: 1, events: [ev(1)] }).length;
    quota.maxValueLength = oneEventLength * 3; // room for a few events, not all
    h.add(ev(5));
    assert.equal(h.getSnapshot().storage.status, 'persistent');
    assert.match(h.getSnapshot().storage.reason ?? '', /nearly full/);

    const blocked = new FakeStore();
    blocked.failSet = new Error('SecurityError: blocked');
    const m = new MotionHistory({ store: blocked });
    m.add(ev(1));
    assert.equal(m.getSnapshot().events.length, 1, 'the event is still shown');
    assert.equal(m.getSnapshot().storage.status, 'memory-only');
    assert.match(m.getSnapshot().storage.reason ?? '', /full or blocked/);
  });

  it('works in memory when there is no storage at all', () => {
    const h = new MotionHistory({ store: null });
    h.add(ev(1));
    assert.equal(h.getSnapshot().events.length, 1);
    assert.equal(h.getSnapshot().storage.status, 'memory-only');
  });

  it('reports unreadable storage and discards damaged, wrongly versioned or invalid data', () => {
    const unreadable = new FakeStore();
    unreadable.failGet = new Error('blocked');
    assert.equal(new MotionHistory({ store: unreadable }).getSnapshot().storage.status, 'memory-only');

    const garbage = new FakeStore();
    garbage.data.set(MOTION_HISTORY_KEY, '{nope');
    const g = new MotionHistory({ store: garbage });
    assert.equal(g.getSnapshot().events.length, 0);
    assert.match(g.getSnapshot().storage.reason ?? '', /unreadable/);

    const wrongVersion = new FakeStore();
    wrongVersion.data.set(MOTION_HISTORY_KEY, JSON.stringify({ v: 99, events: [ev(1)] }));
    assert.match(new MotionHistory({ store: wrongVersion }).getSnapshot().storage.reason ?? '', /unknown format/);

    const mixed = new FakeStore();
    mixed.data.set(
      MOTION_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        events: [ev(1), { id: 5 }, null, 'x', ev(2, { sensitivity: 'extreme' as never }), ev(3, { region: 'diagonal' as never }), ev(1), ev(4)],
      }),
    );
    assert.deepEqual(new MotionHistory({ store: mixed }).getSnapshot().events.map((e) => e.id), ['e4', 'e1'], 'invalid entries and duplicate ids are dropped');
  });

  it('a snapshot that was still being captured when the page closed is shown as failed, not as forever pending', () => {
    const store = new FakeStore();
    const first = new MotionHistory({ store });
    first.add(ev(1, { snapshot: { status: 'pending' } }));
    const reloaded = new MotionHistory({ store });
    assert.equal(reloaded.getSnapshot().events[0].snapshot.status, 'failed');
    assert.match(reloaded.getSnapshot().events[0].snapshot.note ?? '', /closed before/);
  });

  it('updateSnapshot records the outcome, persists it, and ignores unknown ids', () => {
    const store = new FakeStore();
    const h = new MotionHistory({ store });
    h.add(ev(1, { snapshot: { status: 'pending' } }));
    h.updateSnapshot('e1', { status: 'failed', note: 'blocked by http://user:secret@10.0.0.5/stream' });
    h.updateSnapshot('nope', { status: 'saved' });
    const saved = h.getSnapshot().events[0].snapshot;
    assert.equal(saved.status, 'failed');
    assert.ok(!JSON.stringify(saved).includes('secret'), 'credentials in a message never reach storage');
    assert.equal(new MotionHistory({ store }).getSnapshot().events[0].snapshot.status, 'failed');
  });

  it('clear() removes the events from memory and from storage', () => {
    const store = new FakeStore();
    const h = new MotionHistory({ store });
    h.add(ev(1));
    h.add(ev(2));
    h.clear();
    assert.equal(h.getSnapshot().events.length, 0);
    assert.equal(store.data.has(MOTION_HISTORY_KEY), false);
    assert.equal(new MotionHistory({ store }).getSnapshot().events.length, 0);
  });

  it('clear() still empties the list if the key cannot be removed (it overwrites it with an empty list)', () => {
    const store = new FakeStore();
    const h = new MotionHistory({ store });
    h.add(ev(1));
    store.failRemove = new Error('locked');
    h.clear();
    assert.equal(h.getSnapshot().events.length, 0);
    assert.equal(JSON.parse(store.data.get(MOTION_HISTORY_KEY)!).events.length, 0);
  });
});

describe('ConfirmGate (clear history asks twice)', () => {
  it('the first request only asks; the second one performs the action once', () => {
    const clock = new FakeClock();
    const gate = new ConfirmGate(6000, clock);
    let runs = 0;
    assert.equal(gate.request(() => runs++), false);
    assert.equal(runs, 0, 'nothing is cleared by the first click');
    assert.equal(gate.getSnapshot(), true, 'the "really?" question is showing');
    assert.equal(gate.request(() => runs++), true);
    assert.equal(runs, 1);
    assert.equal(gate.getSnapshot(), false);
    assert.equal(clock.pendingTimers(), 0);
  });

  it('the question expires, so a late click starts over instead of deleting', () => {
    const clock = new FakeClock();
    const gate = new ConfirmGate(6000, clock);
    let runs = 0;
    gate.request(() => runs++);
    clock.advance(5999);
    assert.equal(gate.getSnapshot(), true);
    clock.advance(1);
    assert.equal(gate.getSnapshot(), false);
    assert.equal(gate.request(() => runs++), false, 'a click after the timeout only asks again');
    assert.equal(runs, 0);
  });

  it('cancel() withdraws the question and its timer', () => {
    const clock = new FakeClock();
    const gate = new ConfirmGate(6000, clock);
    let runs = 0;
    gate.request(() => runs++);
    gate.cancel();
    assert.equal(gate.getSnapshot(), false);
    assert.equal(clock.pendingTimers(), 0);
    assert.equal(gate.request(() => runs++), false);
    assert.equal(runs, 0);
  });

  it('notifies subscribers when it arms and disarms', () => {
    const clock = new FakeClock();
    const gate = new ConfirmGate(1000, clock);
    const seen: boolean[] = [];
    const off = gate.subscribe(() => seen.push(gate.getSnapshot()));
    gate.request(() => {});
    clock.advance(1000);
    gate.request(() => {});
    gate.request(() => {});
    off();
    assert.deepEqual(seen, [true, false, true, false]);
  });
});

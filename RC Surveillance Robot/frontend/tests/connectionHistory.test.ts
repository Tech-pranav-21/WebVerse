/**
 * ConnectionHistory: typed events, de-duplication, caps, persistence and clearing.
 * MOCKED: a fake clock and a fake localStorage with failure injection. Real browser storage
 * behaviour (quota size, private mode, multi-tab) is documented, not tested here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION_HISTORY_KEY, ConnectionHistory } from '../src/services/connectionHistory';
import { FakeClock, FakeStore } from './helpers';

function mk(opts: { store?: FakeStore | null; maxEvents?: number; maxBytes?: number } = {}) {
  const clock = new FakeClock();
  const store = opts.store === undefined ? new FakeStore() : opts.store;
  const history = new ConnectionHistory({ clock, store, maxEvents: opts.maxEvents, maxBytes: opts.maxBytes });
  return { clock, store, history };
}

describe('recording', () => {
  it('stores a typed event with its default severity and the time it happened', () => {
    const { clock, history } = mk();
    clock.advance(500);
    const e = history.record({ type: 'stream_disconnected', message: 'Stream lost: reset' });
    assert.equal(e.type, 'stream_disconnected');
    assert.equal(e.severity, 'error');
    assert.equal(e.t, clock.now());
    assert.equal(e.count, 1);
    assert.equal(history.getEvents().length, 1);
    assert.equal(history.record({ type: 'reconnect_succeeded', message: 'ok' }).severity, 'ok');
    assert.equal(history.record({ type: 'host_unreachable', message: 'x' }).severity, 'warn');
    assert.equal(history.record({ type: 'stream_connecting', message: 'x' }).severity, 'info');
  });

  it('lets the caller override the severity', () => {
    const { history } = mk();
    assert.equal(history.record({ type: 'host_unreachable', severity: 'error', message: 'x' }).severity, 'error');
  });

  it('returns copies, so callers cannot change the stored log', () => {
    const { history } = mk();
    history.record({ type: 'config_changed', message: 'a' });
    history.getEvents()[0].message = 'tampered';
    assert.equal(history.getEvents()[0].message, 'a');
  });

  it('removes secrets and caps the length of stored messages', () => {
    const { history } = mk();
    const e = history.record({ type: 'stream_disconnected', message: `failed http://admin:pw@10.0.0.5/s?token=abc ${'x'.repeat(500)}` });
    assert.ok(!e.message.includes('pw@'));
    assert.ok(!e.message.includes('token=abc'));
    assert.ok(e.message.length <= 240);
  });
});

describe('duplicate prevention during one continuous failure', () => {
  it('folds events with the same dedupeKey into one entry with a repeat count', () => {
    const { clock, history } = mk();
    history.record({ type: 'reconnect_failed', message: 'timed out', dedupeKey: 'timeout' });
    clock.advance(5000);
    history.record({ type: 'reconnect_failed', message: 'timed out', dedupeKey: 'timeout' });
    clock.advance(5000);
    const third = history.record({ type: 'reconnect_failed', message: 'timed out', dedupeKey: 'timeout' });
    const events = history.getEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].count, 3);
    assert.equal(events[0].lastT - events[0].t, 10000);
    assert.equal(third.count, 3);
  });

  it('keeps events with a different key or a different type apart', () => {
    const { history } = mk();
    history.record({ type: 'reconnect_failed', message: 'a', dedupeKey: 'one' });
    history.record({ type: 'reconnect_failed', message: 'b', dedupeKey: 'two' });
    history.record({ type: 'stream_disconnected', message: 'c', dedupeKey: 'one' });
    assert.equal(history.getEvents().length, 3);
  });

  it('never folds an event that has no dedupeKey', () => {
    const { history } = mk();
    history.record({ type: 'reconnect_started', message: 'attempt 1' });
    history.record({ type: 'reconnect_started', message: 'attempt 1' });
    assert.equal(history.getEvents().length, 2);
  });

  it('starts a new entry once the episode has ended', () => {
    const { history } = mk();
    history.record({ type: 'reconnect_failed', message: 'x', dedupeKey: 'k' });
    history.record({ type: 'reconnect_failed', message: 'x', dedupeKey: 'k' });
    history.endEpisode();
    history.record({ type: 'reconnect_failed', message: 'x', dedupeKey: 'k' });
    const events = history.getEvents();
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.count), [2, 1]);
  });

  it('does not fold into an entry that has already been dropped by the cap', () => {
    const { history } = mk({ maxEvents: 3 });
    history.record({ type: 'reconnect_failed', message: 'x', dedupeKey: 'k' });
    for (let i = 0; i < 3; i++) history.record({ type: 'config_changed', message: `c${i}` });
    history.record({ type: 'reconnect_failed', message: 'x', dedupeKey: 'k' });
    const events = history.getEvents();
    assert.equal(events.length, 3);
    assert.equal(events[events.length - 1].count, 1);
  });
});

describe('memory is bounded', () => {
  it('keeps only the newest maxEvents', () => {
    const { history } = mk({ maxEvents: 5 });
    for (let i = 0; i < 12; i++) history.record({ type: 'config_changed', message: `event ${i}` });
    const events = history.getEvents();
    assert.equal(events.length, 5);
    assert.equal(events[0].message, 'event 7');
    assert.equal(events[4].message, 'event 11');
  });

  it('keeps the stored JSON under maxBytes', () => {
    const { store, history } = mk({ maxBytes: 2000 });
    for (let i = 0; i < 100; i++) history.record({ type: 'config_changed', message: `event number ${i} with some text` });
    assert.ok(store!.data.get(CONNECTION_HISTORY_KEY)!.length <= 2000);
    const events = history.getEvents();
    assert.ok(events.length < 100);
    assert.equal(events[events.length - 1].message, 'event number 99 with some text', 'newest event must survive');
  });
});

describe('persistence', () => {
  it('writes every change to storage and reports it as persistent', () => {
    const { store, history } = mk();
    history.record({ type: 'stream_connecting', message: 'a' });
    const saved = JSON.parse(store!.data.get(CONNECTION_HISTORY_KEY)!);
    assert.equal(saved.v, 1);
    assert.equal(saved.events.length, 1);
    assert.equal(history.getStorageInfo().status, 'persistent');
  });

  it('restores earlier events after a reload, marks them as restored and keeps ids unique', () => {
    const first = mk();
    first.history.record({ type: 'stream_disconnected', message: 'old failure' });
    first.history.record({ type: 'reconnect_succeeded', message: 'old recovery' });
    const second = new ConnectionHistory({ clock: first.clock, store: first.store });
    const loaded = second.getEvents();
    assert.equal(loaded.length, 2);
    assert.ok(loaded.every((e) => e.restored === true));
    const fresh = second.record({ type: 'stream_connecting', message: 'new' });
    assert.ok(fresh.id > loaded[1].id);
    assert.equal(second.getEvents()[2].restored, undefined);
    assert.ok(!first.store!.data.get(CONNECTION_HISTORY_KEY)!.includes('restored'), 'restored is never written');
  });

  it('does not carry the failure episode across a reload', () => {
    const first = mk();
    first.history.record({ type: 'reconnect_failed', message: 'x', dedupeKey: 'k' });
    const second = new ConnectionHistory({ clock: first.clock, store: first.store });
    second.record({ type: 'reconnect_failed', message: 'x', dedupeKey: 'k' });
    assert.equal(second.getEvents().length, 2);
  });

  it('discards unreadable data instead of trusting it, and says so', () => {
    const store = new FakeStore();
    store.data.set(CONNECTION_HISTORY_KEY, '{not json');
    const h = new ConnectionHistory({ store });
    assert.deepEqual(h.getEvents(), []);
    assert.equal(h.getStorageInfo().status, 'persistent');
    assert.match(h.getStorageInfo().reason ?? '', /unreadable/);
  });

  it('discards data in an unknown format', () => {
    const store = new FakeStore();
    store.data.set(CONNECTION_HISTORY_KEY, JSON.stringify({ v: 99, events: [] }));
    assert.deepEqual(new ConnectionHistory({ store }).getEvents(), []);
    store.data.set(CONNECTION_HISTORY_KEY, JSON.stringify([1, 2, 3]));
    assert.deepEqual(new ConnectionHistory({ store }).getEvents(), []);
  });

  it('skips invalid entries and sanitises the valid ones', () => {
    const store = new FakeStore();
    const good = { id: 7, t: 1000, lastT: 900, count: -4, type: 'host_unreachable', severity: 'warn', message: 'see http://u:p@h/x?token=zzz' };
    store.data.set(
      CONNECTION_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        events: [
          good,
          { id: 8, t: 1, type: 'not_a_type', severity: 'warn', message: 'x' },
          { id: 9, t: 1, type: 'host_unreachable', severity: 'loud', message: 'x' },
          { id: 10, t: 'later', type: 'host_unreachable', severity: 'warn', message: 'x' },
          { id: 0, t: 1, type: 'host_unreachable', severity: 'warn', message: 'x' },
          { id: 11, t: 1, type: 'host_unreachable', severity: 'warn', message: 42 },
          null,
          'text',
        ],
      }),
    );
    const h = new ConnectionHistory({ store });
    const events = h.getEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].count, 1, 'a bad count is reset');
    assert.equal(events[0].lastT, 1000, 'lastT earlier than t is repaired');
    assert.ok(!events[0].message.includes('token=zzz'));
    assert.ok(!events[0].message.includes('u:p@'));
    assert.equal(h.record({ type: 'config_changed', message: 'n' }).id, 8);
  });

  it('only loads the newest maxEvents', () => {
    const first = mk({ maxEvents: 50 });
    for (let i = 0; i < 40; i++) first.history.record({ type: 'config_changed', message: `e${i}` });
    const small = new ConnectionHistory({ store: first.store, maxEvents: 10 });
    const events = small.getEvents();
    assert.equal(events.length, 10);
    assert.equal(events[9].message, 'e39');
  });
});

describe('storage that is missing or failing', () => {
  it('works in memory and says so when there is no store', () => {
    const { history } = mk({ store: null });
    history.record({ type: 'stream_connecting', message: 'a' });
    assert.equal(history.getEvents().length, 1);
    assert.equal(history.getStorageInfo().status, 'memory-only');
    assert.ok(history.getStorageInfo().reason);
  });

  it('keeps recording when writes are blocked, reports memory-only, and recovers when writes work again', () => {
    const { store, history } = mk();
    store!.failSet = new Error('SecurityError');
    history.record({ type: 'stream_connecting', message: 'a' });
    assert.equal(history.getEvents().length, 1);
    assert.equal(history.getStorageInfo().status, 'memory-only');
    assert.match(history.getStorageInfo().reason ?? '', /SecurityError/);
    store!.failSet = null;
    history.record({ type: 'stream_first_frame', message: 'b' });
    assert.equal(history.getStorageInfo().status, 'persistent');
    assert.equal(JSON.parse(store!.data.get(CONNECTION_HISTORY_KEY)!).events.length, 2);
  });

  it('retries with the newest half when the quota is exceeded', () => {
    const { store, history } = mk();
    for (let i = 0; i < 20; i++) history.record({ type: 'config_changed', message: `event ${i}` });
    store!.maxValueLength = 1700; // the full log no longer fits, the newest half does
    history.record({ type: 'config_changed', message: 'event 20' });
    const saved = JSON.parse(store!.data.get(CONNECTION_HISTORY_KEY)!);
    assert.ok(saved.events.length < 21 && saved.events.length > 0);
    assert.equal(saved.events[saved.events.length - 1].message, 'event 20');
    assert.equal(history.getStorageInfo().status, 'persistent');
    assert.match(history.getStorageInfo().reason ?? '', /nearly full/);
    assert.equal(history.getEvents().length, 21, 'memory still holds everything');
  });

  it('starts empty and memory-only when storage cannot be read', () => {
    const store = new FakeStore();
    store.failGet = new Error('blocked');
    const h = new ConnectionHistory({ store });
    assert.deepEqual(h.getEvents(), []);
    assert.equal(h.getStorageInfo().status, 'memory-only');
  });
});

describe('clearing', () => {
  it('empties memory and removes the stored copy', () => {
    const { store, history } = mk();
    history.record({ type: 'stream_connecting', message: 'a' });
    history.record({ type: 'reconnect_failed', message: 'b', dedupeKey: 'k' });
    history.clear();
    assert.deepEqual(history.getEvents(), []);
    assert.equal(store!.data.has(CONNECTION_HISTORY_KEY), false);
    assert.deepEqual(new ConnectionHistory({ store }).getEvents(), [], 'nothing comes back after a reload');
  });

  it('keeps working afterwards, never reuses an id, and no longer folds into cleared entries', () => {
    const { history } = mk();
    const before = history.record({ type: 'reconnect_failed', message: 'b', dedupeKey: 'k' });
    history.clear();
    const after = history.record({ type: 'reconnect_failed', message: 'b', dedupeKey: 'k' });
    assert.ok(after.id > before.id);
    assert.equal(after.count, 1);
    assert.equal(history.getEvents().length, 1);
  });

  it('overwrites with an empty log when the key cannot be removed', () => {
    const { store, history } = mk();
    history.record({ type: 'stream_connecting', message: 'a' });
    store!.failRemove = new Error('no remove');
    history.clear();
    assert.deepEqual(JSON.parse(store!.data.get(CONNECTION_HISTORY_KEY)!).events, []);
    assert.equal(history.getStorageInfo().status, 'persistent');
  });

  it('works without a store', () => {
    const { history } = mk({ store: null });
    history.record({ type: 'stream_connecting', message: 'a' });
    assert.doesNotThrow(() => history.clear());
    assert.deepEqual(history.getEvents(), []);
  });
});

describe('page-load markers', () => {
  it('records one marker per page load', () => {
    const { history } = mk();
    history.startSession('abc');
    history.startSession('abc');
    const markers = history.getEvents().filter((e) => e.type === 'session_started');
    assert.equal(markers.length, 1);
    assert.equal(markers[0].session, 'abc');
  });

  it('does not add a second marker when the same page load creates the history twice (StrictMode)', () => {
    const first = mk();
    first.history.startSession('page-1');
    const second = new ConnectionHistory({ clock: first.clock, store: first.store });
    second.startSession('page-1');
    const events = second.getEvents();
    assert.equal(events.filter((e) => e.type === 'session_started').length, 1);
    assert.ok(events.every((e) => !e.restored), 'same page load: nothing is "earlier"');
  });

  it('adds a new marker on a real reload and keeps the old events as restored', () => {
    const first = mk();
    first.history.startSession('page-1');
    first.history.record({ type: 'stream_disconnected', message: 'old' });
    const second = new ConnectionHistory({ clock: first.clock, store: first.store });
    second.startSession('page-2');
    const events = second.getEvents();
    assert.equal(events.length, 3);
    assert.deepEqual(events.map((e) => !!e.restored), [true, true, false]);
    assert.equal(events[2].session, 'page-2');
  });
});

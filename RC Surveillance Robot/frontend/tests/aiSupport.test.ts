/**
 * AI recognition support code: settings, event history, the browser-side client, the motion event
 * bus and snapshot text. MOCKED: fake storage and a fake `fetch`; no backend, Groq or camera.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AiClientError, blobToBase64, createAiClient } from '../src/services/aiClient';
import { AI_HISTORY_KEY, AI_HISTORY_MAX_BYTES, AI_HISTORY_MAX_EVENTS, AiHistory } from '../src/services/aiHistory';
import {
  AI_SETTINGS_KEY,
  DEFAULT_AI_SETTINGS,
  anyCategoryEnabled,
  loadAiSettings,
  normalizeAiSettings,
  saveAiSettings,
} from '../src/services/aiSettings';
import { MotionEventBus } from '../src/services/motionEventBus';
import { describeSnapshotLink } from '../src/services/snapshotLinkText';
import type { AiEvent } from '../src/types/ai';
import { FakeStore } from './helpers';
import { jpegBlob } from './snapshotFakes';
import { motionEvent, okResponse, personObject, readyStatus } from './aiFakes';

describe('AI settings', () => {
  it('everything that sends images outside the computer is off by default', () => {
    const d = DEFAULT_AI_SETTINGS;
    assert.equal(d.enabled, false);
    assert.equal(d.autoOnMotion, false);
    assert.equal(d.autoAcknowledged, false);
    assert.equal(d.retainSnapshot, false);
    assert.deepEqual(d.categories, { person: true, animal: true, vehicle: true, other: false });
    assert.equal(d.cooldownSec, 60);
  });

  it('automatic mode is only ever on with the acknowledgement', () => {
    assert.equal(normalizeAiSettings({ enabled: true, autoOnMotion: true }).autoOnMotion, false);
    assert.equal(normalizeAiSettings({ enabled: true, autoOnMotion: true, autoAcknowledged: true }).autoOnMotion, true);
    assert.equal(normalizeAiSettings({ autoOnMotion: 'yes', autoAcknowledged: 'yes' }).autoAcknowledged, false, 'only a real boolean counts');
  });

  it('normalizes damaged input instead of trusting it', () => {
    const s = normalizeAiSettings({ enabled: 1, cooldownSec: -50, categories: { person: 'no', animal: false, bogus: true }, retainSnapshot: 'true' });
    assert.equal(s.enabled, false);
    assert.equal(s.cooldownSec, 5);
    assert.equal(s.categories.person, true, 'a non-boolean falls back to the default');
    assert.equal(s.categories.animal, false);
    assert.ok(!('bogus' in s.categories));
    assert.equal(s.retainSnapshot, false);
    assert.equal(normalizeAiSettings({ cooldownSec: 99999 }).cooldownSec, 3600);
    assert.deepEqual(normalizeAiSettings(null), DEFAULT_AI_SETTINGS);
    assert.deepEqual(normalizeAiSettings('garbage'), DEFAULT_AI_SETTINGS);
  });

  it('saves and loads, and falls back to the defaults for missing, damaged or unreadable storage', () => {
    const store = new FakeStore();
    assert.deepEqual(loadAiSettings(store), DEFAULT_AI_SETTINGS);
    assert.equal(saveAiSettings(store, { ...DEFAULT_AI_SETTINGS, enabled: true }), true);
    assert.equal(loadAiSettings(store).enabled, true);
    store.data.set(AI_SETTINGS_KEY, '{nope');
    assert.deepEqual(loadAiSettings(store), DEFAULT_AI_SETTINGS);
    store.failGet = new Error('blocked');
    assert.deepEqual(loadAiSettings(store), DEFAULT_AI_SETTINGS);
    assert.deepEqual(loadAiSettings(null), DEFAULT_AI_SETTINGS);
  });

  it('reports a storage failure when saving, and never stores a key (the settings have no secret field)', () => {
    const store = new FakeStore();
    store.failSet = new Error('QuotaExceededError');
    assert.equal(saveAiSettings(store, DEFAULT_AI_SETTINGS), false);
    assert.equal(saveAiSettings(null, DEFAULT_AI_SETTINGS), false);
    const ok = new FakeStore();
    saveAiSettings(ok, { ...DEFAULT_AI_SETTINGS, enabled: true });
    assert.deepEqual(Object.keys(JSON.parse(ok.data.get(AI_SETTINGS_KEY)!)).sort(), ['autoAcknowledged', 'autoOnMotion', 'categories', 'cooldownSec', 'enabled', 'retainSnapshot']);
  });

  it('anyCategoryEnabled', () => {
    assert.equal(anyCategoryEnabled(DEFAULT_AI_SETTINGS), true);
    assert.equal(anyCategoryEnabled({ ...DEFAULT_AI_SETTINGS, categories: { person: false, animal: false, vehicle: false, other: false } }), false);
  });
});

function aiEvent(n: number, over: Partial<AiEvent> = {}): AiEvent {
  return {
    id: `ai${n}`,
    t: 1_000_000 + n * 1000,
    trigger: 'manual',
    status: 'success',
    model: 'qwen/qwen3.8-27b',
    summary: 'A person near a car.',
    objects: [personObject],
    category: 'person',
    matched: true,
    snapshot: { status: 'off' },
    latencyMs: 1500,
    usage: { promptTokens: 2400, completionTokens: 100 },
    ...over,
  };
}

describe('AiHistory', () => {
  it('records events with the fields the UI needs, newest first, and no picture', () => {
    const h = new AiHistory({ store: new FakeStore() });
    h.add(aiEvent(1));
    h.add(aiEvent(2, { trigger: 'motion', motionEventId: 'mot-1', snapshot: { status: 'saved', snapshotId: 'snap-7' } }));
    const [newest, older] = h.getSnapshot().events;
    assert.equal(newest.id, 'ai2');
    assert.equal(newest.trigger, 'motion');
    assert.equal(newest.motionEventId, 'mot-1');
    assert.deepEqual(newest.snapshot, { status: 'saved', snapshotId: 'snap-7' });
    assert.equal(older.status, 'success');
    assert.ok(!JSON.stringify(newest).includes('data:image'), 'no image data in a history record');
    assert.ok(!('blob' in newest) && !('imageBase64' in newest));
  });

  it('records failures with the reason', () => {
    const h = new AiHistory({ store: new FakeStore() });
    h.add(aiEvent(1, { status: 'failed', objects: [], category: 'none', matched: false, error: { code: 'rate_limited', message: 'Groq is rate limiting requests.' } }));
    const e = h.getSnapshot().events[0];
    assert.equal(e.status, 'failed');
    assert.deepEqual(e.error, { code: 'rate_limited', message: 'Groq is rate limiting requests.' });
  });

  it('survives a reload, with its snapshot links', () => {
    const store = new FakeStore();
    new AiHistory({ store }).add(aiEvent(1, { snapshot: { status: 'saved', snapshotId: 's1' } }));
    const reloaded = new AiHistory({ store }).getSnapshot();
    assert.equal(reloaded.events.length, 1);
    assert.deepEqual(reloaded.events[0].snapshot, { status: 'saved', snapshotId: 's1' });
    assert.equal(reloaded.storage.status, 'persistent');
  });

  it('is bounded in count and in stored size, keeping the newest', () => {
    assert.equal(AI_HISTORY_MAX_EVENTS, 50);
    assert.equal(AI_HISTORY_MAX_BYTES, 60_000);
    const store = new FakeStore();
    const h = new AiHistory({ store, maxEvents: 4 });
    for (let i = 1; i <= 9; i++) h.add(aiEvent(i));
    assert.deepEqual(h.getSnapshot().events.map((e) => e.id), ['ai9', 'ai8', 'ai7', 'ai6']);
    assert.equal(JSON.parse(store.data.get(AI_HISTORY_KEY)!).events.length, 4);

    const small = new FakeStore();
    const capped = new AiHistory({ store: small, maxEvents: 500, maxBytes: 2000 });
    for (let i = 1; i <= 40; i++) capped.add(aiEvent(i));
    assert.ok(small.data.get(AI_HISTORY_KEY)!.length <= 2000);
    assert.equal(capped.getSnapshot().events[0].id, 'ai40');
  });

  it('keeps only a few objects per event, so one chatty answer cannot fill the storage', () => {
    const h = new AiHistory({ store: new FakeStore() });
    h.add(aiEvent(1, { objects: Array.from({ length: 10 }, (_, i) => ({ ...personObject, label: `p${i}` })) }));
    assert.equal(h.getSnapshot().events[0].objects.length, 6);
  });

  it('validates what it loads: damaged, unknown or tampered data is discarded', () => {
    const garbage = new FakeStore();
    garbage.data.set(AI_HISTORY_KEY, '{nope');
    assert.match(new AiHistory({ store: garbage }).getSnapshot().storage.reason ?? '', /unreadable/);

    const wrongVersion = new FakeStore();
    wrongVersion.data.set(AI_HISTORY_KEY, JSON.stringify({ v: 2, events: [aiEvent(1)] }));
    assert.match(new AiHistory({ store: wrongVersion }).getSnapshot().storage.reason ?? '', /unknown format/);

    const mixed = new FakeStore();
    mixed.data.set(
      AI_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        events: [
          aiEvent(1),
          { id: 7 },
          null,
          aiEvent(2, { trigger: 'robot' as never }),
          aiEvent(3, { status: 'maybe' as never }),
          aiEvent(4, { category: 'spaceship' as never }),
          aiEvent(1),
          { ...aiEvent(5), objects: [{ label: 'x', category: 'bogus', description: 5, uncertain: false }, 'no', null] },
          aiEvent(6, { status: 'failed', error: undefined, objects: [], category: 'none', matched: false }),
        ],
      }),
    );
    const events = new AiHistory({ store: mixed }).getSnapshot().events;
    assert.deepEqual(events.map((e) => e.id), ['ai6', 'ai5', 'ai1'], 'invalid entries and duplicate ids are dropped');
    assert.equal(events[1].objects.length, 1);
    assert.equal(events[1].objects[0].category, 'unknown', 'an invalid category becomes unknown');
    assert.equal(events[1].objects[0].description, '', 'a wrong-typed description is emptied');
    assert.ok(events[0].error, 'a failed event always has an error');
  });

  it('reports blocked or full storage without crashing, and keeps the events in memory', () => {
    const blocked = new FakeStore();
    blocked.failSet = new Error('SecurityError');
    const h = new AiHistory({ store: blocked });
    h.add(aiEvent(1));
    assert.equal(h.getSnapshot().events.length, 1);
    assert.equal(h.getSnapshot().storage.status, 'memory-only');

    const unreadable = new FakeStore();
    unreadable.failGet = new Error('nope');
    assert.equal(new AiHistory({ store: unreadable }).getSnapshot().storage.status, 'memory-only');
    const none = new AiHistory({ store: null });
    none.add(aiEvent(1));
    assert.equal(none.getSnapshot().storage.status, 'memory-only');
    assert.equal(none.getSnapshot().events.length, 1);
  });

  it('a pending snapshot that never finished is shown as failed after a reload', () => {
    const store = new FakeStore();
    new AiHistory({ store }).add(aiEvent(1, { snapshot: { status: 'pending' } }));
    assert.equal(new AiHistory({ store }).getSnapshot().events[0].snapshot.status, 'failed');
  });

  it('updateSnapshot persists the outcome and cleans credentials out of notes', () => {
    const store = new FakeStore();
    const h = new AiHistory({ store });
    h.add(aiEvent(1));
    h.updateSnapshot('ai1', { status: 'failed', note: 'could not reach http://user:secret@cam/stream' });
    h.updateSnapshot('nope', { status: 'saved' });
    assert.equal(h.getSnapshot().events[0].snapshot.status, 'failed');
    assert.ok(!store.data.get(AI_HISTORY_KEY)!.includes('secret'));
  });

  it('clear() empties memory and storage, even if the key cannot be removed', () => {
    const store = new FakeStore();
    const h = new AiHistory({ store });
    h.add(aiEvent(1));
    h.clear();
    assert.equal(h.getSnapshot().events.length, 0);
    assert.equal(store.data.has(AI_HISTORY_KEY), false);
    h.add(aiEvent(2));
    store.failRemove = new Error('locked');
    h.clear();
    assert.equal(h.getSnapshot().events.length, 0);
    assert.equal(JSON.parse(store.data.get(AI_HISTORY_KEY)!).events.length, 0);
  });

  it('keeps the same snapshot object until something changes, and notifies subscribers', () => {
    const h = new AiHistory({ store: new FakeStore() });
    const a = h.getSnapshot();
    assert.equal(h.getSnapshot(), a);
    let calls = 0;
    const off = h.subscribe(() => calls++);
    h.add(aiEvent(1));
    assert.equal(calls, 1);
    off();
    h.add(aiEvent(2));
    assert.equal(calls, 1);
  });
});

// ------------------------------------------------------------------ browser client --

function recordingFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return handler(String(input), init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('AI client (browser side)', () => {
  it('blobToBase64 encodes the exact bytes, including large images', async () => {
    const blob = jpegBlob(100_000);
    const b64 = await blobToBase64(blob);
    assert.equal(Buffer.from(b64, 'base64').length, 100_000);
    assert.deepEqual(Buffer.from(b64, 'base64'), Buffer.from(await blob.arrayBuffer()));
  });

  it('posts the image as JSON to the local backend only, with nothing secret in the request', async () => {
    const f = recordingFetch(() => json(okResponse()));
    const client = createAiClient({ fetchImpl: f.fetchImpl });
    const blob = jpegBlob(2000);
    const result = await client.recognize(blob);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, '/api/ai/recognize', 'a same-origin path: the browser never calls Groq');
    assert.equal(f.calls[0].init.method, 'POST');
    assert.deepEqual(f.calls[0].init.headers, { 'Content-Type': 'application/json' }, 'no Authorization header, no key');
    assert.equal(f.calls[0].body.mimeType, 'image/jpeg');
    assert.equal(Buffer.from(f.calls[0].body.imageBase64, 'base64').length, 2000);
    assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['imageBase64', 'mimeType']);
    assert.equal(result.result.objects[0].label, 'person');
  });

  it('reads the backend status', async () => {
    const f = recordingFetch(() => json(readyStatus()));
    const status = await createAiClient({ fetchImpl: f.fetchImpl }).status();
    assert.equal(f.calls[0].url, '/api/ai/status');
    assert.equal(f.calls[0].init.method, 'GET');
    assert.equal(status.model, 'qwen/qwen3.8-27b');
  });

  it('turns a backend error answer into an AiClientError with the code, message and wait', async () => {
    const f = recordingFetch(() => json({ ok: false, error: { code: 'rate_limited', message: 'Too many AI requests.', retryAfterSec: 33 } }, 429));
    await assert.rejects(
      () => createAiClient({ fetchImpl: f.fetchImpl }).recognize(jpegBlob(500)),
      (err: unknown) => err instanceof AiClientError && err.code === 'rate_limited' && err.retryAfterSec === 33 && err.httpStatus === 429 && /Too many/.test(err.message),
    );
  });

  it('reports a backend that is not running (network error, or the dev server\'s HTML error page) with how to start it', async () => {
    const down = recordingFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await assert.rejects(
      () => createAiClient({ fetchImpl: down.fetchImpl }).recognize(jpegBlob(500)),
      (err: unknown) => err instanceof AiClientError && err.code === 'backend_unreachable' && /npm run server/.test(err.message),
    );
    const html = recordingFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await assert.rejects(() => createAiClient({ fetchImpl: html.fetchImpl }).status(), (err: unknown) => err instanceof AiClientError && err.code === 'backend_unreachable');
  });

  it('times out with its own code', async () => {
    const hanging = (async (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    await assert.rejects(
      () => createAiClient({ fetchImpl: hanging, recognizeTimeoutMs: 40 }).recognize(jpegBlob(500)),
      (err: unknown) => err instanceof AiClientError && err.code === 'timeout',
    );
  });

  it('cancels on the caller\'s signal, and does not even send when it is already aborted', async () => {
    const hanging = (async (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    const controller = new AbortController();
    const pending = createAiClient({ fetchImpl: hanging }).recognize(jpegBlob(500), controller.signal);
    setTimeout(() => controller.abort(), 15);
    await assert.rejects(() => pending, (err: unknown) => err instanceof AiClientError && err.code === 'cancelled');

    const f = recordingFetch(() => json(okResponse()));
    const done = new AbortController();
    done.abort();
    await assert.rejects(() => createAiClient({ fetchImpl: f.fetchImpl }).recognize(jpegBlob(500), done.signal), (err: unknown) => err instanceof AiClientError && err.code === 'cancelled');
    assert.equal(f.calls.length, 0);
  });

  it('rejects a success answer of the wrong shape instead of passing it on', async () => {
    for (const body of [{ ok: true }, { ok: true, result: {} }, { ok: true, result: { summary: 1, objects: [] } }, null]) {
      const f = recordingFetch(() => json(body));
      await assert.rejects(() => createAiClient({ fetchImpl: f.fetchImpl }).recognize(jpegBlob(500)), (err: unknown) => err instanceof AiClientError && err.code === 'internal_error');
    }
  });
});

describe('MotionEventBus', () => {
  it('delivers each alert to every listener, and stops after unsubscribe', () => {
    const bus = new MotionEventBus();
    const a: string[] = [];
    const b: string[] = [];
    const offA = bus.subscribe((e) => a.push(e.id));
    bus.subscribe((e) => b.push(e.id));
    bus.emit(motionEvent('m1'));
    offA();
    bus.emit(motionEvent('m2'));
    assert.deepEqual(a, ['m1']);
    assert.deepEqual(b, ['m1', 'm2']);
    assert.equal(bus.listenerCount, 1);
  });

  it('a listener that throws does not stop the others, and listeners cannot change the original event', () => {
    const bus = new MotionEventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('bad listener');
    });
    bus.subscribe((e) => {
      e.snapshot.status = 'failed';
      seen.push(e.id);
    });
    const original = motionEvent('m1');
    bus.emit(original);
    assert.deepEqual(seen, ['m1']);
    assert.equal(original.snapshot.status, 'off');
  });
});

describe('describeSnapshotLink', () => {
  const ids = new Set(['snap-1']);
  it('says what happened to the snapshot, and null when none was asked for', () => {
    assert.equal(describeSnapshotLink({ status: 'off' }, ids), null);
    assert.match(describeSnapshotLink({ status: 'pending' }, ids)!.text, /capturing/);
    assert.equal(describeSnapshotLink({ status: 'saved', snapshotId: 'snap-1' }, ids)!.text, 'Snapshot saved to the gallery');
    assert.match(describeSnapshotLink({ status: 'saved', snapshotId: 'gone' }, ids)!.text, /deleted from the gallery/);
    assert.match(describeSnapshotLink({ status: 'session-only', note: 'full' }, ids)!.text, /not stored.*full/);
    assert.match(describeSnapshotLink({ status: 'failed', note: 'blocked' }, ids)!.text, /failed: blocked/);
    assert.match(describeSnapshotLink({ status: 'skipped', note: 'duplicate' }, ids)!.text, /skipped: duplicate/);
  });
});

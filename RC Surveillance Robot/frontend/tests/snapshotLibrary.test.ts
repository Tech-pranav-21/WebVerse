/**
 * Smart Snapshot: gallery library tests (MOCKED storage).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SNAPSHOTS, SnapshotLibrary } from '../src/services/snapshotLibrary';
import { SnapshotStorageError } from '../src/services/snapshotStorage';
import type { CapturedFrame } from '../src/services/frameCapture';
import { MemoryStorage, jpegBlob, namedError, storedSnapshot } from './snapshotFakes';

const META = { sourceUrl: 'http://10.0.0.5/stream', cameraName: 'ESP32-CAM' };
const capturedFrame = (capturedAt: number): CapturedFrame => ({ blob: jpegBlob(500), width: 640, height: 480, capturedAt });

function make(storage: MemoryStorage | null = new MemoryStorage(), maxItems?: number) {
  let n = 0;
  const library = new SnapshotLibrary({ storage, maxItems, makeId: () => `id-${++n}` });
  return { library, storage };
}

describe('adding snapshots', () => {
  it('keeps the real image data, stores it, and lists newest first with a unique id', async () => {
    const { library, storage } = make();
    const a = await library.add(capturedFrame(1000), META);
    const b = await library.add(capturedFrame(2000), META);

    assert.equal(a.saved, true);
    assert.equal(a.item.persistence, 'saved');
    assert.equal(a.item.mimeType, 'image/jpeg');
    assert.equal(a.item.sizeBytes, 500);
    assert.equal(a.item.width, 640);
    assert.equal(a.item.sourceUrl, META.sourceUrl);
    assert.notEqual(a.item.id, b.item.id);
    assert.deepEqual(library.getSnapshot().items.map((i) => i.timestamp), [2000, 1000]);
    assert.equal(storage!.records.size, 2);
    assert.ok(storage!.records.get(a.item.id)!.blob.size > 0, 'image data is in storage, not just a reference');
  });

  it('keeps a captured image as session-only, with the reason, when the browser refuses to store it', async () => {
    const { library, storage } = make();
    storage!.failPut = new SnapshotStorageError('quota', 'the browser storage for this site is full');
    const result = await library.add(capturedFrame(1000), META);

    assert.equal(result.saved, false);
    assert.match(result.error ?? '', /full/);
    assert.equal(result.item.persistence, 'session');
    assert.match(result.item.persistenceNote ?? '', /full/);
    assert.equal(library.getSnapshot().items.length, 1, 'the image is not thrown away');
    assert.equal(storage!.records.size, 0);
  });

  it('works in memory when the browser has no storage at all', async () => {
    const { library } = make(null);
    assert.equal(library.getSnapshot().storage.status, 'memory-only');
    const result = await library.add(capturedFrame(1000), META);
    assert.equal(result.saved, false);
    assert.equal(result.item.persistence, 'session');
    assert.equal(library.getSnapshot().items.length, 1);
  });

  it('keeps only the newest MAX_SNAPSHOTS and removes evicted ones from storage too', async () => {
    assert.equal(MAX_SNAPSHOTS, 100);
    const { library, storage } = make(new MemoryStorage(), 3);
    for (let t = 1; t <= 5; t++) await library.add(capturedFrame(t * 1000), META);
    assert.deepEqual(library.getSnapshot().items.map((i) => i.timestamp), [5000, 4000, 3000]);
    assert.equal(storage!.records.size, 3, 'evicted snapshots must not reappear after a refresh');
    assert.deepEqual([...storage!.records.values()].map((r) => r.timestamp).sort(), [3000, 4000, 5000]);
  });

  it('notifies subscribers when the gallery changes', async () => {
    const { library } = make();
    let calls = 0;
    const unsubscribe = library.subscribe(() => calls++);
    await library.add(capturedFrame(1), META);
    assert.ok(calls >= 1);
    const seen = calls;
    unsubscribe();
    await library.add(capturedFrame(2), META);
    assert.equal(calls, seen);
  });
});

describe('persistence across a page refresh', () => {
  it('a new library on the same storage finds what the old one saved', async () => {
    const storage = new MemoryStorage();
    const first = make(storage).library;
    await first.add(capturedFrame(1000), META);
    await first.add(capturedFrame(2000), META);

    const afterRefresh = make(storage).library;
    assert.equal(afterRefresh.getSnapshot().storage.status, 'loading');
    await afterRefresh.load();
    assert.equal(afterRefresh.getSnapshot().storage.status, 'persistent');
    assert.deepEqual(afterRefresh.getSnapshot().items.map((i) => i.timestamp), [2000, 1000]);
    assert.ok(afterRefresh.getSnapshot().items.every((i) => i.persistence === 'saved'));
  });

  it('ignores damaged records instead of showing a broken entry', async () => {
    const storage = new MemoryStorage();
    storage.records.set('good', storedSnapshot('good', 1));
    storage.records.set('bad', { ...storedSnapshot('bad', 2), blob: 'not a blob' as unknown as Blob });
    const { library } = make(storage);
    await library.load();
    assert.deepEqual(library.getSnapshot().items.map((i) => i.id), ['good']);
  });

  it('falls back to memory-only, with the reason, if saved snapshots cannot be read', async () => {
    const storage = new MemoryStorage();
    storage.failLoad = namedError('UnknownError', 'denied');
    const { library } = make(storage);
    await library.load();
    assert.equal(library.getSnapshot().storage.status, 'memory-only');
    assert.match(library.getSnapshot().storage.reason ?? '', /could not be read/);
    const added = await library.add(capturedFrame(1), META); // still usable
    assert.equal(added.item.id.startsWith('id-'), true);
  });

  it('keeps a snapshot captured while the saved ones were still loading', async () => {
    const storage = new MemoryStorage();
    storage.records.set('old', storedSnapshot('old', 1));
    let release!: () => void;
    storage.loadGate = new Promise<void>((r) => (release = r));
    const { library } = make(storage);
    const loading = library.load();
    await library.add(capturedFrame(5000), META);
    release();
    await loading;
    assert.deepEqual(library.getSnapshot().items.map((i) => i.timestamp), [5000, 1]);
  });
});

describe('deleting snapshots', () => {
  it('removes the entry and its stored image data', async () => {
    const { library, storage } = make();
    const a = await library.add(capturedFrame(1000), META);
    const b = await library.add(capturedFrame(2000), META);
    const result = await library.remove(a.item.id);
    assert.equal(result.ok, true);
    assert.deepEqual(library.getSnapshot().items.map((i) => i.id), [b.item.id]);
    assert.equal(storage!.records.has(a.item.id), false, 'the stored image is gone');
    assert.equal(storage!.records.has(b.item.id), true);
  });

  it('keeps the entry, and says so, if the stored data cannot be deleted (it would come back on refresh)', async () => {
    const { library, storage } = make();
    const a = await library.add(capturedFrame(1000), META);
    storage!.failRemove = new SnapshotStorageError('failed', 'the browser could not delete it');
    const result = await library.remove(a.item.id);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /could not delete/);
    assert.equal(library.getSnapshot().items.length, 1);
    assert.equal(storage!.records.size, 1);
  });

  it('removes a session-only entry without touching storage', async () => {
    const { library, storage } = make();
    storage!.failPut = new Error('full');
    const a = await library.add(capturedFrame(1000), META);
    storage!.failRemove = new Error('should not be called');
    assert.equal((await library.remove(a.item.id)).ok, true);
    assert.equal(library.getSnapshot().items.length, 0);
  });

  it('removing an unknown id is harmless', async () => {
    const { library } = make();
    assert.equal((await library.remove('missing')).ok, true);
  });

  it('clear() empties the gallery and storage, but not if storage refuses', async () => {
    const { library, storage } = make();
    await library.add(capturedFrame(1000), META);
    await library.add(capturedFrame(2000), META);
    storage!.failClear = new Error('locked');
    assert.equal((await library.clear()).ok, false);
    assert.equal(library.getSnapshot().items.length, 2);
    storage!.failClear = null;
    assert.equal((await library.clear()).ok, true);
    assert.equal(library.getSnapshot().items.length, 0);
    assert.equal(storage!.records.size, 0);
  });
});

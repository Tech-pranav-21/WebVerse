/**
 * Smart Snapshot: IndexedDB storage adapter tests.
 *
 * MOCKED: a small fake IndexedDB (tests/snapshotFakes.ts). It proves the adapter's logic: what it
 * writes and reads, that delete really removes the record, and how failures are classified.
 * Real IndexedDB persistence across a page refresh was checked separately in Chromium.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  IndexedDbSnapshotStorage,
  SnapshotStorageError,
  createSnapshotStorage,
  describeStorageError,
} from '../src/services/snapshotStorage';
import { FakeIdbFactory, blobBytes, namedError, storedSnapshot } from './snapshotFakes';

function make() {
  const factory = new FakeIdbFactory();
  const storage = new IndexedDbSnapshotStorage(factory.asFactory());
  return { factory, storage };
}

describe('IndexedDbSnapshotStorage', () => {
  it('stores a snapshot and a new instance (a page refresh) reads it back with its image data', async () => {
    const { factory, storage } = make();
    const record = storedSnapshot('a', 1000);
    await storage.put(record);
    assert.ok(factory.disk.has('a'));

    const afterRefresh = new IndexedDbSnapshotStorage(factory.asFactory());
    const loaded = await afterRefresh.loadAll();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'a');
    assert.equal(loaded[0].timestamp, 1000);
    assert.deepEqual(await blobBytes(loaded[0].blob), await blobBytes(record.blob), 'the image bytes are what was saved');
  });

  it('creates the object store only the first time', async () => {
    const { factory, storage } = make();
    await storage.put(storedSnapshot('a', 1));
    assert.equal(factory.storeCreated, true);
    assert.equal(factory.openCalls, 1);
    await storage.put(storedSnapshot('b', 2)); // the open connection is reused
    assert.equal(factory.openCalls, 1);
  });

  it('remove() deletes the record and its image data', async () => {
    const { factory, storage } = make();
    await storage.put(storedSnapshot('a', 1));
    await storage.put(storedSnapshot('b', 2));
    await storage.remove('a');
    assert.equal(factory.disk.has('a'), false);
    assert.equal(factory.disk.has('b'), true);
    assert.deepEqual((await storage.loadAll()).map((r) => r.id), ['b']);
  });

  it('removing an unknown id is not an error', async () => {
    const { storage } = make();
    await storage.remove('nope');
  });

  it('clear() deletes everything', async () => {
    const { factory, storage } = make();
    await storage.put(storedSnapshot('a', 1));
    await storage.put(storedSnapshot('b', 2));
    await storage.clear();
    assert.equal(factory.disk.size, 0);
    assert.deepEqual(await storage.loadAll(), []);
  });

  it('classifies a full browser store (QuotaExceededError via the transaction) and writes nothing', async () => {
    const { factory, storage } = make();
    factory.failNext = { op: 'put', error: namedError('QuotaExceededError'), how: 'abort' };
    await assert.rejects(
      () => storage.put(storedSnapshot('a', 1)),
      (err: unknown) => {
        assert.ok(err instanceof SnapshotStorageError);
        assert.equal(err.kind, 'quota');
        assert.match(err.message, /storage for this site is full/);
        return true;
      },
    );
    assert.equal(factory.disk.size, 0);
    // The next write works again.
    await storage.put(storedSnapshot('b', 2));
    assert.equal(factory.disk.has('b'), true);
  });

  it('classifies a QuotaExceededError thrown synchronously as quota too', async () => {
    const { factory, storage } = make();
    factory.failNext = { op: 'put', error: namedError('QuotaExceededError'), how: 'throw' };
    await assert.rejects(() => storage.put(storedSnapshot('a', 1)), (err: unknown) => err instanceof SnapshotStorageError && err.kind === 'quota');
  });

  it('reports other write failures with the browser\'s reason', async () => {
    const { factory, storage } = make();
    factory.failNext = { op: 'put', error: namedError('DataError', 'bad key'), how: 'abort' };
    await assert.rejects(
      () => storage.put(storedSnapshot('a', 1)),
      (err: unknown) => err instanceof SnapshotStorageError && err.kind === 'failed' && /bad key/.test(err.message),
    );
  });

  it('reports a database that cannot be opened as unavailable, and retries on the next call', async () => {
    const { factory, storage } = make();
    factory.failOpen = 'error';
    await assert.rejects(() => storage.loadAll(), (err: unknown) => err instanceof SnapshotStorageError && err.kind === 'unavailable');
    factory.failOpen = null;
    assert.deepEqual(await storage.loadAll(), [], 'a failed open must not be cached');
    assert.equal(factory.openCalls, 2);
  });

  it('reports open() throwing (blocked site data) as unavailable', async () => {
    const { factory, storage } = make();
    factory.failOpen = 'throw';
    await assert.rejects(() => storage.put(storedSnapshot('a', 1)), (err: unknown) => err instanceof SnapshotStorageError && err.kind === 'unavailable');
  });
});

describe('createSnapshotStorage / describeStorageError', () => {
  it('returns null when the browser has no IndexedDB', () => {
    assert.equal(createSnapshotStorage(null), null);
  });

  it('wraps an available IndexedDB', () => {
    assert.ok(createSnapshotStorage(new FakeIdbFactory().asFactory()) instanceof IndexedDbSnapshotStorage);
  });

  it('never throws while looking for the global (Node has none)', () => {
    assert.equal(createSnapshotStorage(), null);
  });

  it('gives a readable reason for any error', () => {
    assert.equal(describeStorageError(new SnapshotStorageError('quota', 'full')), 'full');
    assert.equal(describeStorageError(new Error('plain')), 'plain');
    assert.equal(describeStorageError('text'), 'text');
  });
});

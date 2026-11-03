/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Smart Snapshot, step 2: keep snapshots across page refreshes.
 *
 * Images are stored in IndexedDB as native Blobs. localStorage/sessionStorage were not an option:
 * they hold strings only (a base64 JPEG is a third larger) and are capped at about 5 MB for the
 * whole origin, so a handful of stills would already fail. There is no backend and no new package.
 *
 * Everything here can fail (private window, blocked site data, full disk), and every failure is
 * reported as a SnapshotStorageError with a reason that can be shown to the user.
 */

/** What is written to IndexedDB for one snapshot. */
export interface StoredSnapshot {
  id: string;
  timestamp: number;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sourceUrl: string;
  cameraName: string;
}

export interface SnapshotStorage {
  loadAll(): Promise<StoredSnapshot[]>;
  put(record: StoredSnapshot): Promise<void>;
  /** Deletes the record, including its image data. Deleting an unknown id is not an error. */
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export type SnapshotStorageErrorKind = 'quota' | 'unavailable' | 'failed';

export class SnapshotStorageError extends Error {
  constructor(
    readonly kind: SnapshotStorageErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SnapshotStorageError';
  }
}

/** Short, user-facing reason for a storage failure. */
export function describeStorageError(err: unknown): string {
  if (err instanceof SnapshotStorageError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export const SNAPSHOT_DB_NAME = 'rc_surveillance_snapshots';
export const SNAPSHOT_STORE_NAME = 'snapshots';
const DB_VERSION = 1;

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
}

function classify(err: unknown): SnapshotStorageError {
  if (err instanceof SnapshotStorageError) return err;
  const name = errorName(err);
  if (name === 'QuotaExceededError') {
    return new SnapshotStorageError(
      'quota',
      'the browser storage for this site is full (delete some snapshots or free disk space)',
      err,
    );
  }
  const detail = err instanceof Error ? err.message : name || String(err);
  return new SnapshotStorageError('failed', `the browser could not write the image data (${detail || 'unknown error'})`, err);
}

/**
 * IndexedDB, or null when this browser exposes none. Touching `indexedDB` can itself throw
 * (blocked site data), so the lookup is guarded.
 */
export function createSnapshotStorage(factory?: IDBFactory | null): SnapshotStorage | null {
  try {
    const idb = factory === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : factory;
    return idb ? new IndexedDbSnapshotStorage(idb) : null;
  } catch {
    return null;
  }
}

export class IndexedDbSnapshotStorage implements SnapshotStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly dbName: string = SNAPSHOT_DB_NAME,
  ) {}

  loadAll(): Promise<StoredSnapshot[]> {
    return this.run<StoredSnapshot[]>('readonly', (store) => store.getAll());
  }

  async put(record: StoredSnapshot): Promise<void> {
    await this.run<IDBValidKey>('readwrite', (store) => store.put(record));
  }

  async remove(id: string): Promise<void> {
    await this.run<undefined>('readwrite', (store) => store.delete(id));
  }

  async clear(): Promise<void> {
    await this.run<undefined>('readwrite', (store) => store.clear());
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory.open(this.dbName, DB_VERSION);
      } catch (err) {
        reject(new SnapshotStorageError('unavailable', 'the browser refused to open its image storage (private window or blocked site data?)', err));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
          db.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrading or the browser evicting the database closes it: reopen on next use.
        db.onclose = () => {
          this.dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () =>
        reject(new SnapshotStorageError('unavailable', 'the browser refused to open its image storage (private window or blocked site data?)', request.error));
      request.onblocked = () =>
        reject(new SnapshotStorageError('unavailable', 'the browser image storage is blocked by another open tab', null));
    });
    this.dbPromise = promise;
    // A failed open must not be cached, or storage would stay broken until the page reloads.
    promise.catch(() => {
      if (this.dbPromise === promise) this.dbPromise = null;
    });
    return promise;
  }

  /** Runs one request in its own transaction and resolves when the transaction has committed. */
  private async run<T>(mode: IDBTransactionMode, makeRequest: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      try {
        const tx = db.transaction(SNAPSHOT_STORE_NAME, mode);
        const request = makeRequest(tx.objectStore(SNAPSHOT_STORE_NAME));
        let result: T;
        request.onsuccess = () => {
          result = request.result;
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(classify(tx.error ?? request.error));
        tx.onabort = () => reject(classify(tx.error ?? request.error));
      } catch (err) {
        reject(classify(err));
      }
    });
  }
}

/**
 * Test doubles for Smart Snapshot. Nothing here touches a network, a real canvas or a real
 * IndexedDB: the browser pieces are replaced by small fakes whose behaviour each test controls.
 * (Real browser behaviour was checked separately; see PHASE3A_SMART_SNAPSHOT_REPORT.md.)
 */

import type { CaptureCanvas, GrabImage } from '../src/services/frameCapture';
import type { SnapshotStorage, StoredSnapshot } from '../src/services/snapshotStorage';

export function namedError(name: string, message = name): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** A valid-looking JPEG: FF D8 ... FF D9, `size` bytes long. */
export function jpegBytes(size = 400): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x41);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

export function jpegBlob(size = 400): Blob {
  return new Blob([jpegBytes(size) as BlobPart], { type: 'image/jpeg' });
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// ----------------------------------------------------------------- canvas --

export type CanvasBehaviour =
  | 'jpeg'
  | 'null'
  | 'png'
  | 'garbage-jpeg'
  | 'security-error'
  | 'other-error'
  | 'no-context';

export class FakeCanvas implements CaptureCanvas {
  width = 0;
  height = 0;
  drawn: unknown[] = [];
  toBlobArgs: Array<{ type?: string; quality?: number }> = [];

  constructor(private readonly behaviour: CanvasBehaviour = 'jpeg') {}

  getContext() {
    if (this.behaviour === 'no-context') return null;
    return { drawImage: (image: unknown) => void this.drawn.push(image) };
  }

  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void {
    this.toBlobArgs.push({ type, quality });
    switch (this.behaviour) {
      case 'security-error':
        throw namedError('SecurityError', "Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported.");
      case 'other-error':
        throw namedError('EncodingError', 'boom');
      case 'null':
        queueMicrotask(() => callback(null));
        return;
      case 'png':
        queueMicrotask(() => callback(new Blob([new Uint8Array(300).fill(1) as BlobPart], { type: 'image/png' })));
        return;
      case 'garbage-jpeg':
        queueMicrotask(() => callback(new Blob([new Uint8Array(300).fill(7) as BlobPart], { type: 'image/jpeg' })));
        return;
      default:
        queueMicrotask(() => callback(jpegBlob(500)));
    }
  }
}

/** Hands out FakeCanvas objects and remembers them. */
export function canvasFactory(behaviour: CanvasBehaviour = 'jpeg') {
  const canvases: FakeCanvas[] = [];
  return {
    canvases,
    create: (): CaptureCanvas => {
      const c = new FakeCanvas(behaviour);
      canvases.push(c);
      return c;
    },
  };
}

// ------------------------------------------------------------------ image --

/** Stands in for `new Image()`; the test decides when it "loads" or "fails". */
export class FakeGrabImage implements GrabImage {
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  onload: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event | string) => void) | null = null;
  /** Everything done to the element, in order: 'crossOrigin=anonymous', 'src=<url>', 'removeAttribute(src)'. */
  ops: string[] = [];
  private _crossOrigin: string | null = null;
  private _src = '';

  get crossOrigin(): string | null {
    return this._crossOrigin;
  }
  set crossOrigin(value: string | null) {
    this._crossOrigin = value;
    this.ops.push(`crossOrigin=${value}`);
  }
  get src(): string {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    this.ops.push(`src=${value}`);
  }
  removeAttribute(name: string): void {
    this.ops.push(`removeAttribute(${name})`);
    if (name === 'src') this._src = '';
  }

  /** The first frame was decoded. */
  load(width = 640, height = 480): void {
    this.complete = true;
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.onload?.(new Event('load'));
  }
  fail(): void {
    this.onerror?.(new Event('error'));
  }

  get srcAssignments(): string[] {
    return this.ops.filter((o) => o.startsWith('src=')).map((o) => o.slice(4));
  }
  get connectionsClosed(): number {
    return this.ops.filter((o) => o === 'removeAttribute(src)').length;
  }
}

// ------------------------------------------------------------ memory store --

/** A SnapshotStorage that keeps records in a Map, with switches for failures. */
export class MemoryStorage implements SnapshotStorage {
  records = new Map<string, StoredSnapshot>();
  failPut: Error | null = null;
  failRemove: Error | null = null;
  failClear: Error | null = null;
  failLoad: Error | null = null;
  putCalls = 0;
  /** When set, loadAll() waits for this promise (to model a slow first read). */
  loadGate: Promise<void> | null = null;

  async loadAll(): Promise<StoredSnapshot[]> {
    if (this.loadGate) await this.loadGate;
    if (this.failLoad) throw this.failLoad;
    return [...this.records.values()];
  }
  async put(record: StoredSnapshot): Promise<void> {
    this.putCalls++;
    if (this.failPut) throw this.failPut;
    this.records.set(record.id, record);
  }
  async remove(id: string): Promise<void> {
    if (this.failRemove) throw this.failRemove;
    this.records.delete(id);
  }
  async clear(): Promise<void> {
    if (this.failClear) throw this.failClear;
    this.records.clear();
  }
}

// -------------------------------------------------------------- fake IndexedDB --

type Op = 'getAll' | 'put' | 'delete' | 'clear';

interface FakeRequest<T> {
  result: T | undefined;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Just enough of IDBFactory/IDBDatabase/IDBTransaction/IDBObjectStore for IndexedDbSnapshotStorage:
 * asynchronous requests, a transaction that completes or aborts, and failure injection. `disk` is
 * what survives between storage instances, i.e. what a page refresh would find.
 */
export class FakeIdbFactory {
  disk = new Map<string, StoredSnapshot>();
  storeCreated = false;
  openCalls = 0;
  failOpen: 'error' | 'throw' | null = null;
  /** Fails the next transaction that runs this operation. 'abort' = via the transaction, like a real quota error. */
  failNext: { op: Op; error: Error; how: 'abort' | 'throw' } | null = null;

  open(_name: string, _version?: number): IDBOpenDBRequest {
    this.openCalls++;
    if (this.failOpen === 'throw') throw namedError('SecurityError', 'blocked');
    const request = {
      result: undefined as unknown as IDBDatabase,
      error: null as Error | null,
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
    };
    setImmediate(() => {
      if (this.failOpen === 'error') {
        request.error = namedError('UnknownError', 'denied');
        request.onerror?.();
        return;
      }
      const db = new FakeDb(this);
      request.result = db as unknown as IDBDatabase;
      if (!this.storeCreated) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request as unknown as IDBOpenDBRequest;
  }

  asFactory(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}

class FakeDb {
  onclose: (() => void) | null = null;
  onversionchange: (() => void) | null = null;
  constructor(private readonly factory: FakeIdbFactory) {}
  get objectStoreNames() {
    return { contains: () => this.factory.storeCreated };
  }
  createObjectStore(): unknown {
    this.factory.storeCreated = true;
    return {};
  }
  transaction(_store: string, _mode: string): unknown {
    return new FakeTx(this.factory);
  }
  close(): void {}
}

class FakeTx {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: Error | null = null;
  constructor(readonly factory: FakeIdbFactory) {}
  objectStore(): unknown {
    return new FakeStore(this);
  }
}

class FakeStore {
  constructor(private readonly tx: FakeTx) {}

  getAll(): IDBRequest<StoredSnapshot[]> {
    return this.run('getAll', () => [...this.tx.factory.disk.values()]);
  }
  put(record: StoredSnapshot): IDBRequest<IDBValidKey> {
    return this.run<IDBValidKey>('put', () => {
      this.tx.factory.disk.set(record.id, record);
      return record.id;
    });
  }
  delete(id: string): IDBRequest<undefined> {
    return this.run('delete', () => {
      this.tx.factory.disk.delete(id);
      return undefined;
    });
  }
  clear(): IDBRequest<undefined> {
    return this.run('clear', () => {
      this.tx.factory.disk.clear();
      return undefined;
    });
  }

  private run<T>(op: Op, action: () => T): IDBRequest<T> {
    const { factory } = this.tx;
    const fail = factory.failNext && factory.failNext.op === op ? factory.failNext : null;
    if (fail?.how === 'throw') {
      factory.failNext = null;
      throw fail.error;
    }
    const request: FakeRequest<T> = { result: undefined, error: null, onsuccess: null, onerror: null };
    setImmediate(() => {
      if (fail) {
        factory.failNext = null;
        request.error = fail.error;
        this.tx.error = fail.error; // nothing was written
        request.onerror?.();
        this.tx.onerror?.();
        this.tx.onabort?.();
        return;
      }
      request.result = action();
      request.onsuccess?.();
      setImmediate(() => this.tx.oncomplete?.());
    });
    return request as unknown as IDBRequest<T>;
  }
}

/** Let queued microtasks and immediates run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
}

export function storedSnapshot(id: string, timestamp: number, overrides: Partial<StoredSnapshot> = {}): StoredSnapshot {
  return {
    id,
    timestamp,
    blob: jpegBlob(300),
    mimeType: 'image/jpeg',
    width: 640,
    height: 480,
    sizeBytes: 300,
    sourceUrl: 'http://10.0.0.5/stream',
    cameraName: 'ESP32-CAM',
    ...overrides,
  };
}

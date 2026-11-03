/**
 * Transport and renderer tests with fake DOM elements and a fake fetch (MOCKED).
 * Real <img> behaviour (load fires once, removeAttribute('src') closes the connection, etc.) was
 * observed separately in Chromium; see PHASE1_STABILITY_REPORT.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BlobFrameRenderer,
  FetchMjpegTransport,
  ImgElementTransport,
  describeFetchError,
} from '../src/services/streamTransports';
import type { StreamCallbacks } from '../src/services/streamConnectionService';

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

// ------------------------------------------------------------------ fakes --

class FakeImgElement extends EventTarget {
  private _src: string | null = null;
  complete = false;
  naturalWidth = 0;
  srcAssignments: string[] = [];
  srcRemovals = 0;

  get src(): string {
    return this._src ?? '';
  }
  set src(v: string) {
    this._src = v;
    this.srcAssignments.push(v);
  }
  removeAttribute(name: string): void {
    if (name !== 'src') return;
    this._src = null;
    this.srcRemovals++;
    // Chromium fires `error` when the source is cleared. Whoever is still listening sees it.
    this.dispatchEvent(new Event('error'));
  }
  asImg(): HTMLImageElement {
    return this as unknown as HTMLImageElement;
  }
}

function recorder() {
  const log: string[] = [];
  const callbacks: StreamCallbacks = {
    onFirstFrame: () => log.push('first'),
    onFrame: () => log.push('frame'),
    onError: (m) => log.push(`error:${m}`),
    onEnded: (m) => log.push(`ended:${m}`),
  };
  return { log, callbacks };
}

// ------------------------------------------------------- ImgElementTransport --

describe('ImgElementTransport', () => {
  it('sets the source, reports the first load once and ignores later load events', () => {
    const el = new FakeImgElement();
    const { log, callbacks } = recorder();
    new ImgElementTransport(() => el.asImg()).open('http://cam/stream', callbacks);
    assert.equal(el.src, 'http://cam/stream');
    el.dispatchEvent(new Event('load'));
    el.dispatchEvent(new Event('load'));
    assert.deepEqual(log, ['first']);
  });

  it('reports an error event', () => {
    const el = new FakeImgElement();
    const { log, callbacks } = recorder();
    new ImgElementTransport(() => el.asImg()).open('http://cam/stream', callbacks);
    el.dispatchEvent(new Event('error'));
    assert.equal(log.length, 1);
    assert.match(log[0], /^error:/);
  });

  it('close() clears the source without reporting the error event that clearing it raises', () => {
    const el = new FakeImgElement();
    const { log, callbacks } = recorder();
    const session = new ImgElementTransport(() => el.asImg()).open('http://cam/stream', callbacks);
    session.close();
    assert.equal(el.srcRemovals, 1, 'the connection is released by clearing src');
    assert.equal(el.src, '');
    assert.deepEqual(log, [], 'the error event raised by clearing src must not reach the supervisor');
    el.dispatchEvent(new Event('load'));
    el.dispatchEvent(new Event('error'));
    assert.deepEqual(log, [], 'no events after close');
  });

  it('close() is idempotent', () => {
    const el = new FakeImgElement();
    const session = new ImgElementTransport(() => el.asImg()).open('http://cam/stream', recorder().callbacks);
    session.close();
    session.close();
    assert.equal(el.srcRemovals, 1);
  });

  it('a new session after close does not inherit the old session\'s handlers', () => {
    const el = new FakeImgElement();
    const a = recorder();
    const b = recorder();
    const transport = new ImgElementTransport(() => el.asImg());
    const s1 = transport.open('http://cam/stream', a.callbacks);
    s1.close();
    transport.open('http://cam/stream?_rc=2', b.callbacks);
    el.dispatchEvent(new Event('load'));
    assert.deepEqual(a.log, []);
    assert.deepEqual(b.log, ['first']);
  });

  it('poll() reports a decoded-nothing element as broken and a live one as ok', () => {
    const el = new FakeImgElement();
    const session = new ImgElementTransport(() => el.asImg()).open('http://cam/stream', recorder().callbacks);
    el.complete = false;
    assert.equal(session.poll!(), 'ok');
    el.complete = true;
    el.naturalWidth = 640;
    assert.equal(session.poll!(), 'ok');
    el.naturalWidth = 0;
    assert.equal(session.poll!(), 'broken');
    session.close();
    assert.equal(session.poll!(), 'ok', 'a closed session is never "broken"');
  });

  it('throws a clear error when no element is mounted', () => {
    assert.throws(() => new ImgElementTransport(() => null).open('http://cam/stream', recorder().callbacks), /No video element/);
  });
});

// ----------------------------------------------------- FetchMjpegTransport --

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function jpeg(n: number): Uint8Array {
  const out = new Uint8Array(n).fill(7);
  out[0] = 0xff;
  out[1] = 0xd8;
  out[n - 2] = 0xff;
  out[n - 1] = 0xd9;
  return out;
}
function part(frame: Uint8Array): Uint8Array {
  const header = enc(`\r\n--b\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
  const out = new Uint8Array(header.length + frame.length);
  out.set(header, 0);
  out.set(frame, header.length);
  return out;
}

/** A Response-like object whose body the test feeds by hand. */
function controlledBody() {
  const queue: Array<{ value?: Uint8Array; done: boolean } | Error> = [];
  let waiting: ((r: { value?: Uint8Array; done: boolean }) => void) | null = null;
  let waitingFail: ((e: Error) => void) | null = null;
  const pump = () => {
    if (!waiting || queue.length === 0) return;
    const next = queue.shift()!;
    const resolve = waiting;
    const fail = waitingFail!;
    waiting = null;
    waitingFail = null;
    if (next instanceof Error) fail(next);
    else resolve(next);
  };
  return {
    push(bytes: Uint8Array) {
      queue.push({ value: bytes, done: false });
      pump();
    },
    end() {
      queue.push({ done: true });
      pump();
    },
    fail(e: Error) {
      queue.push(e);
      pump();
    },
    response(init: { ok?: boolean; status?: number } = {}) {
      return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        body: {
          getReader: () => ({
            read: () =>
              new Promise<{ value?: Uint8Array; done: boolean }>((resolve, reject) => {
                waiting = resolve;
                waitingFail = reject;
                pump();
              }),
          }),
        },
      } as unknown as Response;
    },
  };
}

describe('FetchMjpegTransport', () => {
  function setup(fetchImpl: typeof fetch) {
    const frames: Uint8Array[] = [];
    let closes = 0;
    const { log, callbacks } = recorder();
    const transport = new FetchMjpegTransport({
      fetchImpl,
      onFrameBytes: (f) => frames.push(f),
      onClose: () => {
        closes++;
      },
    });
    return { transport, frames, log, callbacks, closes: () => closes };
  }

  it('requests with CORS and no cache, then reports the first frame and the following frames', async () => {
    const body = controlledBody();
    let seen: { url: string; init: RequestInit } | null = null;
    const t = setup((async (url: string, init: RequestInit) => {
      seen = { url, init };
      return body.response();
    }) as unknown as typeof fetch);

    t.transport.open('http://cam:81/stream', t.callbacks);
    body.push(part(jpeg(50)));
    await flush();
    body.push(part(jpeg(60)));
    await flush();

    assert.equal(seen!.url, 'http://cam:81/stream');
    assert.equal(seen!.init.mode, 'cors');
    assert.equal(seen!.init.cache, 'no-store');
    assert.deepEqual(t.log, ['first', 'frame']);
    assert.deepEqual(t.frames.map((f) => f.length), [50, 60]);
  });

  it('copes with frames split across network chunks', async () => {
    const body = controlledBody();
    const t = setup((async () => body.response()) as unknown as typeof fetch);
    t.transport.open('http://cam:81/stream', t.callbacks);
    const bytes = part(jpeg(80));
    body.push(bytes.subarray(0, 30));
    await flush();
    assert.deepEqual(t.log, []);
    body.push(bytes.subarray(30));
    await flush();
    assert.deepEqual(t.log, ['first']);
  });

  it('reports an HTTP error status', async () => {
    const t = setup((async () => controlledBody().response({ ok: false, status: 503 })) as unknown as typeof fetch);
    t.transport.open('http://cam:81/stream', t.callbacks);
    await flush();
    assert.deepEqual(t.log, ['error:The camera answered HTTP 503.']);
  });

  it('explains a missing-CORS failure', async () => {
    const t = setup((async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    t.transport.open('http://cam:81/stream', t.callbacks);
    await flush();
    assert.equal(t.log.length, 1);
    assert.match(t.log[0], /Access-Control-Allow-Origin/);
    assert.match(describeFetchError(new TypeError('x')), /Frame monitoring/);
  });

  it('reports a clean end of the response', async () => {
    const body = controlledBody();
    const t = setup((async () => body.response()) as unknown as typeof fetch);
    t.transport.open('http://cam:81/stream', t.callbacks);
    body.push(part(jpeg(50)));
    await flush();
    body.end();
    await flush();
    assert.deepEqual(t.log, ['first', 'ended:the response ended.']);
  });

  it('reports a read error in the middle of the stream', async () => {
    const body = controlledBody();
    const t = setup((async () => body.response()) as unknown as typeof fetch);
    t.transport.open('http://cam:81/stream', t.callbacks);
    body.push(part(jpeg(50)));
    await flush();
    body.fail(new TypeError('network error'));
    await flush();
    assert.equal(t.log[0], 'first');
    assert.match(t.log[1], /^error:/);
  });

  it('close() aborts the request, calls onClose once, and silences everything afterwards', async () => {
    const body = controlledBody();
    let signal: AbortSignal | undefined;
    const t = setup((async (_url: string, init: RequestInit) => {
      signal = init.signal!;
      return body.response();
    }) as unknown as typeof fetch);
    const session = t.transport.open('http://cam:81/stream', t.callbacks);
    body.push(part(jpeg(50)));
    await flush();

    session.close();
    session.close();
    assert.equal(signal!.aborted, true, 'the network request must be cancelled, not merely ignored');
    assert.equal(t.closes(), 1);

    body.push(part(jpeg(50)));
    body.fail(new TypeError('aborted'));
    await flush();
    assert.deepEqual(t.log, ['first'], 'nothing is reported after close()');
    assert.equal(t.frames.length, 1);
  });

  it('close() before the response arrives is silent', async () => {
    let release: (r: Response) => void = () => {};
    const t = setup((async () => new Promise<Response>((r) => (release = r))) as unknown as typeof fetch);
    const session = t.transport.open('http://cam:81/stream', t.callbacks);
    session.close();
    release(controlledBody().response());
    await flush();
    assert.deepEqual(t.log, []);
  });
});

// -------------------------------------------------------- BlobFrameRenderer --

describe('BlobFrameRenderer', () => {
  function setup() {
    const el = new FakeImgElement();
    const created: string[] = [];
    const revoked: string[] = [];
    let n = 0;
    const urls = {
      createObjectURL: () => {
        const u = `blob:${++n}`;
        created.push(u);
        return u;
      },
      revokeObjectURL: (u: string) => {
        revoked.push(u);
      },
    };
    const renderer = new BlobFrameRenderer(() => el.asImg(), urls, () => ({}) as Blob);
    const leaked = () => created.filter((u) => !revoked.includes(u));
    return { el, renderer, created, revoked, leaked };
  }
  const decoded = (el: FakeImgElement) => el.dispatchEvent(new Event('load'));
  const bytes = () => new Uint8Array([1, 2, 3]);

  it('paints a frame and revokes the previous one only after the next has decoded', () => {
    const { el, renderer, revoked } = setup();
    renderer.render(bytes());
    assert.equal(el.src, 'blob:1');
    decoded(el);
    renderer.render(bytes());
    assert.equal(el.src, 'blob:2');
    assert.deepEqual(revoked, [], 'blob:1 still on screen until blob:2 has loaded');
    decoded(el);
    assert.deepEqual(revoked, ['blob:1']);
  });

  it('keeps only the newest frame when frames arrive faster than they decode', () => {
    const { el, renderer, created } = setup();
    renderer.render(bytes()); // blob:1 decoding
    renderer.render(bytes()); // queued
    renderer.render(bytes()); // replaces the queued one
    assert.equal(created.length, 1);
    decoded(el);
    assert.equal(created.length, 2, 'exactly one more frame is painted, not two');
    assert.equal(el.src, 'blob:2');
  });

  it('releases the blob of a frame that fails to decode and moves on', () => {
    const { el, renderer, revoked } = setup();
    renderer.render(bytes());
    renderer.render(bytes());
    el.dispatchEvent(new Event('error'));
    assert.deepEqual(revoked, ['blob:1']);
    assert.equal(el.src, 'blob:2');
  });

  it('reset() releases the current blob and discards work that finishes afterwards', () => {
    const { el, renderer, revoked, leaked } = setup();
    renderer.render(bytes());
    decoded(el); // blob:1 on screen
    renderer.render(bytes()); // blob:2 decoding
    renderer.reset();
    assert.ok(revoked.includes('blob:1'));
    decoded(el); // blob:2 finishes after the reset
    assert.deepEqual(leaked(), [], 'no blob URL is left allocated');
    renderer.render(bytes());
    assert.equal(el.src, 'blob:3', 'rendering works again after a reset');
  });

  it('does nothing when there is no element', () => {
    const created: string[] = [];
    const renderer = new BlobFrameRenderer(
      () => null,
      { createObjectURL: () => (created.push('x'), 'blob:x'), revokeObjectURL: () => {} },
      () => ({}) as Blob,
    );
    renderer.render(bytes());
    assert.deepEqual(created, []);
  });

  it('does not leak blob URLs over a long run', () => {
    const { el, renderer, leaked } = setup();
    for (let i = 0; i < 500; i++) {
      renderer.render(bytes());
      if (i % 3 === 0) renderer.render(bytes());
      decoded(el);
    }
    decoded(el);
    renderer.reset();
    assert.deepEqual(leaked(), []);
  });
});

// ----------------------------------- ImgElementTransport with snapshot capture (CORS) --

/** Records the order of the operations that matter for CORS: crossOrigin must be set before src. */
class FakeCorsImgElement extends FakeImgElement {
  ops: string[] = [];
  private _crossOrigin: string | null = null;

  get crossOrigin(): string | null {
    return this._crossOrigin;
  }
  set crossOrigin(value: string | null) {
    this._crossOrigin = value;
    this.ops.push(`crossOrigin=${value}`);
  }
  override get src(): string {
    return super.src;
  }
  override set src(value: string) {
    this.ops.push('src');
    super.src = value;
  }
  override removeAttribute(name: string): void {
    this.ops.push(`removeAttribute(${name})`);
    if (name === 'crossorigin') this._crossOrigin = null;
    super.removeAttribute(name);
  }
}

describe('ImgElementTransport with snapshot capture (CORS)', () => {
  it('requests CORS before it assigns the source, so the browser makes a CORS-enabled request', () => {
    const el = new FakeCorsImgElement();
    new ImgElementTransport(() => el.asImg(), { crossOrigin: 'anonymous' }).open('http://cam/stream', recorder().callbacks);
    assert.deepEqual(el.ops, ['crossOrigin=anonymous', 'src']);
  });

  it('leaves the element completely plain by default (works with cameras that send no CORS header)', () => {
    const el = new FakeCorsImgElement();
    const session = new ImgElementTransport(() => el.asImg()).open('http://cam/stream', recorder().callbacks);
    assert.deepEqual(el.ops, ['src']);
    session.close();
    assert.ok(!el.ops.includes('removeAttribute(crossorigin)'));
  });

  it('close() releases the connection first, then removes crossorigin so the next session starts clean', () => {
    const el = new FakeCorsImgElement();
    const session = new ImgElementTransport(() => el.asImg(), { crossOrigin: 'anonymous' }).open('http://cam/stream', recorder().callbacks);
    session.close();
    assert.deepEqual(el.ops, ['crossOrigin=anonymous', 'src', 'removeAttribute(src)', 'removeAttribute(crossorigin)']);
    assert.equal(el.srcRemovals, 1);
    assert.equal(el.crossOrigin, null);
  });

  it('a load error names the likely cause (no Access-Control-Allow-Origin) and the setting to turn off', () => {
    const el = new FakeCorsImgElement();
    const { log, callbacks } = recorder();
    new ImgElementTransport(() => el.asImg(), { crossOrigin: 'anonymous' }).open('http://cam/stream', callbacks);
    el.dispatchEvent(new Event('error'));
    assert.match(log[0], /Access-Control-Allow-Origin/);
    assert.match(log[0], /Allow snapshot capture/);

    const plain = new FakeCorsImgElement();
    const plainLog = recorder();
    new ImgElementTransport(() => plain.asImg()).open('http://cam/stream', plainLog.callbacks);
    plain.dispatchEvent(new Event('error'));
    assert.doesNotMatch(plainLog.log[0], /Access-Control-Allow-Origin/, 'the plain message is unchanged');
  });
});

/**
 * Probe tests with a stubbed Image element and stubbed fetch (MOCKED: no network).
 *
 * What they pin down: a probe must never leave a stream connection open (the original code leaked
 * one per successful probe), must honour cancellation and timeouts, and must not open a second
 * stream just to check whether the host is alive.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOrigin,
  probeCameraConnection,
  probeHostReachability,
  probeWithImageElement,
} from '../src/services/connectionService';

class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  declare src: string; // accessor defined on the prototype below, so assignments are tracked
  srcWasSet = false;
  srcRemoved = false;
  /** Handlers invoked after the source was cleared (Chromium fires `error` when src is removed). */
  spuriousEvents = 0;

  constructor() {
    FakeImage.instances.push(this);
  }

  setAttribute(): void {}

  removeAttribute(name: string): void {
    if (name !== 'src') return;
    this.srcRemoved = true;
    if (this.onerror) {
      this.spuriousEvents++;
      this.onerror(); // mimic the browser; a correct probe has already detached this
    }
  }
}

// `src` assignment tracking
Object.defineProperty(FakeImage.prototype, 'src', {
  get(this: FakeImage & { _src?: string }) {
    return this._src ?? '';
  },
  set(this: FakeImage & { _src?: string }, v: string) {
    this._src = v;
    this.srcWasSet = true;
  },
});

const g = globalThis as Record<string, unknown>;
const realFetch = globalThis.fetch;
const realImage = g.Image;
const realWindow = g.window;

function timeouts(): number {
  return process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
}

beforeEach(() => {
  FakeImage.instances = [];
  g.Image = FakeImage;
});

afterEach(() => {
  g.Image = realImage;
  g.window = realWindow;
  globalThis.fetch = realFetch;
});

function abortable(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

describe('hostOrigin', () => {
  it('reduces URLs and bare hosts to scheme://host:port', () => {
    assert.equal(hostOrigin('http://10.0.0.5:81/stream?x=1'), 'http://10.0.0.5:81');
    assert.equal(hostOrigin('10.0.0.5'), 'http://10.0.0.5');
    assert.equal(hostOrigin(''), '');
    assert.equal(hostOrigin('http://'), '');
  });
});

describe('probeWithImageElement', () => {
  it('releases the connection after a successful probe (the original code leaked it)', async () => {
    const before = timeouts();
    const p = probeWithImageElement('http://10.0.0.5:81/stream', 1000);
    const img = FakeImage.instances[0];
    assert.match(img.src, /^http:\/\/10\.0\.0\.5:81\/stream\?_probe=\d+$/);
    img.onload!();
    const result = await p;
    assert.equal(result.success, true);
    assert.equal(img.srcRemoved, true, 'src must be cleared so a continuous MJPEG response is closed');
    assert.equal(img.onload, null);
    assert.equal(img.onerror, null);
    assert.equal(img.spuriousEvents, 0, 'handlers must be detached before the source is cleared');
    assert.equal(timeouts(), before, 'timeout timer cleared');
  });

  it('releases the connection after an error too', async () => {
    const p = probeWithImageElement('http://10.0.0.5/capture', 1000);
    const img = FakeImage.instances[0];
    img.onerror!();
    const result = await p;
    assert.equal(result.success, false);
    assert.equal(img.srcRemoved, true);
    assert.equal(img.spuriousEvents, 0);
  });

  it('times out, releases the connection and ignores a late load', async () => {
    const p = probeWithImageElement('http://10.0.0.5:81/stream', 20);
    const img = FakeImage.instances[0];
    const result = await p;
    assert.equal(result.success, false);
    assert.match(result.errorMessage ?? '', /timed out/);
    assert.equal(img.srcRemoved, true);
    assert.equal(img.onload, null, 'a late load can no longer reach the finished probe');
  });

  it('can be cancelled and then releases the connection', async () => {
    const ac = new AbortController();
    const p = probeWithImageElement('http://10.0.0.5:81/stream', 5000, ac.signal);
    const img = FakeImage.instances[0];
    ac.abort();
    const result = await p;
    assert.equal(result.success, false);
    assert.equal(result.errorMessage, 'Probe cancelled.');
    assert.equal(img.srcRemoved, true);
  });

  it('an already-cancelled probe never opens a connection at all', async () => {
    const ac = new AbortController();
    ac.abort();
    const before = timeouts();
    const result = await probeWithImageElement('http://10.0.0.5:81/stream', 5000, ac.signal);
    assert.equal(result.errorMessage, 'Probe cancelled.');
    assert.equal(FakeImage.instances[0].srcWasSet, false);
    assert.equal(timeouts(), before);
  });
});

describe('probeHostReachability', () => {
  function stubFetch(impl: (url: string, init: RequestInit) => Promise<unknown>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return impl(String(input), init);
    }) as unknown as typeof fetch;
    return calls;
  }

  /** A fetch that never answers but rejects like a browser when its signal aborts (also if already aborted). */
  const hang = (_url: string, init: RequestInit) => abortable(init.signal!);

  it('aborts its own request as soon as it has an answer, so no body stays open', async () => {
    const before = timeouts();
    const calls = stubFetch(async () => ({}));
    const result = await probeHostReachability('http://10.0.0.5:81/stream', 1000);
    assert.equal(result.success, true);
    assert.equal(result.hostReachable, true);
    assert.equal(result.frameVerified, false);
    assert.equal(calls[0].init.signal!.aborted, true);
    assert.equal(calls[0].init.mode, 'no-cors');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(timeouts(), before);
  });

  it('reports a timeout distinctly', async () => {
    stubFetch(hang);
    const result = await probeHostReachability('http://10.0.0.5', 20);
    assert.equal(result.success, false);
    assert.equal(result.hostReachable, false);
    assert.match(result.errorMessage ?? '', /timed out/);
  });

  it('reports cancellation distinctly from a timeout, and cleans up', async () => {
    const calls = stubFetch(hang);
    const ac = new AbortController();
    const p = probeHostReachability('http://10.0.0.5', 5000, ac.signal);
    ac.abort();
    const result = await p;
    assert.equal(result.errorMessage, 'Probe cancelled.');
    assert.equal(calls[0].init.signal!.aborted, true);
  });

  it('an already-cancelled probe returns cancelled', async () => {
    stubFetch(hang);
    const ac = new AbortController();
    ac.abort();
    const result = await probeHostReachability('http://10.0.0.5', 5000, ac.signal);
    assert.equal(result.errorMessage, 'Probe cancelled.');
  });

  it('reports a network failure with the browser message', async () => {
    const calls = stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await probeHostReachability('http://10.0.0.5', 1000);
    assert.equal(result.success, false);
    assert.equal(result.errorMessage, 'Failed to fetch');
    assert.equal(calls[0].init.signal!.aborted, true);
  });

  // ---- Phase 2: machine-readable failure kind and trustworthy timing ----

  it('gives a successful request no failure kind', async () => {
    stubFetch(async () => ({}));
    const result = await probeHostReachability('http://10.0.0.5', 1000);
    assert.equal(result.failureKind, undefined);
  });

  it('labels the three failure kinds so callers need not parse messages', async () => {
    stubFetch(hang);
    const timedOut = await probeHostReachability('http://10.0.0.5', 20);
    assert.equal(timedOut.failureKind, 'timeout');

    const ac = new AbortController();
    const p = probeHostReachability('http://10.0.0.5', 5000, ac.signal);
    ac.abort();
    assert.equal((await p).failureKind, 'cancelled');

    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    assert.equal((await probeHostReachability('http://10.0.0.5', 1000)).failureKind, 'network');
  });

  it('measures the duration with a monotonic clock, so a wall-clock jump cannot corrupt it', async () => {
    stubFetch(() => new Promise((resolve) => setTimeout(() => resolve({}), 30)));
    const realNow = Date.now;
    let wall = 2_000_000_000_000;
    Date.now = () => (wall -= 60_000); // the system clock keeps jumping a minute BACKWARDS
    try {
      const result = await probeHostReachability('http://10.0.0.5', 1000);
      assert.equal(result.success, true);
      assert.ok(Number.isInteger(result.latencyMs));
      assert.ok(result.latencyMs! >= 20 && result.latencyMs! < 2000, `latencyMs was ${result.latencyMs}`);
    } finally {
      Date.now = realNow;
    }
  });

  it('only ever requests the address it was given, plus a cache-buster', async () => {
    const calls = stubFetch(async () => ({}));
    await probeHostReachability('http://10.0.0.5:8080', 1000);
    assert.match(calls[0].url, /^http:\/\/10\.0\.0\.5:8080\?_probe=\d+$/);
  });
});

describe('probeCameraConnection', () => {
  it('does not touch the network when the browser would block it as mixed content', async () => {
    g.window = { location: { protocol: 'https:' } };
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return {};
    }) as unknown as typeof fetch;
    const result = await probeCameraConnection('http://10.0.0.5:81/stream', 1000, 'image');
    assert.equal(result.probeType, 'mixed_content_block');
    assert.equal(result.isMixedContent, true);
    assert.equal(FakeImage.instances.length, 0);
    assert.equal(fetched, false);
  });

  it('a failed stream probe checks the host root, not the stream URL again', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      urls.push(String(input));
      return {};
    }) as unknown as typeof fetch;

    const p = probeCameraConnection('http://10.0.0.5:81/stream', 1000, 'image');
    FakeImage.instances[0].onerror!();
    const result = await p;

    assert.equal(result.success, false);
    assert.equal(result.hostReachable, true);
    assert.equal(urls.length, 1);
    assert.ok(!urls[0].includes('/stream'), `host check must not request the stream path (${urls[0]})`);
    assert.match(urls[0], /^http:\/\/10\.0\.0\.5:81\?_probe=\d+$/);
  });

  it('passes cancellation through to both stages', async () => {
    globalThis.fetch = (async (_input: unknown, init: RequestInit) =>
      abortable(init.signal!)) as unknown as typeof fetch;
    const ac = new AbortController();
    const p = probeCameraConnection('http://10.0.0.5:81/stream', 5000, 'image', ac.signal);
    ac.abort();
    const result = await p;
    assert.equal(result.success, false);
    assert.equal(FakeImage.instances[0].srcRemoved, true);
  });

  it('reports a verified frame when the image decodes', async () => {
    const p = probeCameraConnection('http://10.0.0.5/capture', 1000, 'image');
    FakeImage.instances[0].onload!();
    const result = await p;
    assert.equal(result.success, true);
    assert.equal(result.frameVerified, true);
  });

  it('an empty URL fails fast without any request', async () => {
    const result = await probeCameraConnection('  ', 1000);
    assert.equal(result.success, false);
    assert.equal(FakeImage.instances.length, 0);
  });
});

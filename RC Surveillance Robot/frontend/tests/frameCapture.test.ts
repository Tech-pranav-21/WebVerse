/**
 * Smart Snapshot: frame capture tests.
 *
 * MOCKED: a fake canvas and a fake <img>. They prove the capture logic (what is accepted, what is
 * refused, that connections are released). The browser's real canvas-taint behaviour against a
 * camera was checked separately in Chromium; see PHASE3A_SMART_SNAPSHOT_REPORT.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_JPEG_QUALITY,
  FrameImage,
  captureFrameFromImage,
  grabFrameFromStream,
  isValidJpeg,
  withCacheBuster,
} from '../src/services/frameCapture';
import { FakeClock } from './helpers';
import { FakeGrabImage, blobBytes, canvasFactory, jpegBlob } from './snapshotFakes';

const frame = (w = 640, h = 480): FrameImage => ({ complete: true, naturalWidth: w, naturalHeight: h });
const NOW = 1_700_000_000_000;

describe('captureFrameFromImage', () => {
  it('turns the displayed frame into a valid JPEG with the frame\'s own size and capture time', async () => {
    const { canvases, create } = canvasFactory('jpeg');
    const img = frame(640, 480);
    const result = await captureFrameFromImage(img, { createCanvas: create, now: () => NOW });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.frame.width, 640);
    assert.equal(result.frame.height, 480);
    assert.equal(result.frame.capturedAt, NOW);
    assert.equal(result.frame.blob.type, 'image/jpeg');
    const bytes = await blobBytes(result.frame.blob);
    assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], 'starts with the JPEG start marker');
    assert.deepEqual([bytes[bytes.length - 2], bytes[bytes.length - 1]], [0xff, 0xd9], 'ends with the JPEG end marker');
    assert.equal(canvases.length, 1);
    assert.equal(canvases[0].width, 640);
    assert.equal(canvases[0].height, 480);
    assert.deepEqual(canvases[0].drawn, [img], 'the displayed frame itself was drawn');
    assert.deepEqual(canvases[0].toBlobArgs, [{ type: 'image/jpeg', quality: CAPTURE_JPEG_QUALITY }]);
  });

  for (const [label, img] of [
    ['has not finished loading', { complete: false, naturalWidth: 640, naturalHeight: 480 }],
    ['has no decoded width', { complete: true, naturalWidth: 0, naturalHeight: 0 }],
  ] as const) {
    it(`refuses, and never touches a canvas, when the element ${label}`, async () => {
      const { canvases, create } = canvasFactory('jpeg');
      const result = await captureFrameFromImage(img, { createCanvas: create });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.failure.kind, 'no-frame');
      assert.equal(canvases.length, 0);
    });
  }

  it('reports a canvas SecurityError (cross-origin frame) as "blocked" and produces no image', async () => {
    const { create } = canvasFactory('security-error');
    const result = await captureFrameFromImage(frame(), { createCanvas: create });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, 'blocked');
    assert.match(result.failure.message, /blocked/i);
    assert.match(result.failure.detail ?? '', /Tainted canvases/);
  });

  it('reports other encoding errors without calling them security problems', async () => {
    const { create } = canvasFactory('other-error');
    const result = await captureFrameFromImage(frame(), { createCanvas: create });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.kind, 'encode-failed');
  });

  it('refuses when the browser returns no blob', async () => {
    const { create } = canvasFactory('null');
    const result = await captureFrameFromImage(frame(), { createCanvas: create });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, 'encode-failed');
  });

  it('refuses a PNG (the browser ignored the JPEG request) instead of saving a mislabelled file', async () => {
    const { create } = canvasFactory('png');
    const result = await captureFrameFromImage(frame(), { createCanvas: create });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, 'encode-failed');
  });

  it('refuses a blob that is labelled JPEG but is not one', async () => {
    const { create } = canvasFactory('garbage-jpeg');
    const result = await captureFrameFromImage(frame(), { createCanvas: create });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.failure.message, /not a valid JPEG/);
  });

  it('reports a missing 2D context or a failing canvas constructor', async () => {
    const noContext = await captureFrameFromImage(frame(), { createCanvas: canvasFactory('no-context').create });
    assert.equal(noContext.ok, false);
    if (!noContext.ok) assert.equal(noContext.failure.kind, 'canvas-unavailable');

    const throwing = await captureFrameFromImage(frame(), {
      createCanvas: () => {
        throw new Error('no canvas here');
      },
    });
    assert.equal(throwing.ok, false);
    if (!throwing.ok) assert.equal(throwing.failure.kind, 'canvas-unavailable');
  });
});

describe('isValidJpeg', () => {
  it('accepts a complete JPEG and rejects empty, tiny, truncated and non-JPEG data', async () => {
    assert.equal(await isValidJpeg(jpegBlob(300)), true);
    assert.equal(await isValidJpeg(new Blob([])), false);
    assert.equal(await isValidJpeg(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])])), false, 'too small to be an image');
    const truncated = new Blob([(await blobBytes(jpegBlob(300))).subarray(0, 200) as BlobPart]);
    assert.equal(await isValidJpeg(truncated), false, 'no end marker');
    assert.equal(await isValidJpeg(new Blob([new Uint8Array(300).fill(9) as BlobPart])), false);
  });
});

describe('grabFrameFromStream (Snapshot mode)', () => {
  function setup(extra: Partial<Parameters<typeof grabFrameFromStream>[1]> = {}) {
    const clock = new FakeClock();
    const images: FakeGrabImage[] = [];
    const canvasMaker = canvasFactory('jpeg');
    const options = {
      clock,
      createImage: () => {
        const img = new FakeGrabImage();
        images.push(img);
        return img;
      },
      capture: { createCanvas: canvasMaker.create, now: () => clock.now() },
      ...extra,
    };
    return { clock, images, options, canvasMaker };
  }
  const STREAM = 'http://10.71.151.45/stream';

  it('opens the stream in a CORS image, reads the first frame, then closes the connection', async () => {
    const { images, options, clock } = setup();
    const promise = grabFrameFromStream(STREAM, options);

    assert.equal(images.length, 1);
    const img = images[0];
    assert.equal(img.ops[0], 'crossOrigin=anonymous', 'CORS must be requested before the source is set');
    assert.match(img.ops[1], /^src=http:\/\/10\.71\.151\.45\/stream\?_snap=\d+$/);
    assert.equal(img.connectionsClosed, 0, 'still waiting for the first frame');

    img.load(640, 480);
    const result = await promise;
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.frame.width, 640);
      assert.equal(result.frame.capturedAt, clock.now());
    }
    assert.equal(img.connectionsClosed, 1, 'the camera connection was released');
    assert.equal(img.onload, null);
    assert.equal(img.onerror, null);
  });

  it('never requests /capture: only the stream URL is ever used', async () => {
    const { images, options } = setup();
    const promise = grabFrameFromStream(STREAM, options);
    images[0].load();
    await promise;
    assert.ok(images[0].srcAssignments.length >= 1);
    for (const url of images[0].srcAssignments) {
      assert.ok(url.startsWith(STREAM), `unexpected request: ${url}`);
      assert.doesNotMatch(url, /\/capture/);
    }
  });

  it('reports a load error (camera down, busy, or CORS refused) and releases the connection', async () => {
    const { images, options } = setup();
    const promise = grabFrameFromStream(STREAM, options);
    images[0].fail();
    const result = await promise;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.kind, 'load-failed');
      assert.match(result.failure.message, /Access-Control-Allow-Origin/);
    }
    assert.equal(images[0].connectionsClosed, 1);
  });

  it('gives up after the timeout, closes the connection, and ignores a late frame', async () => {
    const { images, options, clock } = setup({ timeoutMs: 15_000 });
    const promise = grabFrameFromStream(STREAM, options);
    clock.advance(14_999);
    assert.equal(images[0].connectionsClosed, 0);
    clock.advance(1);
    const result = await promise;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.kind, 'timeout');
      assert.match(result.failure.message, /15 seconds/);
    }
    assert.equal(images[0].connectionsClosed, 1);
    images[0].load(); // a frame arriving after the give-up must not change anything
    assert.equal(images[0].connectionsClosed, 1);
    assert.equal(clock.pendingTimers(), 0);
  });

  it('reports a canvas SecurityError after load as "blocked" and still closes the connection', async () => {
    const taint = canvasFactory('security-error');
    const { images, options } = setup({ capture: { createCanvas: taint.create } });
    const promise = grabFrameFromStream(STREAM, options);
    images[0].load();
    const result = await promise;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, 'blocked');
    assert.equal(images[0].connectionsClosed, 1);
  });

  it('cancels on abort: connection closed, no frame, result "cancelled"', async () => {
    const controller = new AbortController();
    const { images, options, clock } = setup({ signal: controller.signal });
    const promise = grabFrameFromStream(STREAM, options);
    controller.abort();
    const result = await promise;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, 'cancelled');
    assert.equal(images[0].connectionsClosed, 1);
    assert.equal(clock.pendingTimers(), 0);
  });

  it('does not open anything when already aborted or when no stream URL is configured', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const a = setup({ signal: aborted.signal });
    const r1 = await grabFrameFromStream(STREAM, a.options);
    assert.equal(r1.ok, false);
    assert.equal(a.images.length, 0);

    const b = setup();
    const r2 = await grabFrameFromStream('', b.options);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.failure.kind, 'load-failed');
    assert.equal(b.images.length, 0);
  });
});

describe('withCacheBuster', () => {
  it('adds the parameter with ? or & as needed', () => {
    assert.equal(withCacheBuster('http://cam/stream', 5), 'http://cam/stream?_snap=5');
    assert.equal(withCacheBuster('http://cam/stream?a=1', 5), 'http://cam/stream?a=1&_snap=5');
  });
});

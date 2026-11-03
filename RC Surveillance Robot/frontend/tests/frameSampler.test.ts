/**
 * Motion detection: frame sampler tests (MOCKED canvas). They prove how pixel-access failures
 * are classified. How a real browser tags a real camera image as tainted was checked separately.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKED_MESSAGE, CanvasFrameSampler, isSampleFailure } from '../src/services/frameSampler';
import { SAMPLE_HEIGHT, SAMPLE_PIXELS, SAMPLE_WIDTH } from '../src/services/motionDetector';
import { RECT_5, frame, grayToRgba, samplerCanvasFactory } from './motionFakes';
import { namedError } from './snapshotFakes';

const loaded = { complete: true, naturalWidth: 640, naturalHeight: 480 };

describe('CanvasFrameSampler', () => {
  it('shrinks the picture to the sample size and returns real grayscale pixels', () => {
    const expected = frame({ rects: [RECT_5] });
    const { canvases, createCanvas } = samplerCanvasFactory({ rgba: grayToRgba(expected) });
    const sampler = new CanvasFrameSampler(() => loaded, { createCanvas });
    const out = new Uint8Array(SAMPLE_PIXELS);

    const result = sampler.sample(out);
    assert.equal(result.ok, true);
    assert.deepEqual(out, expected, 'the pixels that were read are the pixels returned');
    assert.equal(canvases.length, 1);
    assert.equal(canvases[0].width, SAMPLE_WIDTH);
    assert.equal(canvases[0].height, SAMPLE_HEIGHT);
    assert.deepEqual(canvases[0].drawCalls, [{ dw: SAMPLE_WIDTH, dh: SAMPLE_HEIGHT }]);
    assert.deepEqual(canvases[0].contextOptions, [{ willReadFrequently: true }]);
  });

  it('reuses one canvas for every check', () => {
    const { canvases, createCanvas } = samplerCanvasFactory();
    const sampler = new CanvasFrameSampler(() => loaded, { createCanvas });
    const out = new Uint8Array(SAMPLE_PIXELS);
    for (let i = 0; i < 25; i++) assert.equal(sampler.sample(out).ok, true);
    assert.equal(canvases.length, 1);
    assert.equal(canvases[0].getImageDataCalls, 25);
  });

  it('reports "no-frame" without touching a canvas when nothing is decoded yet', () => {
    const { canvases, createCanvas } = samplerCanvasFactory();
    for (const img of [null, { complete: false, naturalWidth: 640, naturalHeight: 480 }, { complete: true, naturalWidth: 0, naturalHeight: 0 }]) {
      const result = new CanvasFrameSampler(() => img, { createCanvas }).sample(new Uint8Array(SAMPLE_PIXELS));
      assert.equal(result.ok, false);
      if (isSampleFailure(result)) assert.equal(result.kind, 'no-frame');
    }
    assert.equal(canvases.length, 0);
  });

  it('reports a canvas SecurityError (cross-origin picture) as "blocked" and returns no pixels', () => {
    const { createCanvas } = samplerCanvasFactory({
      getImageDataThrows: namedError('SecurityError', "Failed to execute 'getImageData': The canvas has been tainted by cross-origin data."),
    });
    const out = new Uint8Array(SAMPLE_PIXELS).fill(7);
    const result = new CanvasFrameSampler(() => loaded, { createCanvas }).sample(out);
    assert.equal(result.ok, false);
    if (isSampleFailure(result)) {
      assert.equal(result.kind, 'blocked');
      assert.equal(result.message, BLOCKED_MESSAGE);
      assert.match(result.detail ?? '', /tainted/);
    }
    assert.ok(out.every((v) => v === 7), 'the output buffer was left untouched');
  });

  it('reports another read failure as "decode-failed", not as a security problem', () => {
    const drawFails = new CanvasFrameSampler(() => loaded, {
      createCanvas: samplerCanvasFactory({ drawImageThrows: namedError('InvalidStateError', 'The image argument is a broken image') }).createCanvas,
    }).sample(new Uint8Array(SAMPLE_PIXELS));
    assert.equal(drawFails.ok, false);
    if (isSampleFailure(drawFails)) assert.equal(drawFails.kind, 'decode-failed');

    const readFails = new CanvasFrameSampler(() => loaded, {
      createCanvas: samplerCanvasFactory({ getImageDataThrows: namedError('IndexSizeError') }).createCanvas,
    }).sample(new Uint8Array(SAMPLE_PIXELS));
    if (isSampleFailure(readFails)) assert.equal(readFails.kind, 'decode-failed');
  });

  it('reports a result of the wrong size as "decode-failed"', () => {
    const { createCanvas } = samplerCanvasFactory({ rgba: new Uint8ClampedArray(100) });
    const result = new CanvasFrameSampler(() => loaded, { createCanvas }).sample(new Uint8Array(SAMPLE_PIXELS));
    assert.equal(result.ok, false);
    if (isSampleFailure(result)) assert.equal(result.kind, 'decode-failed');
  });

  it('reports a missing 2D context or a failing canvas constructor as "canvas-unavailable"', () => {
    const noContext = new CanvasFrameSampler(() => loaded, { createCanvas: samplerCanvasFactory({ noContext: true }).createCanvas }).sample(
      new Uint8Array(SAMPLE_PIXELS),
    );
    const throwing = new CanvasFrameSampler(() => loaded, {
      createCanvas: samplerCanvasFactory({ constructorThrows: new Error('nope') }).createCanvas,
    }).sample(new Uint8Array(SAMPLE_PIXELS));
    for (const result of [noContext, throwing]) {
      assert.equal(result.ok, false);
      if (isSampleFailure(result)) assert.equal(result.kind, 'canvas-unavailable');
    }
  });

  it('release() frees the canvas, and the sampler works again afterwards with a new one', () => {
    const { canvases, createCanvas } = samplerCanvasFactory();
    const sampler = new CanvasFrameSampler(() => loaded, { createCanvas });
    const out = new Uint8Array(SAMPLE_PIXELS);
    sampler.sample(out);
    sampler.release();
    assert.equal(canvases[0].width, 0, 'the bitmap is released immediately');
    assert.equal(canvases[0].height, 0);
    sampler.release(); // idempotent
    assert.equal(sampler.sample(out).ok, true);
    assert.equal(canvases.length, 2);
  });
});

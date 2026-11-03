/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FrameImage } from './frameCapture';
import { SAMPLE_HEIGHT, SAMPLE_PIXELS, SAMPLE_WIDTH, rgbaToGray } from './motionDetector';

/**
 * Motion detection, step 2: read a small grayscale picture out of the stream element.
 *
 * This reuses the element the dashboard already shows (no second connection to the camera). The
 * browser lets a page read an image's pixels only if the image is not cross-origin "tainted":
 * the stream must be requested with CORS (Settings > Allow snapshot capture, or Frame monitor)
 * and the camera must send Access-Control-Allow-Origin. Otherwise getImageData() throws
 * SecurityError and this reports 'blocked'. Nothing is ever invented in that case.
 *
 * One canvas of SAMPLE_WIDTH x SAMPLE_HEIGHT is created lazily, reused for every check, and
 * released by release(), so a check costs one small drawImage plus a 12 kB read.
 */

export type SampleFailureKind =
  /** The element has no decoded picture yet (stream still connecting, or the image broke). */
  | 'no-frame'
  /** The browser refuses to expose the pixels (canvas tainted, SecurityError). */
  | 'blocked'
  /** drawImage/getImageData failed for another reason. */
  | 'decode-failed'
  | 'canvas-unavailable';

export type SampleResult =
  | { ok: true }
  | { ok: false; kind: SampleFailureKind; message: string; detail?: string };

/** Type guard. (The app's tsconfig is not strict, where narrowing on `ok` alone does not work.) */
export function isSampleFailure(
  result: SampleResult,
): result is { ok: false; kind: SampleFailureKind; message: string; detail?: string } {
  return !result.ok;
}

export interface FrameSampler {
  /** Fill `out` (SAMPLE_PIXELS bytes) with the current picture as grayscale. */
  sample(out: Uint8Array): SampleResult;
  /** Free the canvas. The sampler can be used again afterwards. */
  release(): void;
}

export interface SamplerContext {
  drawImage(image: never, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: ArrayLike<number> };
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality?: string;
}

export interface SamplerCanvas {
  width: number;
  height: number;
  getContext(contextId: '2d', options?: { willReadFrequently?: boolean }): SamplerContext | null;
}

export interface SamplerDeps {
  createCanvas: () => SamplerCanvas;
}

const defaultDeps: SamplerDeps = {
  createCanvas: () => document.createElement('canvas') as unknown as SamplerCanvas,
};

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export const BLOCKED_MESSAGE =
  'The browser will not let this page read the live picture (cross-origin security), so motion cannot be measured.';

export class CanvasFrameSampler implements FrameSampler {
  private canvas: SamplerCanvas | null = null;
  private ctx: SamplerContext | null = null;
  private readonly deps: SamplerDeps;

  constructor(
    private readonly getImage: () => FrameImage | null,
    deps: Partial<SamplerDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

  sample(out: Uint8Array): SampleResult {
    const img = this.getImage();
    if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      return { ok: false, kind: 'no-frame', message: 'There is no decoded video frame to read yet.' };
    }

    if (!this.ctx) {
      try {
        const canvas = this.deps.createCanvas();
        canvas.width = SAMPLE_WIDTH;
        canvas.height = SAMPLE_HEIGHT;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return { ok: false, kind: 'canvas-unavailable', message: 'This browser could not create a canvas to read the frame.' };
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high'; // averages when shrinking 640x480 to 64x48, which suppresses sensor noise
        this.canvas = canvas;
        this.ctx = ctx;
      } catch (err) {
        return { ok: false, kind: 'canvas-unavailable', message: 'This browser could not create a canvas to read the frame.', detail: errorText(err) };
      }
    }

    let data: ArrayLike<number>;
    try {
      this.ctx.drawImage(img as never, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      // A cross-origin ("tainted") canvas refuses here, not in drawImage.
      data = this.ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
    } catch (err) {
      if (errorName(err) === 'SecurityError') {
        return { ok: false, kind: 'blocked', message: BLOCKED_MESSAGE, detail: errorText(err) };
      }
      return { ok: false, kind: 'decode-failed', message: 'The browser could not read the current frame.', detail: errorText(err) };
    }

    if (data.length !== SAMPLE_PIXELS * 4 || out.length < SAMPLE_PIXELS) {
      return { ok: false, kind: 'decode-failed', message: 'The browser returned a frame of an unexpected size.' };
    }
    rgbaToGray(data, out);
    return { ok: true };
  }

  release(): void {
    if (this.canvas) {
      // Setting the size to 0 frees the bitmap immediately instead of waiting for garbage collection.
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.ctx = null;
  }
}

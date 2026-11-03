/**
 * Test doubles for motion detection. Frames are generated deterministically (seeded noise), so
 * no camera, canvas or browser is involved. Results from these prove the algorithm and the
 * supervisor's rules; they say nothing about how a real ESP32-CAM picture behaves.
 */

import { SAMPLE_HEIGHT, SAMPLE_PIXELS, SAMPLE_WIDTH } from '../src/services/motionDetector';
import type { FrameSampler, SampleFailureKind, SampleResult } from '../src/services/frameSampler';
import type { VisibilityApi } from '../src/services/motionMonitor';
import type { SamplerCanvas, SamplerContext } from '../src/services/frameSampler';

/** Small seeded PRNG (mulberry32): the same seed always gives the same noise. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  level: number;
}

export interface FrameSpec {
  /** Background brightness. Default 100. */
  base?: number;
  rects?: Rect[];
  /** Uniform noise of +-noise gray levels per pixel, from `seed`. */
  noise?: number;
  seed?: number;
  /** Added to every pixel (an exposure / lighting change). */
  shift?: number;
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function frame(spec: FrameSpec = {}): Uint8Array {
  const out = new Uint8Array(SAMPLE_PIXELS).fill(clamp(spec.base ?? 100));
  for (const r of spec.rects ?? []) {
    for (let y = r.y; y < r.y + r.h && y < SAMPLE_HEIGHT; y++) {
      for (let x = r.x; x < r.x + r.w && x < SAMPLE_WIDTH; x++) out[y * SAMPLE_WIDTH + x] = clamp(r.level);
    }
  }
  if (spec.noise) {
    const rnd = prng(spec.seed ?? 1);
    for (let i = 0; i < out.length; i++) out[i] = clamp(out[i] + (rnd() * 2 - 1) * spec.noise);
  }
  if (spec.shift) for (let i = 0; i < out.length; i++) out[i] = clamp(out[i] + (spec.shift as number));
  return out;
}

/** Percent of the 64x48 picture a w x h rectangle covers. */
export const percentOf = (w: number, h: number) => ((w * h) / SAMPLE_PIXELS) * 100;

/** Rectangles of known size: 14x11 = 5.0%, 24x20 = 15.6%, 12x8 = 3.1%, 5x4 = 0.65%. */
export const RECT_5: Rect = { x: 2, y: 2, w: 14, h: 11, level: 220 };
export const RECT_5_RIGHT: Rect = { x: 46, y: 30, w: 14, h: 11, level: 220 };
export const RECT_BIG: Rect = { x: 4, y: 4, w: 24, h: 20, level: 230 };
export const RECT_BIG_RIGHT: Rect = { x: 36, y: 24, w: 24, h: 20, level: 230 };
export const RECT_3: Rect = { x: 2, y: 2, w: 12, h: 8, level: 220 };
export const RECT_TINY: Rect = { x: 2, y: 2, w: 5, h: 4, level: 220 };

// ---------------------------------------------------------------- sampler --

type Failure = Extract<SampleResult, { ok: false }>;

/** A FrameSampler whose "camera picture" the test sets directly. */
export class ScriptedSampler implements FrameSampler {
  current: Uint8Array | null = null;
  failure: Failure | null = null;
  throwOnSample: Error | null = null;
  samples = 0;
  releases = 0;

  /** What the camera shows from now on (until the next call). */
  show(f: Uint8Array): void {
    this.current = f;
    this.failure = null;
  }
  fail(kind: SampleFailureKind, message = `sample failed: ${kind}`): void {
    this.failure = { ok: false, kind, message };
  }

  sample(out: Uint8Array): SampleResult {
    this.samples++;
    if (this.throwOnSample) throw this.throwOnSample;
    if (this.failure) return this.failure;
    if (!this.current) return { ok: false, kind: 'no-frame', message: 'nothing is shown yet' };
    out.set(this.current);
    return { ok: true };
  }
  release(): void {
    this.releases++;
  }
}

// ------------------------------------------------------------- visibility --

export class FakeVisibility implements VisibilityApi {
  visible = true;
  listeners = new Set<() => void>();
  isVisible(): boolean {
    return this.visible;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** The tab is hidden or shown. */
  set(visible: boolean): void {
    this.visible = visible;
    for (const l of [...this.listeners]) l();
  }
}

// ---------------------------------------------------- canvas for the sampler --

export function grayToRgba(gray: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    rgba[i * 4] = gray[i];
    rgba[i * 4 + 1] = gray[i];
    rgba[i * 4 + 2] = gray[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export interface FakeCanvasOptions {
  /** What getImageData returns. */
  rgba?: ArrayLike<number>;
  getImageDataThrows?: Error;
  drawImageThrows?: Error;
  noContext?: boolean;
  constructorThrows?: Error;
}

export class FakeSamplerCanvas implements SamplerCanvas {
  width = 0;
  height = 0;
  drawCalls: Array<{ dw: number; dh: number }> = [];
  getImageDataCalls = 0;
  contextOptions: unknown[] = [];

  constructor(private readonly options: FakeCanvasOptions) {}

  getContext(_id: '2d', opts?: { willReadFrequently?: boolean }): SamplerContext | null {
    this.contextOptions.push(opts);
    if (this.options.noContext) return null;
    return {
      imageSmoothingEnabled: false,
      drawImage: (_image: never, _dx: number, _dy: number, dw: number, dh: number) => {
        if (this.options.drawImageThrows) throw this.options.drawImageThrows;
        this.drawCalls.push({ dw, dh });
      },
      getImageData: () => {
        this.getImageDataCalls++;
        if (this.options.getImageDataThrows) throw this.options.getImageDataThrows;
        return { data: this.options.rgba ?? grayToRgba(frame()) };
      },
    };
  }
}

export function samplerCanvasFactory(options: FakeCanvasOptions = {}) {
  const canvases: FakeSamplerCanvas[] = [];
  return {
    canvases,
    createCanvas: (): SamplerCanvas => {
      if (options.constructorThrows) throw options.constructorThrows;
      const c = new FakeSamplerCanvas(options);
      canvases.push(c);
      return c;
    },
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MotionRegion } from '../types/motion';

/**
 * Motion detection, step 1: the pure frame-comparison algorithm. No browser APIs, so every rule
 * here is testable with generated frames.
 *
 * A frame is a small grayscale picture (SAMPLE_WIDTH x SAMPLE_HEIGHT, one byte per pixel).
 * Two consecutive frames are compared like this:
 *
 *  1. Brightness compensation: the MEDIAN of (current - previous) over the watched region is taken
 *     as a whole-picture brightness shift (automatic exposure, a lamp switching on) and subtracted.
 *     A median is used, not a mean, so a moving object that covers a minority of the picture does
 *     not shift the baseline and make the rest of the picture look changed.
 *  2. A pixel is "changed" if |current - previous - shift| is MORE than the noise tolerance.
 *  3. changedPercent = changed pixels / pixels in the watched region * 100.
 *
 * Whether that is an alert (minimum area, consecutive frames, cooldown) is decided by MotionMonitor.
 */

export const SAMPLE_WIDTH = 64;
export const SAMPLE_HEIGHT = 48;
export const SAMPLE_PIXELS = SAMPLE_WIDTH * SAMPLE_HEIGHT;

/** Half-open pixel rectangle: x0 <= x < x1, y0 <= y < y1. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function regionBounds(region: MotionRegion, width = SAMPLE_WIDTH, height = SAMPLE_HEIGHT): Bounds {
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  switch (region) {
    case 'center':
      return { x0: Math.floor(width / 4), y0: Math.floor(height / 4), x1: Math.floor((width * 3) / 4), y1: Math.floor((height * 3) / 4) };
    case 'left':
      return { x0: 0, y0: 0, x1: halfW, y1: height };
    case 'right':
      return { x0: halfW, y0: 0, x1: width, y1: height };
    case 'top':
      return { x0: 0, y0: 0, x1: width, y1: halfH };
    case 'bottom':
      return { x0: 0, y0: halfH, x1: width, y1: height };
    default:
      return { x0: 0, y0: 0, x1: width, y1: height };
  }
}

/** RGBA bytes -> one luma byte per pixel (integer Rec. 601 weights, no allocation). */
export function rgbaToGray(rgba: ArrayLike<number>, out: Uint8Array): void {
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
}

/** 32-bit FNV-1a hash of the frame, used to recognise the very same picture being read twice. */
export function frameChecksum(frame: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < frame.length; i++) {
    h ^= frame[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface ComparisonParams {
  /** Noise tolerance in gray levels (0-255). A pixel must differ by more than this. */
  pixelThreshold: number;
  region: MotionRegion;
  /** Default true. */
  compensateBrightness?: boolean;
}

export interface ComparisonResult {
  changedPixels: number;
  regionPixels: number;
  /** Percent of the watched region, 0-100. */
  changedPercent: number;
  /** Whole-picture brightness shift that was removed (gray levels). */
  brightnessShift: number;
}

// 511 bins: a difference of two bytes is -255..255.
const histogram = new Int32Array(511);

export function compareFrames(
  prev: Uint8Array,
  curr: Uint8Array,
  params: ComparisonParams,
  width = SAMPLE_WIDTH,
  height = SAMPLE_HEIGHT,
): ComparisonResult {
  const { x0, y0, x1, y1 } = regionBounds(params.region, width, height);
  const regionPixels = Math.max(0, (x1 - x0) * (y1 - y0));
  if (regionPixels === 0 || prev.length !== curr.length || prev.length < width * height) {
    return { changedPixels: 0, regionPixels, changedPercent: 0, brightnessShift: 0 };
  }

  let shift = 0;
  if (params.compensateBrightness !== false) {
    histogram.fill(0);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        histogram[curr[i] - prev[i] + 255]++;
      }
    }
    const half = regionPixels / 2;
    let seen = 0;
    for (let bin = 0; bin < histogram.length; bin++) {
      seen += histogram[bin];
      if (seen >= half) {
        shift = bin - 255;
        break;
      }
    }
  }

  let changedPixels = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      if (Math.abs(curr[i] - prev[i] - shift) > params.pixelThreshold) changedPixels++;
    }
  }
  return {
    changedPixels,
    regionPixels,
    changedPercent: (changedPixels / regionPixels) * 100,
    brightnessShift: shift,
  };
}

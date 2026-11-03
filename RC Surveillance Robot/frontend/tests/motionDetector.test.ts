/**
 * Motion detection: algorithm and settings tests. Frames are generated deterministically
 * (tests/motionFakes.ts); no camera or browser is involved.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_PIXELS,
  compareFrames,
  frameChecksum,
  regionBounds,
  rgbaToGray,
} from '../src/services/motionDetector';
import {
  DEFAULT_MOTION_SETTINGS,
  MIN_CHANGED_PERCENT_FLOOR,
  MOTION_SETTINGS_KEY,
  SENSITIVITY_PRESETS,
  effectiveParams,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../src/services/motionSettings';
import { FakeStore } from './helpers';
import { RECT_3, RECT_5, RECT_BIG, RECT_TINY, frame, grayToRgba, percentOf } from './motionFakes';

const MEDIUM = { pixelThreshold: SENSITIVITY_PRESETS.medium.pixelThreshold, region: 'full' as const };

describe('compareFrames', () => {
  it('finds no change between identical frames', () => {
    const a = frame({ rects: [RECT_BIG] });
    const r = compareFrames(a, new Uint8Array(a), MEDIUM);
    assert.equal(r.changedPixels, 0);
    assert.equal(r.changedPercent, 0);
    assert.equal(r.regionPixels, SAMPLE_PIXELS);
  });

  it('measures the area of a new object as a percentage of the picture', () => {
    const r = compareFrames(frame(), frame({ rects: [RECT_5] }), MEDIUM);
    assert.equal(r.changedPixels, 14 * 11);
    assert.ok(Math.abs(r.changedPercent - percentOf(14, 11)) < 1e-9);
  });

  it('is symmetric: an object appearing and disappearing both register', () => {
    const empty = frame();
    const withObject = frame({ rects: [RECT_5] });
    assert.equal(compareFrames(empty, withObject, MEDIUM).changedPixels, compareFrames(withObject, empty, MEDIUM).changedPixels);
  });

  it('tolerates sensor noise below the pixel threshold', () => {
    // +-8 gray levels everywhere, independent noise in each frame: two frames can differ by at most 16
    // (plus a median shift of at most 1), which is under even the most sensitive tolerance of 18.
    const r = compareFrames(frame({ noise: 8, seed: 1 }), frame({ noise: 8, seed: 2 }), {
      pixelThreshold: SENSITIVITY_PRESETS.high.pixelThreshold,
      region: 'full',
    });
    assert.equal(r.changedPercent, 0);
  });

  it('counts noise above the threshold, which is why High sensitivity is more prone to false alerts', () => {
    // +-19: two frames differ by up to 38 levels, which is over High's tolerance (18) but under Low's (40).
    const a = frame({ noise: 19, seed: 1 });
    const b = frame({ noise: 19, seed: 2 });
    const high = compareFrames(a, b, { pixelThreshold: SENSITIVITY_PRESETS.high.pixelThreshold, region: 'full' });
    const low = compareFrames(a, b, { pixelThreshold: SENSITIVITY_PRESETS.low.pixelThreshold, region: 'full' });
    assert.ok(high.changedPercent > 10, 'heavy noise shows up as change at High');
    assert.equal(low.changedPercent, 0, 'but not at Low (tolerance 40)');
  });

  it('uses "more than" the threshold: a difference exactly at it is not a change', () => {
    const r = compareFrames(frame({ base: 100 }), frame({ base: 100, rects: [{ x: 0, y: 0, w: 64, h: 48, level: 128 }] }), {
      pixelThreshold: 28,
      region: 'full',
      compensateBrightness: false,
    });
    assert.equal(r.changedPixels, 0);
  });

  it('ignores a whole-picture brightness change (auto exposure, a lamp) by removing the median shift', () => {
    const r = compareFrames(frame({ base: 100 }), frame({ base: 100, shift: 45 }), MEDIUM);
    assert.equal(r.brightnessShift, 45);
    assert.equal(r.changedPercent, 0);
    const raw = compareFrames(frame({ base: 100 }), frame({ base: 100, shift: 45 }), { ...MEDIUM, compensateBrightness: false });
    assert.equal(raw.changedPercent, 100, 'without compensation the same change is everything');
  });

  it('still sees a moving object during a brightness change, without inflating it to the whole picture', () => {
    const r = compareFrames(frame(), frame({ rects: [RECT_5], shift: 20 }), MEDIUM);
    assert.equal(r.brightnessShift, 20);
    assert.equal(r.changedPixels, 14 * 11);
  });

  it('a large object does not shift the median, so the rest of the picture is not counted as changed', () => {
    const r = compareFrames(frame(), frame({ rects: [RECT_BIG] }), MEDIUM);
    assert.equal(r.brightnessShift, 0);
    assert.equal(r.changedPixels, 24 * 20);
  });

  it('measures only the watched region', () => {
    // RECT_5 sits in the top-left corner.
    const before = frame();
    const after = frame({ rects: [RECT_5] });
    const left = compareFrames(before, after, { ...MEDIUM, region: 'left' });
    const right = compareFrames(before, after, { ...MEDIUM, region: 'right' });
    assert.equal(left.changedPixels, 14 * 11);
    assert.equal(left.regionPixels, SAMPLE_PIXELS / 2);
    assert.ok(Math.abs(left.changedPercent - percentOf(14, 11) * 2) < 1e-9, 'percent is relative to the region');
    assert.equal(right.changedPixels, 0, 'a change outside the region is ignored');
    assert.equal(compareFrames(before, after, { ...MEDIUM, region: 'bottom' }).changedPixels, 0);
    assert.equal(compareFrames(before, after, { ...MEDIUM, region: 'top' }).changedPixels, 14 * 11);
    assert.equal(compareFrames(before, after, { ...MEDIUM, region: 'center' }).changedPixels, 0, 'the corner object is outside the centre area');

    const inCentre = frame({ rects: [{ x: 20, y: 14, w: 10, h: 10, level: 220 }] });
    const centre = compareFrames(before, inCentre, { ...MEDIUM, region: 'center' });
    assert.equal(centre.changedPixels, 100);
    assert.equal(centre.regionPixels, 32 * 24);
    assert.equal(compareFrames(before, inCentre, { ...MEDIUM, region: 'full' }).changedPixels, 100);
  });

  it('returns no change for mismatched or empty input instead of throwing', () => {
    assert.equal(compareFrames(new Uint8Array(10), new Uint8Array(20), MEDIUM).changedPercent, 0);
    assert.equal(compareFrames(new Uint8Array(0), new Uint8Array(0), MEDIUM).changedPercent, 0);
  });
});

describe('regionBounds', () => {
  it('describes each watched area in sample pixels', () => {
    assert.deepEqual(regionBounds('full'), { x0: 0, y0: 0, x1: 64, y1: 48 });
    assert.deepEqual(regionBounds('left'), { x0: 0, y0: 0, x1: 32, y1: 48 });
    assert.deepEqual(regionBounds('right'), { x0: 32, y0: 0, x1: 64, y1: 48 });
    assert.deepEqual(regionBounds('top'), { x0: 0, y0: 0, x1: 64, y1: 24 });
    assert.deepEqual(regionBounds('bottom'), { x0: 0, y0: 24, x1: 64, y1: 48 });
    assert.deepEqual(regionBounds('center'), { x0: 16, y0: 12, x1: 48, y1: 36 });
  });
});

describe('frame helpers', () => {
  it('rgbaToGray uses luma weights and handles black, white and colour', () => {
    const out = new Uint8Array(3);
    rgbaToGray([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255], out);
    assert.equal(out[0], 0);
    assert.equal(out[1], 255);
    assert.equal(out[2], (255 * 77) >> 8, 'pure red');
  });

  it('frameChecksum is equal for equal frames and different when one pixel differs', () => {
    const a = frame({ noise: 5, seed: 3 });
    assert.equal(frameChecksum(a), frameChecksum(new Uint8Array(a)));
    const b = new Uint8Array(a);
    b[1000] = (b[1000] + 1) & 255;
    assert.notEqual(frameChecksum(a), frameChecksum(b));
  });

  it('grayToRgba and rgbaToGray round-trip', () => {
    const g = frame({ noise: 40, seed: 9 });
    const back = new Uint8Array(g.length);
    rgbaToGray(grayToRgba(g), back);
    for (let i = 0; i < g.length; i++) assert.ok(Math.abs(back[i] - g[i]) <= 1);
  });
});

describe('sensitivity presets', () => {
  it('are ordered: more sensitive means a lower noise tolerance and a smaller required area', () => {
    const { low, medium, high } = SENSITIVITY_PRESETS;
    assert.ok(low.pixelThreshold > medium.pixelThreshold && medium.pixelThreshold > high.pixelThreshold);
    assert.ok(low.minChangedPercent > medium.minChangedPercent && medium.minChangedPercent > high.minChangedPercent);
    assert.deepEqual([low.pixelThreshold, low.minChangedPercent], [40, 8]);
    assert.deepEqual([medium.pixelThreshold, medium.minChangedPercent], [28, 4]);
    assert.deepEqual([high.pixelThreshold, high.minChangedPercent], [18, 1.5]);
  });

  it('give different answers for the same pair of frames', () => {
    // A 3.1% object (RECT_3): only High's 1.5% minimum is met.
    const before = frame();
    const after = frame({ rects: [RECT_3] });
    const meets = (s: 'low' | 'medium' | 'high') => {
      const p = effectiveParams({ ...DEFAULT_MOTION_SETTINGS, sensitivity: s });
      const r = compareFrames(before, after, { pixelThreshold: p.pixelThreshold, region: 'full' });
      return r.changedPercent >= p.minChangedPercent;
    };
    assert.deepEqual([meets('low'), meets('medium'), meets('high')], [false, false, true]);

    // A 5% object: Medium and High meet it, Low (8%) does not.
    const after5 = frame({ rects: [RECT_5] });
    const meets5 = (s: 'low' | 'medium' | 'high') => {
      const p = effectiveParams({ ...DEFAULT_MOTION_SETTINGS, sensitivity: s });
      return compareFrames(before, after5, { pixelThreshold: p.pixelThreshold, region: 'full' }).changedPercent >= p.minChangedPercent;
    };
    assert.deepEqual([meets5('low'), meets5('medium'), meets5('high')], [false, true, true]);
  });

  it('a subtle brightness change inside an object is a change at High but not at Low', () => {
    const before = frame();
    const after = frame({ rects: [{ ...RECT_BIG, level: 130 }] }); // +30 inside the rectangle
    const changed = (s: 'low' | 'medium' | 'high') =>
      compareFrames(before, after, { pixelThreshold: SENSITIVITY_PRESETS[s].pixelThreshold, region: 'full' }).changedPixels;
    assert.equal(changed('low'), 0);
    assert.equal(changed('medium'), 24 * 20, '30 > 28');
    assert.equal(changed('high'), 24 * 20);
  });
});

describe('minimum changed area', () => {
  it('uses the preset unless the user sets a value, and never goes below the floor', () => {
    assert.equal(effectiveParams({ ...DEFAULT_MOTION_SETTINGS, sensitivity: 'medium' }).minChangedPercent, 4);
    assert.equal(effectiveParams({ ...DEFAULT_MOTION_SETTINGS, minChangedPercent: 10 }).minChangedPercent, 10);
    assert.equal(effectiveParams({ ...DEFAULT_MOTION_SETTINGS, minChangedPercent: 0.1 }).minChangedPercent, MIN_CHANGED_PERCENT_FLOOR);
  });

  it('a tiny change (0.65% of the picture) is below even the High preset', () => {
    const r = compareFrames(frame(), frame({ rects: [RECT_TINY] }), { pixelThreshold: 18, region: 'full' });
    assert.ok(r.changedPercent < SENSITIVITY_PRESETS.high.minChangedPercent);
    assert.ok(r.changedPercent > 0);
  });
});

describe('settings', () => {
  it('defaults are conservative', () => {
    assert.equal(DEFAULT_MOTION_SETTINGS.sensitivity, 'medium');
    assert.equal(DEFAULT_MOTION_SETTINGS.confirmFrames, 2);
    assert.equal(DEFAULT_MOTION_SETTINGS.cooldownSec, 15);
    assert.equal(DEFAULT_MOTION_SETTINGS.captureSnapshot, false, 'automatic snapshots are opt-in');
    assert.equal(DEFAULT_MOTION_SETTINGS.region, 'full');
  });

  it('normalizeSettings clamps and rejects invalid values', () => {
    const s = normalizeSettings({
      sensitivity: 'extreme',
      minChangedPercent: 0.01,
      cooldownSec: -5,
      intervalMs: 10,
      confirmFrames: 99,
      region: 'toString',
      captureSnapshot: 'yes',
    });
    assert.equal(s.sensitivity, 'medium');
    assert.equal(s.minChangedPercent, MIN_CHANGED_PERCENT_FLOOR);
    assert.equal(s.cooldownSec, 1);
    assert.equal(s.intervalMs, 250);
    assert.equal(s.confirmFrames, 5);
    assert.equal(s.region, 'full', 'inherited property names are not regions');
    assert.equal(s.captureSnapshot, false);
    assert.deepEqual(normalizeSettings(null), DEFAULT_MOTION_SETTINGS);
    assert.deepEqual(normalizeSettings('garbage'), DEFAULT_MOTION_SETTINGS);
    assert.equal(normalizeSettings({ minChangedPercent: '' }).minChangedPercent, null);
    assert.equal(normalizeSettings({ minChangedPercent: 999 }).minChangedPercent, 50);
  });

  it('saves and loads, and falls back to the defaults for missing, damaged or unreadable storage', () => {
    const store = new FakeStore();
    assert.deepEqual(loadSettings(store), DEFAULT_MOTION_SETTINGS);
    assert.equal(saveSettings(store, { ...DEFAULT_MOTION_SETTINGS, sensitivity: 'high', captureSnapshot: true }), true);
    assert.equal(loadSettings(store).sensitivity, 'high');
    assert.equal(loadSettings(store).captureSnapshot, true);

    store.data.set(MOTION_SETTINGS_KEY, '{not json');
    assert.deepEqual(loadSettings(store), DEFAULT_MOTION_SETTINGS);
    store.failGet = new Error('blocked');
    assert.deepEqual(loadSettings(store), DEFAULT_MOTION_SETTINGS);
    assert.deepEqual(loadSettings(null), DEFAULT_MOTION_SETTINGS);
  });

  it('reports a storage failure when saving instead of throwing', () => {
    const store = new FakeStore();
    store.failSet = new Error('QuotaExceededError');
    assert.equal(saveSettings(store, DEFAULT_MOTION_SETTINGS), false);
    assert.equal(saveSettings(null, DEFAULT_MOTION_SETTINGS), false);
  });
});

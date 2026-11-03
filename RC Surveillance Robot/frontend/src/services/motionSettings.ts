/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MotionRegion, MotionSensitivity, MotionSettings } from '../types/motion';
import type { KeyValueStore } from './connectionHistory';

/**
 * Motion detection settings and the documented thresholds behind the Low / Medium / High labels.
 *
 * The numbers below are starting points chosen to be conservative (few false alerts). They were
 * NOT tuned on the real camera, whose picture noise, exposure behaviour and frame rate are not
 * known; expect to adjust them.
 */

export const MOTION_SETTINGS_KEY = 'rc_surveillance_motion_settings_v1';

export interface SensitivityPreset {
  label: string;
  /**
   * Noise tolerance: a pixel counts as changed only if its brightness (0-255, after removing a
   * whole-picture brightness shift) differs by MORE than this from the previous frame.
   */
  pixelThreshold: number;
  /** Alert only if at least this percent of the watched area changed. */
  minChangedPercent: number;
  description: string;
}

export const SENSITIVITY_PRESETS: Record<MotionSensitivity, SensitivityPreset> = {
  low: {
    label: 'Low',
    pixelThreshold: 40,
    minChangedPercent: 8,
    description: 'Only large, clear movement (about 8% of the picture). Fewest false alerts.',
  },
  medium: {
    label: 'Medium',
    pixelThreshold: 28,
    minChangedPercent: 4,
    description: 'A person-sized movement a few metres away (about 4% of the picture).',
  },
  high: {
    label: 'High',
    pixelThreshold: 18,
    minChangedPercent: 1.5,
    description: 'Small movements (about 1.5% of the picture). More false alerts from light and noise.',
  },
};

/** Whatever the user enters, a change smaller than this share of the region is never an alert. */
export const MIN_CHANGED_PERCENT_FLOOR = 0.5;
export const MAX_CHANGED_PERCENT = 50;

export const COOLDOWN_OPTIONS_SEC = [5, 10, 15, 30, 60, 120, 300] as const;
export const INTERVAL_OPTIONS_MS = [250, 500, 1000, 2000, 5000] as const;
export const CONFIRM_FRAME_OPTIONS = [1, 2, 3] as const;

export const REGION_LABELS: Record<MotionRegion, string> = {
  full: 'Whole picture',
  center: 'Centre (middle half)',
  left: 'Left half',
  right: 'Right half',
  top: 'Top half',
  bottom: 'Bottom half',
};

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  sensitivity: 'medium',
  minChangedPercent: null,
  cooldownSec: 15,
  intervalMs: 1000,
  confirmFrames: 2,
  region: 'full',
  captureSnapshot: false,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Accepts anything (stored JSON, form input) and returns valid settings; invalid fields fall back to defaults. */
export function normalizeSettings(input: unknown): MotionSettings {
  const d = DEFAULT_MOTION_SETTINGS;
  const src = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

  const sensitivity = src.sensitivity === 'low' || src.sensitivity === 'medium' || src.sensitivity === 'high' ? src.sensitivity : d.sensitivity;
  const region =
    typeof src.region === 'string' && Object.prototype.hasOwnProperty.call(REGION_LABELS, src.region)
      ? (src.region as MotionRegion)
      : d.region;

  let minChangedPercent: number | null = d.minChangedPercent;
  if (src.minChangedPercent !== null && src.minChangedPercent !== undefined && src.minChangedPercent !== '') {
    const n = Number(src.minChangedPercent);
    if (Number.isFinite(n)) {
      minChangedPercent = Math.round(Math.min(MAX_CHANGED_PERCENT, Math.max(MIN_CHANGED_PERCENT_FLOOR, n)) * 10) / 10;
    }
  }

  return {
    sensitivity,
    minChangedPercent,
    cooldownSec: clampInt(src.cooldownSec, 1, 600, d.cooldownSec),
    intervalMs: clampInt(src.intervalMs, 250, 10_000, d.intervalMs),
    confirmFrames: clampInt(src.confirmFrames, 1, 5, d.confirmFrames),
    region,
    captureSnapshot: typeof src.captureSnapshot === 'boolean' ? src.captureSnapshot : d.captureSnapshot,
  };
}

export interface EffectiveParams {
  pixelThreshold: number;
  minChangedPercent: number;
}

/** The thresholds actually in force: the preset, with an explicit minimum-area override applied. */
export function effectiveParams(settings: MotionSettings): EffectiveParams {
  const preset = SENSITIVITY_PRESETS[settings.sensitivity];
  const override = settings.minChangedPercent;
  return {
    pixelThreshold: preset.pixelThreshold,
    minChangedPercent: override == null ? preset.minChangedPercent : Math.max(MIN_CHANGED_PERCENT_FLOOR, override),
  };
}

export function loadSettings(store: KeyValueStore | null): MotionSettings {
  if (!store) return { ...DEFAULT_MOTION_SETTINGS };
  try {
    const raw = store.getItem(MOTION_SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_MOTION_SETTINGS };
  } catch {
    return { ...DEFAULT_MOTION_SETTINGS }; // unreadable storage or damaged JSON: start from the defaults
  }
}

/** False if the browser refused to save (the settings still apply for this page). */
export function saveSettings(store: KeyValueStore | null, settings: MotionSettings): boolean {
  if (!store) return false;
  try {
    store.setItem(MOTION_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

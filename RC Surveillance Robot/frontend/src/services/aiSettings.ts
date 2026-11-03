/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FILTERABLE_CATEGORIES, FilterableCategory } from '../../server/protocol';
import type { AiSettings } from '../types/ai';
import type { KeyValueStore } from './connectionHistory';

/**
 * Settings of the Groq AI recognition feature, saved in this browser (never the API key, which
 * exists only on the server). Everything that sends images outside this computer is OFF by default.
 */

export const AI_SETTINGS_KEY = 'rc_surveillance_ai_settings_v1';

/** Groq's documented limits for the preview vision model are small (see the README), so the choices start at 10 s. */
export const AI_COOLDOWN_OPTIONS_SEC = [10, 30, 60, 120, 300, 600] as const;
/** Two manual analyses closer together than this are treated as an accidental double click. */
export const MANUAL_MIN_INTERVAL_MS = 2000;

export const CATEGORY_LABELS: Record<FilterableCategory, string> = {
  person: 'People',
  animal: 'Animals',
  vehicle: 'Vehicles',
  other: 'Other objects',
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  autoOnMotion: false,
  autoAcknowledged: false,
  categories: { person: true, animal: true, vehicle: true, other: false },
  cooldownSec: 60,
  retainSnapshot: false,
};

/** Accepts anything (stored JSON, form input) and returns valid settings. Invalid fields fall back to the defaults. */
export function normalizeAiSettings(input: unknown): AiSettings {
  const d = DEFAULT_AI_SETTINGS;
  const src = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const rawCategories = typeof src.categories === 'object' && src.categories !== null ? (src.categories as Record<string, unknown>) : {};

  const categories = {} as Record<FilterableCategory, boolean>;
  for (const key of FILTERABLE_CATEGORIES) {
    categories[key] = typeof rawCategories[key] === 'boolean' ? (rawCategories[key] as boolean) : d.categories[key];
  }

  const cooldown = Number(src.cooldownSec);
  const cooldownSec = Number.isFinite(cooldown) ? Math.min(3600, Math.max(5, Math.round(cooldown))) : d.cooldownSec;
  const autoAcknowledged = src.autoAcknowledged === true;

  return {
    enabled: src.enabled === true,
    // Automatic analysis can only be on if the user acknowledged that images are sent to Groq.
    autoOnMotion: src.autoOnMotion === true && autoAcknowledged,
    autoAcknowledged,
    categories,
    cooldownSec,
    retainSnapshot: src.retainSnapshot === true,
  };
}

export function loadAiSettings(store: KeyValueStore | null): AiSettings {
  if (!store) return normalizeAiSettings(null);
  try {
    const raw = store.getItem(AI_SETTINGS_KEY);
    return normalizeAiSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeAiSettings(null); // unreadable storage or damaged JSON: start from the defaults
  }
}

/** False if the browser refused to save (the settings still apply for this page). */
export function saveAiSettings(store: KeyValueStore | null, settings: AiSettings): boolean {
  if (!store) return false;
  try {
    store.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/** True if at least one category is switched on, i.e. an event can ever qualify. */
export function anyCategoryEnabled(settings: AiSettings): boolean {
  return FILTERABLE_CATEGORIES.some((c) => settings.categories[c]);
}

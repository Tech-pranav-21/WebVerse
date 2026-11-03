/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryStorageInfo } from '../types/camera';
import type {
  MotionEvent,
  MotionRegion,
  MotionSensitivity,
  MotionSnapshotLink,
  MotionSnapshotStatus,
} from '../types/motion';
import type { KeyValueStore } from './connectionHistory';
import { cleanMessage } from './redact';

/**
 * Motion detection, step 4: the recent motion events, kept in this browser.
 *
 * Storage is localStorage (the same mechanism and rules as the Phase 2 connection history): events
 * are a few hundred bytes of JSON each, so there is no reason to use IndexedDB; the pictures
 * themselves are NOT stored here, they live in the Smart Snapshot gallery and are referenced by id.
 * Limits, handled rather than assumed away:
 *  - only the newest MOTION_HISTORY_MAX_EVENTS events are kept, and the stored JSON stays under
 *    MOTION_HISTORY_MAX_BYTES (the newest events win);
 *  - storage may be unavailable, full or blocked -> events stay in memory and the state says so;
 *  - it is per browser profile and web address, not shared between browsers or devices, and can be
 *    cleared by the user or the browser at any time;
 *  - unreadable or tampered data is discarded rather than trusted.
 */

export const MOTION_HISTORY_KEY = 'rc_surveillance_motion_history_v1';
export const MOTION_HISTORY_MAX_EVENTS = 100;
export const MOTION_HISTORY_MAX_BYTES = 40_000;
const STORAGE_VERSION = 1;

export interface MotionHistoryState {
  /** Newest first. */
  events: MotionEvent[];
  storage: HistoryStorageInfo;
}

export interface MotionHistoryOptions {
  /** null or omitted = memory only. */
  store?: KeyValueStore | null;
  storageKey?: string;
  maxEvents?: number;
  maxBytes?: number;
}

const SENSITIVITIES: ReadonlySet<string> = new Set<MotionSensitivity>(['low', 'medium', 'high']);
const REGIONS: ReadonlySet<string> = new Set<MotionRegion>(['full', 'center', 'left', 'right', 'top', 'bottom']);
const SNAPSHOT_STATUSES: ReadonlySet<string> = new Set<MotionSnapshotStatus>([
  'off',
  'pending',
  'saved',
  'session-only',
  'failed',
  'skipped',
]);

export class MotionHistory {
  private readonly store: KeyValueStore | null;
  private readonly storageKey: string;
  private readonly maxEvents: number;
  private readonly maxBytes: number;

  /** Oldest first. */
  private events: MotionEvent[] = [];
  private storage: HistoryStorageInfo;
  private listeners = new Set<() => void>();
  private snapshot: MotionHistoryState;

  constructor(options: MotionHistoryOptions = {}) {
    this.store = options.store ?? null;
    this.storageKey = options.storageKey ?? MOTION_HISTORY_KEY;
    this.maxEvents = Math.max(1, options.maxEvents ?? MOTION_HISTORY_MAX_EVENTS);
    this.maxBytes = Math.max(500, options.maxBytes ?? MOTION_HISTORY_MAX_BYTES);
    this.storage = this.store
      ? { status: 'persistent', reason: null }
      : { status: 'memory-only', reason: 'Browser storage is not available, so motion events are kept only until this page is closed.' };
    if (this.store) this.load();
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Same object until something changes (the contract of useSyncExternalStore). */
  getSnapshot = (): MotionHistoryState => this.snapshot;

  add(event: MotionEvent): void {
    this.events.push(cloneEvent(event));
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.persist();
    this.publish();
  }

  /** Update the snapshot status of an event, e.g. when the picture finished saving. Unknown ids are ignored. */
  updateSnapshot(id: string, snapshot: MotionSnapshotLink): void {
    const event = this.events.find((e) => e.id === id);
    if (!event) return;
    event.snapshot = cleanSnapshot(snapshot);
    this.persist();
    this.publish();
  }

  /** Remove every event, in memory and in browser storage. */
  clear(): void {
    this.events = [];
    if (this.store) {
      try {
        this.store.removeItem(this.storageKey);
        this.storage = { status: 'persistent', reason: null };
      } catch {
        this.persist(); // could not remove the key: overwrite it with an empty list instead
      }
    }
    this.publish();
  }

  // ----------------------------------------------------------------- internals --

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private buildSnapshot(): MotionHistoryState {
    return { events: this.events.map(cloneEvent).reverse(), storage: { ...this.storage } };
  }

  private serialize(events: MotionEvent[]): string {
    return JSON.stringify({ v: STORAGE_VERSION, events });
  }

  private persist(): void {
    if (!this.store) return;
    let json = this.serialize(this.events);
    while (json.length > this.maxBytes && this.events.length > 1) {
      this.events.splice(0, Math.max(1, Math.ceil(this.events.length / 10)));
      json = this.serialize(this.events);
    }
    try {
      this.store.setItem(this.storageKey, json);
      this.storage = { status: 'persistent', reason: null };
      return;
    } catch {
      // Probably out of quota: retry once with the newest half.
    }
    try {
      this.store.setItem(this.storageKey, this.serialize(this.events.slice(Math.floor(this.events.length / 2))));
      this.storage = { status: 'persistent', reason: 'Browser storage was nearly full: only the newest motion events are saved.' };
    } catch (err) {
      this.storage = {
        status: 'memory-only',
        reason: `Browser storage is full or blocked (${describe(err)}). Motion events are kept only until this page is closed.`,
      };
    }
  }

  private load(): void {
    let raw: string | null;
    try {
      raw = this.store!.getItem(this.storageKey);
    } catch (err) {
      this.storage = { status: 'memory-only', reason: `Browser storage could not be read (${describe(err)}).` };
      return;
    }
    if (raw == null) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.storage = { status: 'persistent', reason: 'Saved motion events were unreadable and have been discarded.' };
      return;
    }
    const list = isRecord(parsed) && parsed.v === STORAGE_VERSION && Array.isArray(parsed.events) ? parsed.events : null;
    if (!list) {
      this.storage = { status: 'persistent', reason: 'Saved motion events had an unknown format and have been discarded.' };
      return;
    }
    const seen = new Set<string>();
    const loaded: MotionEvent[] = [];
    for (const item of list) {
      const event = toEvent(item);
      if (event && !seen.has(event.id)) {
        seen.add(event.id);
        loaded.push(event);
      }
    }
    this.events = loaded.slice(-this.maxEvents);
  }
}

// ------------------------------------------------------------------- helpers --

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cleanSnapshot(link: MotionSnapshotLink): MotionSnapshotLink {
  const out: MotionSnapshotLink = { status: link.status };
  if (link.snapshotId) out.snapshotId = String(link.snapshotId).slice(0, 80);
  if (link.note) out.note = cleanMessage(link.note, 200);
  return out;
}

function cloneEvent(e: MotionEvent): MotionEvent {
  return { ...e, snapshot: { ...e.snapshot } };
}

function toEvent(item: unknown): MotionEvent | null {
  if (!isRecord(item)) return null;
  const { id, t, changedPercent, thresholdPercent, pixelThreshold, sensitivity, confirmFrames, region, snapshot } = item;
  if (typeof id !== 'string' || !id || id.length > 80) return null;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  if (typeof changedPercent !== 'number' || !Number.isFinite(changedPercent)) return null;
  if (typeof thresholdPercent !== 'number' || !Number.isFinite(thresholdPercent)) return null;
  if (typeof pixelThreshold !== 'number' || !Number.isFinite(pixelThreshold)) return null;
  if (typeof sensitivity !== 'string' || !SENSITIVITIES.has(sensitivity)) return null;
  if (typeof confirmFrames !== 'number' || !Number.isInteger(confirmFrames) || confirmFrames < 1) return null;
  if (typeof region !== 'string' || !REGIONS.has(region)) return null;

  let link: MotionSnapshotLink = { status: 'off' };
  if (isRecord(snapshot) && typeof snapshot.status === 'string' && SNAPSHOT_STATUSES.has(snapshot.status)) {
    link = cleanSnapshot({
      status: snapshot.status as MotionSnapshotStatus,
      snapshotId: typeof snapshot.snapshotId === 'string' ? snapshot.snapshotId : undefined,
      note: typeof snapshot.note === 'string' ? snapshot.note : undefined,
    });
    // A snapshot that was still being captured when the page closed can never finish.
    if (link.status === 'pending') link = { status: 'failed', note: 'The page was closed before the snapshot finished.' };
  }
  return {
    id,
    t,
    changedPercent,
    thresholdPercent,
    pixelThreshold,
    sensitivity: sensitivity as MotionSensitivity,
    confirmFrames,
    region: region as MotionRegion,
    snapshot: link,
  };
}

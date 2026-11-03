/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AI_CATEGORIES, AiCategory, AiErrorCode, RecognizedObject } from '../../server/protocol';
import type { HistoryStorageInfo } from '../types/camera';
import type { AiEvent, AiTrigger } from '../types/ai';
import type { MotionSnapshotLink, MotionSnapshotStatus } from '../types/motion';
import type { KeyValueStore } from './connectionHistory';
import { cleanMessage } from './redact';

/**
 * Recent AI recognition events, kept in this browser (localStorage, the same mechanism and rules as
 * the motion and connection histories). It holds text only: what the model said, when, why it was
 * run and a link to the gallery snapshot. The picture is never stored here (the Smart Snapshot
 * gallery keeps it), and no secret is ever stored.
 *
 * Bounded (newest MAX events, JSON under MAX_BYTES), validated on load (damaged data is discarded),
 * and storage that is blocked or full only means the events stay in memory.
 */

export const AI_HISTORY_KEY = 'rc_surveillance_ai_history_v1';
export const AI_HISTORY_MAX_EVENTS = 50;
export const AI_HISTORY_MAX_BYTES = 60_000;
const STORAGE_VERSION = 1;
/** Objects kept per event; the model may list more. */
const MAX_STORED_OBJECTS = 6;

export interface AiHistoryState {
  /** Newest first. */
  events: AiEvent[];
  storage: HistoryStorageInfo;
}

export interface AiHistoryOptions {
  store?: KeyValueStore | null;
  storageKey?: string;
  maxEvents?: number;
  maxBytes?: number;
}

const CATEGORIES: ReadonlySet<string> = new Set<string>([...AI_CATEGORIES, 'none']);
const TRIGGERS: ReadonlySet<string> = new Set<AiTrigger>(['manual', 'motion']);
const SNAPSHOT_STATUSES: ReadonlySet<string> = new Set<MotionSnapshotStatus>(['off', 'pending', 'saved', 'session-only', 'failed', 'skipped']);

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

function cloneEvent(e: AiEvent): AiEvent {
  return { ...e, objects: e.objects.map((o) => ({ ...o })), snapshot: { ...e.snapshot }, ...(e.error ? { error: { ...e.error } } : {}), ...(e.usage ? { usage: { ...e.usage } } : {}) };
}

function toObject(item: unknown): RecognizedObject | null {
  if (!isRecord(item) || typeof item.label !== 'string' || !item.label) return null;
  const category = typeof item.category === 'string' && (AI_CATEGORIES as readonly string[]).includes(item.category) ? (item.category as AiCategory) : 'unknown';
  return {
    label: cleanMessage(item.label, 60),
    category,
    description: typeof item.description === 'string' ? cleanMessage(item.description, 200) : '',
    uncertain: item.uncertain !== false,
  };
}

function toEvent(item: unknown): AiEvent | null {
  if (!isRecord(item)) return null;
  const { id, t, trigger, status, category, matched, snapshot } = item;
  if (typeof id !== 'string' || !id || id.length > 80) return null;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  if (typeof trigger !== 'string' || !TRIGGERS.has(trigger)) return null;
  if (status !== 'success' && status !== 'failed') return null;
  if (typeof category !== 'string' || !CATEGORIES.has(category)) return null;
  if (typeof matched !== 'boolean') return null;

  let link: MotionSnapshotLink = { status: 'off' };
  if (isRecord(snapshot) && typeof snapshot.status === 'string' && SNAPSHOT_STATUSES.has(snapshot.status)) {
    link = cleanSnapshot({
      status: snapshot.status as MotionSnapshotStatus,
      snapshotId: typeof snapshot.snapshotId === 'string' ? snapshot.snapshotId : undefined,
      note: typeof snapshot.note === 'string' ? snapshot.note : undefined,
    });
    if (link.status === 'pending') link = { status: 'failed', note: 'The page was closed before the snapshot finished.' };
  }

  const objects: RecognizedObject[] = [];
  if (Array.isArray(item.objects)) {
    for (const o of item.objects) {
      const object = toObject(o);
      if (object && objects.length < MAX_STORED_OBJECTS) objects.push(object);
    }
  }

  const event: AiEvent = {
    id,
    t,
    trigger: trigger as AiTrigger,
    status,
    objects,
    category: category as AiCategory | 'none',
    matched,
    snapshot: link,
  };
  if (typeof item.model === 'string') event.model = cleanMessage(item.model, 80);
  if (typeof item.summary === 'string') event.summary = cleanMessage(item.summary, 240);
  if (typeof item.motionEventId === 'string') event.motionEventId = item.motionEventId.slice(0, 80);
  if (typeof item.latencyMs === 'number' && Number.isFinite(item.latencyMs)) event.latencyMs = Math.max(0, Math.round(item.latencyMs));
  if (isRecord(item.error) && typeof item.error.code === 'string' && typeof item.error.message === 'string') {
    event.error = { code: item.error.code as AiErrorCode, message: cleanMessage(item.error.message, 240) };
  }
  if (status === 'failed' && !event.error) event.error = { code: 'internal_error', message: 'The recognition failed.' };
  if (isRecord(item.usage) && typeof item.usage.promptTokens === 'number' && typeof item.usage.completionTokens === 'number') {
    event.usage = { promptTokens: item.usage.promptTokens, completionTokens: item.usage.completionTokens };
  }
  return event;
}

export class AiHistory {
  private readonly store: KeyValueStore | null;
  private readonly storageKey: string;
  private readonly maxEvents: number;
  private readonly maxBytes: number;

  /** Oldest first. */
  private events: AiEvent[] = [];
  private storage: HistoryStorageInfo;
  private listeners = new Set<() => void>();
  private snapshot: AiHistoryState;

  constructor(options: AiHistoryOptions = {}) {
    this.store = options.store ?? null;
    this.storageKey = options.storageKey ?? AI_HISTORY_KEY;
    this.maxEvents = Math.max(1, options.maxEvents ?? AI_HISTORY_MAX_EVENTS);
    this.maxBytes = Math.max(500, options.maxBytes ?? AI_HISTORY_MAX_BYTES);
    this.storage = this.store
      ? { status: 'persistent', reason: null }
      : { status: 'memory-only', reason: 'Browser storage is not available, so recognition events are kept only until this page is closed.' };
    if (this.store) this.load();
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Same object until something changes (the contract of useSyncExternalStore). */
  getSnapshot = (): AiHistoryState => this.snapshot;

  add(event: AiEvent): void {
    const stored = cloneEvent(event);
    stored.objects = stored.objects.slice(0, MAX_STORED_OBJECTS);
    this.events.push(stored);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.persist();
    this.publish();
  }

  updateSnapshot(id: string, link: MotionSnapshotLink): void {
    const event = this.events.find((e) => e.id === id);
    if (!event) return;
    event.snapshot = cleanSnapshot(link);
    this.persist();
    this.publish();
  }

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
    this.snapshot = this.build();
    for (const listener of [...this.listeners]) listener();
  }

  private build(): AiHistoryState {
    return { events: this.events.map(cloneEvent).reverse(), storage: { ...this.storage } };
  }

  private serialize(events: AiEvent[]): string {
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
      this.storage = { status: 'persistent', reason: 'Browser storage was nearly full: only the newest recognition events are saved.' };
    } catch (err) {
      this.storage = {
        status: 'memory-only',
        reason: `Browser storage is full or blocked (${describe(err)}). Recognition events are kept only until this page is closed.`,
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
      this.storage = { status: 'persistent', reason: 'Saved recognition events were unreadable and have been discarded.' };
      return;
    }
    const list = isRecord(parsed) && parsed.v === STORAGE_VERSION && Array.isArray(parsed.events) ? parsed.events : null;
    if (!list) {
      this.storage = { status: 'persistent', reason: 'Saved recognition events had an unknown format and have been discarded.' };
      return;
    }
    const seen = new Set<string>();
    const loaded: AiEvent[] = [];
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

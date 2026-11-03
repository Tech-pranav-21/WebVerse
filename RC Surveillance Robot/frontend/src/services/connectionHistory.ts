/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConnectionEvent, ConnectionEventType, HistoryStorageInfo, StreamEventLevel } from '../types/camera';
import { cleanMessage } from './redact';

/**
 * ConnectionHistory - a small, typed, capped event log that survives page reloads.
 *
 * Why not the Phase 1 stream log? That one is a verbose, in-memory trace of the current page
 * session (retry countdowns, config changes...). This one is the curated record a person reads
 * when asking "what happened to my camera feed while I was driving?": it is typed, folds
 * repeats of one continuous failure into a single entry, is capped, and is saved in the browser.
 *
 * Storage: browser localStorage (the same mechanism the camera settings use), under its own key.
 * Limits, all handled here rather than assumed away:
 *  - localStorage may be unavailable (private mode, blocked site data) or full -> the log keeps
 *    working in memory and reports 'memory-only' with the reason;
 *  - it is per browser profile and per origin (another browser, device, or a different host
 *    name/port does not see it), and it is not synchronised between two open tabs: the last tab
 *    to write wins;
 *  - the data can be cleared by the user or the browser at any time;
 *  - unreadable or tampered data is discarded rather than trusted.
 * It contains no URLs with credentials: every message goes through cleanMessage().
 */

export const CONNECTION_HISTORY_KEY = 'rc_surveillance_connection_history_v1';
export const HISTORY_MAX_EVENTS = 100;
/** Upper bound for the stored JSON; localStorage quotas are typically ~5 MB per origin. */
export const HISTORY_MAX_BYTES = 40_000;
const STORAGE_VERSION = 1;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HistoryClock {
  now(): number;
}

export interface RecordInput {
  type: ConnectionEventType;
  /** Defaults to the usual severity of the type. */
  severity?: StreamEventLevel;
  message: string;
  /**
   * Events with the same dedupeKey are folded into one entry (count + lastT) until endEpisode()
   * is called. Use it for things that repeat during one continuous failure.
   */
  dedupeKey?: string;
  /** Identifies the page load; only for 'session_started'. */
  session?: string;
}

export interface ConnectionHistoryOptions {
  clock?: HistoryClock;
  /** null or omitted = memory only. */
  store?: KeyValueStore | null;
  storageKey?: string;
  maxEvents?: number;
  maxBytes?: number;
}

const DEFAULT_SEVERITY: Record<ConnectionEventType, StreamEventLevel> = {
  session_started: 'info',
  config_changed: 'info',
  stream_connecting: 'info',
  stream_first_frame: 'ok',
  stream_disconnected: 'error',
  stream_connect_failed: 'error',
  stream_stalled: 'warn',
  reconnect_started: 'info',
  reconnect_succeeded: 'ok',
  reconnect_failed: 'error',
  reconnect_stopped: 'error',
  host_unreachable: 'warn',
  host_reachable: 'ok',
  diagnosis_inconclusive: 'warn',
};

const SEVERITIES: ReadonlySet<string> = new Set(['info', 'ok', 'warn', 'error']);

export const CONNECTION_EVENT_LABELS: Record<ConnectionEventType, string> = {
  session_started: 'Dashboard opened',
  config_changed: 'Settings changed',
  stream_connecting: 'Connecting',
  stream_first_frame: 'First frame',
  stream_disconnected: 'Stream lost',
  stream_connect_failed: 'Connect failed',
  stream_stalled: 'Stream stalled',
  reconnect_started: 'Reconnecting',
  reconnect_succeeded: 'Recovered',
  reconnect_failed: 'Reconnect failed',
  reconnect_stopped: 'Reconnect stopped',
  host_unreachable: 'Host unreachable',
  host_reachable: 'Host reachable',
  diagnosis_inconclusive: 'Cause unknown',
};

export class ConnectionHistory {
  private readonly clock: HistoryClock;
  private readonly store: KeyValueStore | null;
  private readonly storageKey: string;
  private readonly maxEvents: number;
  private readonly maxBytes: number;

  private events: ConnectionEvent[] = [];
  private nextId = 1;
  /** dedupeKey -> id of the entry that folds its repeats, for the current episode. */
  private episode = new Map<string, number>();
  private storage: HistoryStorageInfo;

  constructor(options: ConnectionHistoryOptions = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
    this.store = options.store ?? null;
    this.storageKey = options.storageKey ?? CONNECTION_HISTORY_KEY;
    this.maxEvents = Math.max(1, options.maxEvents ?? HISTORY_MAX_EVENTS);
    this.maxBytes = Math.max(500, options.maxBytes ?? HISTORY_MAX_BYTES);
    this.storage = this.store
      ? { status: 'persistent', reason: null }
      : { status: 'memory-only', reason: 'Browser storage is not available, so history is kept only until this page is closed.' };
    if (this.store) this.load();
  }

  /** Copy of the log, oldest first. */
  getEvents(): ConnectionEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  getStorageInfo(): HistoryStorageInfo {
    return { ...this.storage };
  }

  /**
   * Mark the start of this page load. Does nothing when the newest entry already is the marker of
   * the same page load (React StrictMode creates the owner twice in development).
   */
  startSession(sessionId: string): void {
    const markerIndex = this.lastIndexOf((e) => e.type === 'session_started');
    const marker = markerIndex >= 0 ? this.events[markerIndex] : null;
    if (marker && marker.session === sessionId) {
      for (let i = markerIndex; i < this.events.length; i++) this.events[i].restored = false;
      return;
    }
    this.record({ type: 'session_started', message: 'The page was loaded.', session: sessionId });
  }

  /**
   * Add an event. Returns the stored entry (an existing one when the event was folded into an
   * earlier identical one).
   */
  record(input: RecordInput): ConnectionEvent {
    const now = this.clock.now();
    const message = cleanMessage(input.message);

    if (input.dedupeKey !== undefined) {
      const key = `${input.type}|${input.dedupeKey}`;
      const existingId = this.episode.get(key);
      const existing = existingId !== undefined ? this.events.find((e) => e.id === existingId) : undefined;
      if (existing) {
        existing.count += 1;
        existing.lastT = now;
        this.persist();
        return { ...existing };
      }
    }

    const event: ConnectionEvent = {
      id: this.nextId++,
      t: now,
      lastT: now,
      count: 1,
      type: input.type,
      severity: input.severity ?? DEFAULT_SEVERITY[input.type],
      message,
    };
    if (input.session) event.session = cleanMessage(input.session, 64);
    this.events.push(event);
    if (input.dedupeKey !== undefined) this.episode.set(`${input.type}|${input.dedupeKey}`, event.id);

    this.enforceCaps();
    this.persist();
    return { ...event };
  }

  /** The continuous failure (or other episode) ended: later identical events are new entries. */
  endEpisode(): void {
    this.episode.clear();
  }

  /** Remove every event, in memory and in browser storage. */
  clear(): void {
    this.events = [];
    this.episode.clear();
    if (!this.store) return;
    try {
      this.store.removeItem(this.storageKey);
      this.storage = { status: 'persistent', reason: null };
    } catch {
      // Could not remove the key; overwrite it with an empty log instead (persist() reports failure).
      this.persist();
    }
  }

  // ----------------------------------------------------------------- internals --

  private lastIndexOf(pred: (e: ConnectionEvent) => boolean): number {
    for (let i = this.events.length - 1; i >= 0; i--) if (pred(this.events[i])) return i;
    return -1;
  }

  private enforceCaps(): void {
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    // Forget dedupe entries whose event was dropped.
    if (this.episode.size > 0) {
      const alive = new Set(this.events.map((e) => e.id));
      for (const [key, id] of this.episode) if (!alive.has(id)) this.episode.delete(key);
    }
  }

  private serialize(events: ConnectionEvent[]): string {
    return JSON.stringify({
      v: STORAGE_VERSION,
      events: events.map(({ restored: _restored, ...rest }) => rest),
    });
  }

  private persist(): void {
    if (!this.store) return;
    let json = this.serialize(this.events);
    // Keep the stored size bounded, newest events win.
    while (json.length > this.maxBytes && this.events.length > 1) {
      this.events.splice(0, Math.max(1, Math.ceil(this.events.length / 10)));
      json = this.serialize(this.events);
    }
    this.enforceCaps();
    try {
      this.store.setItem(this.storageKey, json);
      this.storage = { status: 'persistent', reason: null };
      return;
    } catch {
      // Probably out of quota: retry once with the newest half.
    }
    try {
      const keep = this.events.slice(Math.floor(this.events.length / 2));
      this.store.setItem(this.storageKey, this.serialize(keep));
      this.storage = { status: 'persistent', reason: 'Browser storage was nearly full: only the newest events are saved.' };
    } catch (err) {
      this.storage = {
        status: 'memory-only',
        reason: `Browser storage is full or blocked (${describe(err)}). History is kept only until this page is closed.`,
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
      this.storage = { status: 'persistent', reason: 'Saved history was unreadable and has been discarded.' };
      return;
    }
    const list = isRecord(parsed) && parsed.v === STORAGE_VERSION && Array.isArray(parsed.events) ? parsed.events : null;
    if (!list) {
      this.storage = { status: 'persistent', reason: 'Saved history had an unknown format and has been discarded.' };
      return;
    }

    const loaded: ConnectionEvent[] = [];
    let maxId = 0;
    for (const item of list) {
      const e = toEvent(item);
      if (!e) continue;
      loaded.push({ ...e, restored: true });
      if (e.id > maxId) maxId = e.id;
    }
    this.events = loaded.slice(-this.maxEvents);
    this.nextId = maxId + 1;
  }
}

// ------------------------------------------------------------------- helpers --

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toEvent(item: unknown): ConnectionEvent | null {
  if (!isRecord(item)) return null;
  const { id, t, lastT, count, type, severity, message, session } = item;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return null;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  if (typeof type !== 'string' || !(type in DEFAULT_SEVERITY)) return null;
  if (typeof severity !== 'string' || !SEVERITIES.has(severity)) return null;
  if (typeof message !== 'string') return null;
  const event: ConnectionEvent = {
    id,
    t,
    lastT: typeof lastT === 'number' && Number.isFinite(lastT) && lastT >= t ? lastT : t,
    count: typeof count === 'number' && Number.isInteger(count) && count >= 1 ? count : 1,
    type: type as ConnectionEventType,
    severity: severity as StreamEventLevel,
    message: cleanMessage(message),
  };
  if (typeof session === 'string' && session) event.session = cleanMessage(session, 64);
  return event;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SnapshotItem } from '../types/camera';
import type { CapturedFrame } from './frameCapture';
import { SnapshotStorage, StoredSnapshot, describeStorageError } from './snapshotStorage';

/**
 * Smart Snapshot, step 3: the gallery's contents.
 *
 * The library keeps the list the UI shows and mirrors it into SnapshotStorage (IndexedDB). A
 * snapshot is only ever added from a frame that was really captured. If the browser then refuses
 * to store it, the image is NOT thrown away: it stays in the gallery as session-only, marked as
 * such, so the user can still download it.
 */

/** Newest snapshots kept; older ones are removed (from storage too) when this is exceeded. */
export const MAX_SNAPSHOTS = 100;

export interface LibraryStorageInfo {
  /**
   * 'loading'     - reading what an earlier visit saved
   * 'persistent'  - snapshots are saved in this browser's IndexedDB and survive a refresh
   * 'memory-only' - no usable storage; snapshots disappear when the page closes
   */
  status: 'loading' | 'persistent' | 'memory-only';
  reason: string | null;
}

export interface LibraryState {
  /** Newest first. */
  items: SnapshotItem[];
  storage: LibraryStorageInfo;
}

export interface AddResult {
  item: SnapshotItem;
  /** True if the image was written to storage. False means session-only (see `error`). */
  saved: boolean;
  error?: string;
}

export interface RemoveResult {
  ok: boolean;
  error?: string;
}

export interface LibraryOptions {
  /** null = this browser has no IndexedDB; the library then works in memory only. */
  storage: SnapshotStorage | null;
  maxItems?: number;
  makeId?: () => string;
}

const defaultMakeId = () => `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function sortNewestFirst(items: SnapshotItem[]): SnapshotItem[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

function toStored(item: SnapshotItem): StoredSnapshot {
  return {
    id: item.id,
    timestamp: item.timestamp,
    blob: item.blob,
    mimeType: item.mimeType,
    width: item.width,
    height: item.height,
    sizeBytes: item.sizeBytes,
    sourceUrl: item.sourceUrl,
    cameraName: item.cameraName,
  };
}

export class SnapshotLibrary {
  private readonly storage: SnapshotStorage | null;
  private readonly maxItems: number;
  private readonly makeId: () => string;
  private listeners = new Set<() => void>();
  private state: LibraryState;

  constructor(options: LibraryOptions) {
    this.storage = options.storage;
    this.maxItems = options.maxItems ?? MAX_SNAPSHOTS;
    this.makeId = options.makeId ?? defaultMakeId;
    this.state = {
      items: [],
      storage: this.storage
        ? { status: 'loading', reason: null }
        : { status: 'memory-only', reason: 'This browser does not provide image storage (IndexedDB).' },
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LibraryState => this.state;

  /** Read what earlier visits saved. Never throws: a failure leaves the gallery usable in memory. */
  async load(): Promise<void> {
    if (!this.storage) return;
    try {
      const stored = await this.storage.loadAll();
      const loaded: SnapshotItem[] = stored
        .filter((r) => r && r.blob instanceof Blob)
        .map((r) => ({ ...r, persistence: 'saved' as const }));
      // Anything captured while loading was in flight is kept.
      const known = new Set(this.state.items.map((i) => i.id));
      const merged = sortNewestFirst([...this.state.items, ...loaded.filter((i) => !known.has(i.id))]);
      this.set({ items: merged, storage: { status: 'persistent', reason: null } });
    } catch (err) {
      this.set({
        items: this.state.items,
        storage: { status: 'memory-only', reason: `Saved snapshots could not be read: ${describeStorageError(err)}.` },
      });
    }
  }

  /** Add a captured frame. The frame is already validated; this only stores it. */
  async add(frame: CapturedFrame, meta: { sourceUrl: string; cameraName: string }): Promise<AddResult> {
    const base: Omit<SnapshotItem, 'persistence' | 'persistenceNote'> = {
      id: this.makeId(),
      timestamp: frame.capturedAt,
      blob: frame.blob,
      mimeType: frame.blob.type || 'image/jpeg',
      width: frame.width,
      height: frame.height,
      sizeBytes: frame.blob.size,
      sourceUrl: meta.sourceUrl,
      cameraName: meta.cameraName,
    };

    let item: SnapshotItem;
    let error: string | undefined;
    if (!this.storage) {
      error = this.state.storage.reason ?? 'no image storage is available';
      item = { ...base, persistence: 'session', persistenceNote: error };
    } else {
      try {
        await this.storage.put(toStored({ ...base, persistence: 'saved' }));
        item = { ...base, persistence: 'saved' };
      } catch (err) {
        error = describeStorageError(err);
        item = { ...base, persistence: 'session', persistenceNote: error };
      }
    }

    const items = sortNewestFirst([item, ...this.state.items]);
    const evicted = items.splice(this.maxItems);
    this.set({ ...this.state, items });
    // Evicted entries must not linger in storage and reappear after a refresh.
    for (const old of evicted) {
      if (old.persistence === 'saved' && this.storage) {
        try {
          await this.storage.remove(old.id);
        } catch {
          // It stays in storage and is evicted again on the next add.
        }
      }
    }
    return { item, saved: item.persistence === 'saved', error };
  }

  /**
   * Delete one snapshot and its stored image data. If the browser cannot delete the stored data the
   * entry is kept, so the gallery never claims something is gone that would come back on refresh.
   */
  async remove(id: string): Promise<RemoveResult> {
    const item = this.state.items.find((i) => i.id === id);
    if (!item) return { ok: true };
    if (item.persistence === 'saved' && this.storage) {
      try {
        await this.storage.remove(id);
      } catch (err) {
        return { ok: false, error: describeStorageError(err) };
      }
    }
    this.set({ ...this.state, items: this.state.items.filter((i) => i.id !== id) });
    return { ok: true };
  }

  async clear(): Promise<RemoveResult> {
    if (this.storage) {
      try {
        await this.storage.clear();
      } catch (err) {
        return { ok: false, error: describeStorageError(err) };
      }
    }
    this.set({ ...this.state, items: [] });
    return { ok: true };
  }

  getItem(id: string): SnapshotItem | undefined {
    return this.state.items.find((i) => i.id === id);
  }

  private set(next: LibraryState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}

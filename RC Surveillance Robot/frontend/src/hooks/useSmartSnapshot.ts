/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SnapshotItem } from '../types/camera';
import { SnapshotLibrary, LibraryStorageInfo } from '../services/snapshotLibrary';
import type { CapturedFrame } from '../services/frameCapture';
import { createSnapshotStorage } from '../services/snapshotStorage';
import {
  CaptureOutcome,
  CaptureSource,
  DownloadOutcome,
  PreviewOutcome,
  SmartSnapshot,
  SnapshotNotice,
} from '../services/snapshotActions';

/** Successful operations clear their own message; errors stay until dismissed or replaced. */
const SUCCESS_NOTICE_MS = 5000;

export interface SmartSnapshotApi {
  /** Gallery contents, newest first. */
  items: SnapshotItem[];
  storage: LibraryStorageInfo;
  /** A capture or preview is running. */
  capturing: boolean;
  /** Snapshot ids with a download or delete in progress. */
  busyIds: readonly string[];
  notice: SnapshotNotice | null;
  dismissNotice: () => void;
  /** `quiet` suppresses the banner (automatic captures such as motion detection report the outcome themselves). */
  captureStill: (source: CaptureSource, options?: { quiet?: boolean }) => Promise<CaptureOutcome>;
  /** Save a frame captured elsewhere (such as the one an AI analysis used) to the gallery. */
  saveFrame: (frame: CapturedFrame, sourceUrl: string, options?: { quiet?: boolean }) => Promise<CaptureOutcome>;
  previewFrame: (url: string, signal?: AbortSignal) => Promise<PreviewOutcome>;
  downloadSnapshot: (id: string) => Promise<DownloadOutcome>;
  removeSnapshot: (id: string) => Promise<boolean>;
  clearAll: () => Promise<boolean>;
}

/** Binds the framework-free SnapshotLibrary and SmartSnapshot to React. One instance per Dashboard. */
export function useSmartSnapshot(): SmartSnapshotApi {
  const [{ library, smart }] = useState(() => {
    const lib = new SnapshotLibrary({ storage: createSnapshotStorage() });
    return { library: lib, smart: new SmartSnapshot({ library: lib }) };
  });

  useEffect(() => {
    void library.load();
  }, [library]);

  const libraryState = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  const ui = useSyncExternalStore(smart.subscribe, smart.getSnapshot, smart.getSnapshot);

  const notice = ui.notice;
  useEffect(() => {
    if (!notice || notice.kind !== 'success') return;
    const timer = setTimeout(smart.dismissNotice, SUCCESS_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, smart]);

  return {
    items: libraryState.items,
    storage: libraryState.storage,
    capturing: ui.capturing,
    busyIds: ui.busyIds,
    notice,
    dismissNotice: smart.dismissNotice,
    captureStill: (source, options) => smart.captureStill(source, options),
    saveFrame: (frame, sourceUrl, options) => smart.saveFrame(frame, sourceUrl, options),
    previewFrame: (url, signal) => smart.previewFrame(url, signal),
    downloadSnapshot: (id) => smart.downloadSnapshot(id),
    removeSnapshot: (id) => smart.removeSnapshot(id),
    clearAll: () => smart.clearAll(),
  };
}

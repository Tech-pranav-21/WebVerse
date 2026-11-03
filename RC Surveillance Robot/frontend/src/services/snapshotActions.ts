/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SnapshotItem } from '../types/camera';
import {
  CaptureFailure,
  CaptureResult,
  CapturedFrame,
  FrameImage,
  GrabOptions,
  captureFrameFromImage,
  grabFrameFromStream,
  isCaptureFailure,
} from './frameCapture';
import { SnapshotLibrary } from './snapshotLibrary';
import { downloadSnapshotBlob, isDownloadFailure } from './snapshotDownload';
import { describeStorageError } from './snapshotStorage';

/**
 * Smart Snapshot, step 5: the one place that sequences "capture -> save -> tell the user".
 *
 * It keeps three outcomes apart on purpose:
 *   captured  - a real frame was read from the camera's video
 *   saved     - that frame was stored in the gallery (and, if the browser allows, IndexedDB)
 *   downloaded - a .jpg file was handed to the browser (only "started" can ever be known)
 * and it refuses to run the same operation twice at once (double clicks, overlapping refreshes),
 * which also keeps a single-client camera from being asked for two connections.
 */

export type SnapshotNoticeAction = 'enable-capture';

export interface SnapshotNotice {
  id: number;
  kind: 'success' | 'error';
  message: string;
  /** A one-click remedy the UI may offer next to the message. */
  action?: SnapshotNoticeAction;
}

export interface SmartSnapshotState {
  /** A capture or preview is running (the camera connection is in use). */
  capturing: boolean;
  /** Snapshot ids with a download or delete in progress. */
  busyIds: readonly string[];
  notice: SnapshotNotice | null;
}

export type CaptureSource =
  /** The frame the live <img> shows right now (stream mode). No request to the camera. */
  | {
      kind: 'live';
      image: FrameImage | null;
      /** The stream is connected, so the picture is current rather than a leftover frame. */
      connected: boolean;
      statusLabel: string;
      sourceUrl: string;
      /** The stream <img> was requested with CORS (Settings: Allow snapshot capture). */
      corsRequested: boolean;
    }
  /** One frame from the stream via a temporary CORS image (snapshot mode; no live connection is open). */
  | { kind: 'stream'; url: string; signal?: AbortSignal };

export type CaptureOutcome =
  | { status: 'busy' }
  | { status: 'failed'; failure: CaptureFailure }
  | { status: 'saved'; item: SnapshotItem }
  | { status: 'session-only'; item: SnapshotItem; error: string };

export type PreviewOutcome =
  | { status: 'busy' }
  | { status: 'failed'; failure: CaptureFailure }
  | { status: 'ok'; frame: CapturedFrame };

export type DownloadOutcome =
  | { status: 'busy' }
  | { status: 'missing' }
  | { status: 'started'; filename: string }
  | { status: 'failed'; error: string };

export interface SmartSnapshotDeps {
  library: SnapshotLibrary;
  cameraName?: string;
  captureFromImage?: (img: FrameImage) => Promise<CaptureResult>;
  grabFromStream?: (url: string, options?: GrabOptions) => Promise<CaptureResult>;
  download?: typeof downloadSnapshotBlob;
}

// ----------------------------------------------------------------- wording --

const kb = (bytes: number) => Math.max(1, Math.round(bytes / 1024));

/** Why a capture failed, in words that say what the user can do about it. */
export function describeCaptureFailure(
  failure: CaptureFailure,
  context: { corsRequested: boolean; live: boolean },
): { message: string; action?: SnapshotNoticeAction } {
  if (failure.kind === 'blocked' && context.live) {
    if (!context.corsRequested) {
      return {
        message:
          'The browser will not let this page read the live picture: it is shown as a plain cross-origin image. ' +
          'Turn on "Allow snapshot capture" to request the stream with CORS. This works only if the camera sends ' +
          'Access-Control-Allow-Origin on its /stream response.',
        action: 'enable-capture',
      };
    }
    return {
      message:
        'The picture still cannot be read although snapshot capture is on. Press Reconnect so the stream reloads with CORS. ' +
        'If it keeps failing, the camera is not sending Access-Control-Allow-Origin on /stream; only the camera firmware ' +
        '(or serving this page from the same origin) can fix that, not this dashboard.',
    };
  }
  return { message: failure.message };
}

// ------------------------------------------------------------------- class --

export class SmartSnapshot {
  private readonly library: SnapshotLibrary;
  private readonly cameraName: string;
  private readonly captureFromImage: NonNullable<SmartSnapshotDeps['captureFromImage']>;
  private readonly grabFromStream: NonNullable<SmartSnapshotDeps['grabFromStream']>;
  private readonly download: NonNullable<SmartSnapshotDeps['download']>;

  private readonly inFlight = new Set<string>();
  private listeners = new Set<() => void>();
  private noticeSeq = 0;
  private state: SmartSnapshotState = { capturing: false, busyIds: [], notice: null };

  constructor(deps: SmartSnapshotDeps) {
    this.library = deps.library;
    this.cameraName = deps.cameraName ?? 'ESP32-CAM';
    this.captureFromImage = deps.captureFromImage ?? ((img) => captureFrameFromImage(img));
    this.grabFromStream = deps.grabFromStream ?? ((url, options) => grabFrameFromStream(url, options));
    this.download = deps.download ?? downloadSnapshotBlob;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SmartSnapshotState => this.state;

  dismissNotice = (): void => {
    if (this.state.notice) this.publish({ notice: null });
  };

  // ------------------------------------------------------------- capture --

  /**
   * Capture a frame and save it to the gallery. A second call while one is running is ignored.
   * `quiet` (automatic captures, e.g. motion detection) suppresses the banner; the caller reports
   * the outcome itself.
   */
  captureStill(source: CaptureSource, options: { quiet?: boolean } = {}): Promise<CaptureOutcome> {
    const say = (kind: SnapshotNotice['kind'], message: string, action?: SnapshotNoticeAction): void => {
      if (!options.quiet) this.setNotice(kind, message, action);
    };
    return this.exclusive<CaptureOutcome>('capture', { status: 'busy' }, async () => {
      const result = await this.readFrame(source);
      const live = source.kind === 'live';
      if (isCaptureFailure(result)) {
        const text = describeCaptureFailure(result.failure, { corsRequested: live && source.corsRequested, live });
        // A cancelled capture is the user's own doing (left the view); it is not an error to report.
        if (result.failure.kind !== 'cancelled') say('error', text.message, text.action);
        return { status: 'failed', failure: result.failure };
      }

      return this.storeFrame(result.frame, live ? source.sourceUrl : source.url, say);
    }, (message) => ({ status: 'failed', failure: { kind: 'encode-failed', message } }));
  }

  /**
   * Save a frame that was captured elsewhere (for example the exact frame an AI analysis used) to
   * the gallery, with the same storage, outcome and wording as captureStill. It does not touch the
   * camera, so it has its own guard and never blocks (or is blocked by) a capture in progress.
   */
  saveFrame(frame: CapturedFrame, sourceUrl: string, options: { quiet?: boolean } = {}): Promise<CaptureOutcome> {
    const say = (kind: SnapshotNotice['kind'], message: string, action?: SnapshotNoticeAction): void => {
      if (!options.quiet) this.setNotice(kind, message, action);
    };
    return this.exclusive<CaptureOutcome>('save', { status: 'busy' }, () => this.storeFrame(frame, sourceUrl, say), (message) => ({
      status: 'failed',
      failure: { kind: 'encode-failed', message },
    }));
  }

  private async storeFrame(
    frame: CapturedFrame,
    sourceUrl: string,
    say: (kind: SnapshotNotice['kind'], message: string, action?: SnapshotNoticeAction) => void,
  ): Promise<CaptureOutcome> {
    const added = await this.library.add(frame, { sourceUrl, cameraName: this.cameraName });
    const size = `${frame.width}×${frame.height}, ${kb(frame.blob.size)} KB`;
    if (added.saved) {
      say(
        'success',
        `Snapshot captured and saved to the gallery (${size}). Use Download in the gallery to get the JPEG file.`,
      );
      return { status: 'saved', item: added.item };
    }
    const error = added.error ?? 'the browser refused to store it';
    say(
      'error',
      `Snapshot captured (${size}), but it could not be stored: ${error}. It stays in the gallery until the page is refreshed; download it to keep it.`,
    );
    return { status: 'session-only', item: added.item, error };
  }

  /**
   * Snapshot mode: show one frame from the stream without saving it. Uses the same guard as
   * captureStill, so the camera is never asked for two connections at once.
   */
  previewFrame(url: string, signal?: AbortSignal): Promise<PreviewOutcome> {
    return this.exclusive<PreviewOutcome>('capture', { status: 'busy' }, async () => {
      const result = await this.grabFromStream(url, { signal });
      if (isCaptureFailure(result)) {
        const text = describeCaptureFailure(result.failure, { corsRequested: true, live: false });
        if (result.failure.kind !== 'cancelled') this.setNotice('error', text.message);
        return { status: 'failed', failure: result.failure };
      }
      return { status: 'ok', frame: result.frame };
    }, (message) => ({ status: 'failed', failure: { kind: 'load-failed', message } }));
  }

  private async readFrame(source: CaptureSource): Promise<CaptureResult> {
    if (source.kind === 'stream') return this.grabFromStream(source.url, { signal: source.signal });
    if (!source.image) {
      return { ok: false, failure: { kind: 'no-frame', message: 'The live picture is not on screen, so there is nothing to capture.' } };
    }
    if (!source.connected) {
      return {
        ok: false,
        failure: {
          kind: 'no-frame',
          message: `The live feed is not connected (${source.statusLabel}), so what is on screen may be an old frame. Reconnect, then capture again.`,
        },
      };
    }
    return this.captureFromImage(source.image);
  }

  // ------------------------------------------------------------ gallery --

  downloadSnapshot(id: string): Promise<DownloadOutcome> {
    return this.exclusive<DownloadOutcome>(`item:${id}`, { status: 'busy' }, async () => {
      const item = this.library.getItem(id);
      if (!item) {
        this.setNotice('error', 'That snapshot no longer exists, so nothing was downloaded.');
        return { status: 'missing' };
      }
      const result = await this.download(item.blob, item.timestamp);
      if (isDownloadFailure(result)) {
        this.setNotice('error', `Download failed: ${result.error}. No file was saved.`);
        return { status: 'failed', error: result.error };
      }
      this.setNotice(
        'success',
        `Download started: ${result.filename}. Your browser decides where it is saved; check its downloads list.`,
      );
      return { status: 'started', filename: result.filename };
    }, (message) => ({ status: 'failed', error: message }));
  }

  removeSnapshot(id: string): Promise<boolean> {
    return this.exclusive<boolean>(`item:${id}`, false, async () => {
      const result = await this.library.remove(id);
      if (!result.ok) this.setNotice('error', `The snapshot was not deleted: ${result.error}.`);
      return result.ok;
    }, () => false);
  }

  clearAll(): Promise<boolean> {
    return this.exclusive<boolean>('clear', false, async () => {
      const result = await this.library.clear();
      if (!result.ok) this.setNotice('error', `The gallery was not cleared: ${result.error}.`);
      return result.ok;
    }, () => false);
  }

  // ----------------------------------------------------------- internals --

  /**
   * Runs `run` unless the same `key` is already running (then returns `busyValue` and does nothing).
   * Nothing inside should throw; if it does, the user gets a message and `onError`'s value instead
   * of a button stuck in its busy state.
   */
  private async exclusive<T>(
    key: string,
    busyValue: T,
    run: () => Promise<T>,
    onError: (message: string) => T,
  ): Promise<T> {
    if (this.inFlight.has(key)) return busyValue;
    this.inFlight.add(key);
    this.publishBusy();
    try {
      return await run();
    } catch (err) {
      const message = `Unexpected error: ${describeStorageError(err)}.`;
      this.setNotice('error', message);
      return onError(message);
    } finally {
      this.inFlight.delete(key);
      this.publishBusy();
    }
  }

  private publishBusy(): void {
    this.publish({
      capturing: this.inFlight.has('capture'),
      busyIds: [...this.inFlight].filter((k) => k.startsWith('item:')).map((k) => k.slice(5)),
    });
  }

  private setNotice(kind: SnapshotNotice['kind'], message: string, action?: SnapshotNoticeAction): void {
    this.publish({ notice: { id: ++this.noticeSeq, kind, message, action } });
  }

  private publish(patch: Partial<SmartSnapshotState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Clock } from './streamConnectionService';
import { systemClock } from './streamConnectionService';

/**
 * Smart Snapshot, step 1: turn a video frame into a JPEG Blob.
 *
 * Two ways to get a frame, and nothing else (the camera firmware has no /capture endpoint):
 *
 *  - captureFrameFromImage(): reads the frame the live <img> is showing right now. No extra request
 *    to the camera. The browser only allows it if the image is not "cross-origin tainted": the
 *    stream must have been requested with CORS (<img crossorigin>) and the camera must answer with
 *    Access-Control-Allow-Origin, or the image must be same-origin (for example a blob: URL).
 *  - grabFrameFromStream(): used by Snapshot mode, where no live connection is open. Opens the
 *    stream in a temporary CORS image, takes the first frame, and closes the connection again.
 *
 * Neither fakes anything: when the browser refuses, the result says so and no image is produced.
 */

export const CAPTURE_JPEG_QUALITY = 0.92;
/** The slowest first frame seen from the real camera was 7.4 s; allow roughly twice that. */
export const DEFAULT_GRAB_TIMEOUT_MS = 15_000;
/** Anything smaller cannot be a decodable JPEG; it would be an empty or truncated file. */
const MIN_JPEG_BYTES = 100;

export type CaptureFailureKind =
  /** The element has not decoded a frame yet. */
  | 'no-frame'
  /** The browser refuses to read the pixels (tainted canvas, SecurityError). */
  | 'blocked'
  | 'canvas-unavailable'
  | 'encode-failed'
  /** One-shot grab: the image failed to load (camera down or busy, or CORS refused the stream). */
  | 'load-failed'
  /** One-shot grab: no frame arrived in time. */
  | 'timeout'
  | 'cancelled';

export interface CaptureFailure {
  kind: CaptureFailureKind;
  /** Plain-language explanation that is safe to show to the user. */
  message: string;
  /** Raw browser error name/message, for diagnostics. */
  detail?: string;
}

export interface CapturedFrame {
  blob: Blob;
  width: number;
  height: number;
  capturedAt: number;
}

export type CaptureResult = { ok: true; frame: CapturedFrame } | { ok: false; failure: CaptureFailure };

/** Type guard. (The app's tsconfig is not strict, where narrowing on `ok` alone does not work.) */
export function isCaptureFailure(result: CaptureResult): result is { ok: false; failure: CaptureFailure } {
  return !result.ok;
}

/** The part of HTMLImageElement the capture needs. */
export interface FrameImage {
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
}

/** The part of HTMLCanvasElement the capture needs. */
export interface CaptureCanvas {
  width: number;
  height: number;
  getContext(contextId: '2d'): { drawImage(image: never, dx: number, dy: number): void } | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export interface CaptureDeps {
  createCanvas: () => CaptureCanvas;
  now: () => number;
}

const defaultDeps: CaptureDeps = {
  createCanvas: () => document.createElement('canvas') as unknown as CaptureCanvas,
  now: () => Date.now(),
};

function failure(kind: CaptureFailureKind, message: string, detail?: string): CaptureResult {
  return { ok: false, failure: { kind, message, detail } };
}

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** True if the blob starts with the JPEG start marker (FF D8), ends with the end marker (FF D9) and is not tiny. */
export async function isValidJpeg(blob: Blob): Promise<boolean> {
  if (blob.size < MIN_JPEG_BYTES) return false;
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const tail = new Uint8Array(await blob.slice(blob.size - 2).arrayBuffer());
  return head[0] === 0xff && head[1] === 0xd8 && tail[0] === 0xff && tail[1] === 0xd9;
}

/** Read the frame an <img> is displaying right now and encode it as a JPEG. */
export async function captureFrameFromImage(
  img: FrameImage,
  deps: Partial<CaptureDeps> = {},
): Promise<CaptureResult> {
  const { createCanvas, now } = { ...defaultDeps, ...deps };

  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return failure('no-frame', 'There is no video frame to capture yet. Wait for the picture to appear, then try again.');
  }

  const width = img.naturalWidth;
  const height = img.naturalHeight;

  let canvas: CaptureCanvas;
  let ctx: ReturnType<CaptureCanvas['getContext']>;
  try {
    canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
  } catch (err) {
    return failure('canvas-unavailable', 'This browser could not create a canvas to read the frame.', errorText(err));
  }
  if (!ctx) return failure('canvas-unavailable', 'This browser could not create a canvas to read the frame.');

  let blob: Blob | null;
  try {
    ctx.drawImage(img as never, 0, 0);
    // toBlob() is where a cross-origin ("tainted") canvas is refused: it throws SecurityError.
    blob = await new Promise<Blob | null>((resolve, reject) => {
      try {
        canvas.toBlob(resolve, 'image/jpeg', CAPTURE_JPEG_QUALITY);
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    if (errorName(err) === 'SecurityError') {
      return failure(
        'blocked',
        'The browser blocked reading this frame because the video comes from another origin without permission (canvas security).',
        errorText(err),
      );
    }
    return failure('encode-failed', 'The browser could not read the frame.', errorText(err));
  }

  if (!blob) return failure('encode-failed', 'The browser could not encode the frame as a JPEG.');
  if (blob.type !== 'image/jpeg' || !(await isValidJpeg(blob))) {
    return failure('encode-failed', 'The browser produced something that is not a valid JPEG, so nothing was saved.');
  }
  return { ok: true, frame: { blob, width, height, capturedAt: now() } };
}

// ------------------------------------------------------------- one-shot grab --

/** The part of `new Image()` the one-shot grab needs. */
export interface GrabImage extends FrameImage {
  crossOrigin: string | null;
  src: string;
  onload: ((ev: Event) => void) | null;
  onerror: ((ev: Event | string) => void) | null;
  removeAttribute(name: string): void;
}

export interface GrabOptions {
  timeoutMs?: number;
  /** Aborting closes the camera connection and resolves with kind 'cancelled'. */
  signal?: AbortSignal;
  createImage?: () => GrabImage;
  clock?: Clock;
  capture?: Partial<CaptureDeps>;
}

const LOAD_FAILED_MESSAGE =
  'The camera did not deliver a frame the browser may read. It may be unreachable or busy with another viewer, ' +
  'or it does not send "Access-Control-Allow-Origin", which reading a frame requires.';

/** Add a cache-busting query parameter so the browser opens a fresh connection. */
export function withCacheBuster(url: string, stamp: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}_snap=${stamp}`;
}

/**
 * Open `streamUrl` in a temporary CORS image, capture its first frame, and always release the
 * connection afterwards. Never opens more than one connection and never touches /capture.
 */
export function grabFrameFromStream(streamUrl: string, options: GrabOptions = {}): Promise<CaptureResult> {
  const clock = options.clock ?? systemClock;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GRAB_TIMEOUT_MS;
  const createImage = options.createImage ?? (() => new Image() as unknown as GrabImage);

  return new Promise<CaptureResult>((resolve) => {
    if (!streamUrl) {
      resolve({ ok: false, failure: { kind: 'load-failed', message: 'No stream URL is configured, so there is nothing to capture from.' } });
      return;
    }
    if (options.signal?.aborted) {
      resolve({ ok: false, failure: { kind: 'cancelled', message: 'The capture was cancelled.' } });
      return;
    }

    const img = createImage();
    let settled = false;
    let timer: unknown;

    const finish = (result: CaptureResult) => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src'); // clearing src is what closes the connection to the camera
      resolve(result);
    };
    const onAbort = () =>
      finish({ ok: false, failure: { kind: 'cancelled', message: 'The capture was cancelled.' } });

    options.signal?.addEventListener('abort', onAbort);
    timer = clock.setTimeout(
      () =>
        finish({
          ok: false,
          failure: {
            kind: 'timeout',
            message: `No frame arrived from the camera within ${Math.round(timeoutMs / 1000)} seconds.`,
          },
        }),
      timeoutMs,
    );

    img.onload = () => {
      // The first frame is decoded: read it now, then close the connection.
      void captureFrameFromImage(img, options.capture).then(finish);
    };
    img.onerror = () => finish({ ok: false, failure: { kind: 'load-failed', message: LOAD_FAILED_MESSAGE } });

    img.crossOrigin = 'anonymous'; // must be set before src, or the image is not CORS-enabled
    img.src = withCacheBuster(streamUrl, clock.now());
  });
}

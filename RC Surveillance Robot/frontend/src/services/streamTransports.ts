/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MjpegFrameParser } from './mjpegParser';
import type { StreamCallbacks, StreamSession, StreamTransport } from './streamConnectionService';

export interface ImgTransportOptions {
  crossOrigin?: 'anonymous';
}

const CROSS_ORIGIN_ERROR_HINT =
  ' Snapshot capture asks the camera for CORS: if it does not send "Access-Control-Allow-Origin", ' +
  'turn off "Allow snapshot capture" in Settings to use the plain video element.';

/**
 * Transport 1 (default): a plain <img> element.
 *
 * Works with any camera, with or without CORS headers. Observable events are limited to the
 * browser's `load` (first frame of the connection) and `error`. Everything that goes wrong later
 * (stall, reset, corrupt frame) is silent, except that Chromium leaves an element with no
 * decodable image (complete && naturalWidth === 0), which poll() reports.
 *
 * With `crossOrigin` (Smart Snapshot, opt-in) the element is requested with CORS. That is what lets
 * "Capture Still" read a frame back from a canvas, but the browser then refuses the stream unless the
 * camera sends Access-Control-Allow-Origin.
 */
export class ImgElementTransport implements StreamTransport {
  constructor(
    private readonly getElement: () => HTMLImageElement | null,
    private readonly options: ImgTransportOptions = {},
  ) {}

  open(url: string, callbacks: StreamCallbacks): StreamSession {
    const el = this.getElement();
    if (!el) throw new Error('No video element is mounted.');

    const { crossOrigin } = this.options;
    let closed = false;
    let loads = 0;
    const onLoad = () => {
      if (closed) return;
      loads++;
      if (loads === 1) callbacks.onFirstFrame(); // later `load` events carry no guarantee: ignore
    };
    const onError = () => {
      if (closed) return;
      callbacks.onError(
        'The browser could not load the stream (connection refused or reset, or the camera sent an invalid response).' +
          (crossOrigin ? CROSS_ORIGIN_ERROR_HINT : ''),
      );
    };
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    if (crossOrigin) el.crossOrigin = crossOrigin; // must be set before src, or the request is not CORS-enabled
    el.src = url;

    return {
      close() {
        if (closed) return;
        closed = true;
        // Detach first: assigning an empty src fires `error` in Chromium.
        el.removeEventListener('load', onLoad);
        el.removeEventListener('error', onError);
        // Removing the element from the page does NOT close the connection; clearing src does.
        el.removeAttribute('src');
        if (crossOrigin) el.removeAttribute('crossorigin'); // the next session decides for itself
      },
      poll() {
        if (closed) return 'ok';
        return el.complete && el.naturalWidth === 0 ? 'broken' : 'ok';
      },
    };
  }
}

/**
 * Transport 2 (opt-in "Frame monitor"): read the MJPEG body with fetch().
 *
 * Every frame becomes observable, so stalls can be measured and recovered from. The browser only
 * allows this when the camera answers with Access-Control-Allow-Origin; otherwise fetch() fails
 * and the error message says so.
 */
export interface FetchTransportOptions {
  fetchImpl?: typeof fetch;
  onFrameBytes: (frame: Uint8Array) => void;
  onClose?: () => void;
}

export class FetchMjpegTransport implements StreamTransport {
  constructor(private readonly options: FetchTransportOptions) {}

  open(url: string, callbacks: StreamCallbacks): StreamSession {
    const fetchImpl = this.options.fetchImpl ?? ((input, init) => fetch(input, init));
    const controller = new AbortController();
    let closed = false;

    const run = async () => {
      try {
        const response = await fetchImpl(url, { mode: 'cors', cache: 'no-store', signal: controller.signal });
        if (closed) return;
        if (!response.ok) {
          callbacks.onError(`The camera answered HTTP ${response.status}.`);
          return;
        }
        if (!response.body) {
          callbacks.onError('This browser did not expose a readable stream body.');
          return;
        }
        const reader = response.body.getReader();
        const parser = new MjpegFrameParser();
        let first = true;
        for (;;) {
          const { value, done } = await reader.read();
          if (closed) return;
          if (done) {
            callbacks.onEnded?.('the response ended.');
            return;
          }
          if (!value) continue;
          for (const frame of parser.push(value)) {
            if (closed) return;
            this.options.onFrameBytes(frame);
            if (first) {
              first = false;
              callbacks.onFirstFrame();
            } else {
              callbacks.onFrame?.();
            }
          }
        }
      } catch (err) {
        if (closed) return; // we aborted it ourselves
        callbacks.onError(describeFetchError(err));
      }
    };
    void run();

    return {
      close: () => {
        if (closed) return;
        closed = true;
        controller.abort();
        this.options.onClose?.();
      },
    };
  }
}

export function describeFetchError(err: unknown): string {
  if (err instanceof TypeError) {
    return (
      'Could not read the stream. Either the network request failed, or the camera does not send ' +
      '"Access-Control-Allow-Origin", which Frame monitoring requires (turn it off in Settings to use the plain video element).'
    );
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Paints JPEG frames (monitor mode) onto an <img> via short-lived blob: URLs.
 * Latest-frame-wins: if frames arrive faster than the browser decodes them, older ones are dropped.
 * Blob URLs are same-origin, so the existing "Capture Still" canvas export works untainted.
 */
export interface BlobUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export class BlobFrameRenderer {
  private pending: Uint8Array | null = null;
  private busy = false;
  private currentUrl: string | null = null;
  private generation = 0;

  constructor(
    private readonly getElement: () => HTMLImageElement | null,
    private readonly urls: BlobUrlApi = URL,
    private readonly makeBlob: (bytes: Uint8Array) => Blob = (bytes) =>
      new Blob([bytes as BlobPart], { type: 'image/jpeg' }),
  ) {}

  render(bytes: Uint8Array): void {
    this.pending = bytes;
    if (!this.busy) this.paintNext();
  }

  /** Drop queued work and release the current blob URL. The last painted frame stays visible. */
  reset(): void {
    this.generation++;
    this.pending = null;
    this.busy = false;
    if (this.currentUrl) {
      this.urls.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  private paintNext(): void {
    const el = this.getElement();
    const bytes = this.pending;
    this.pending = null;
    if (!el || !bytes) return;

    const gen = this.generation;
    const url = this.urls.createObjectURL(this.makeBlob(bytes));
    this.busy = true;

    const finish = (ok: boolean) => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
      if (gen !== this.generation) {
        this.urls.revokeObjectURL(url); // reset() ran while this frame was decoding
        return;
      }
      if (ok) {
        if (this.currentUrl) this.urls.revokeObjectURL(this.currentUrl);
        this.currentUrl = url;
      } else {
        this.urls.revokeObjectURL(url);
      }
      this.busy = false;
      if (this.pending) this.paintNext();
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    el.src = url;
  }
}

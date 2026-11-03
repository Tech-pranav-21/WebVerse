/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Incremental parser that pulls complete JPEG frames out of a multipart/x-mixed-replace
 * (MJPEG) byte stream, as produced by the ESP32-CAM "CameraWebServer" firmware.
 *
 * Wire format (stock firmware):
 *   \r\n--<boundary>\r\nContent-Type: image/jpeg\r\nContent-Length: N\r\nX-Timestamp: ...\r\n\r\n<N bytes>
 *
 * Strategy: trust Content-Length when the part declares it; otherwise fall back to scanning for
 * the JPEG start (FF D8) and end (FF D9) markers. Input may be split at arbitrary byte positions.
 * Corrupt input never throws: the parser drops what it cannot use and re-synchronises on the next
 * part header, counting the event in `resyncs`.
 */

const MAX_HEADER_BYTES = 8 * 1024;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

type State = 'headers' | 'body' | 'scan';

export class MjpegFrameParser {
  private buf: Uint8Array = new Uint8Array(0);
  private state: State = 'headers';
  private need = 0;

  /** Number of times the parser had to discard data to re-synchronise. */
  public resyncs = 0;

  /** Feed bytes; returns every frame completed by this chunk (usually 0 or 1). */
  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length === 0) return [];
    this.buf = this.buf.length === 0 ? chunk : concat(this.buf, chunk);
    const frames: Uint8Array[] = [];

    // Each branch either consumes bytes and continues, or breaks to wait for more input.
    for (;;) {
      if (this.state === 'headers') {
        const end = indexOfHeaderEnd(this.buf);
        if (end < 0) {
          if (this.buf.length > MAX_HEADER_BYTES) this.resync();
          break;
        }
        const headerText = latin1(this.buf, 0, end);
        this.buf = this.buf.subarray(end + 4);
        const match = /content-length:\s*(\d+)/i.exec(headerText);
        if (match) {
          const n = Number(match[1]);
          if (!(n > 0) || n > MAX_FRAME_BYTES) {
            this.resyncs++;
            continue; // stay in 'headers' and look for the next part header
          }
          this.need = n;
          this.state = 'body';
        } else {
          this.state = 'scan';
        }
      } else if (this.state === 'body') {
        if (this.buf.length < this.need) break;
        const frame = this.buf.slice(0, this.need);
        this.buf = this.buf.subarray(this.need);
        this.state = 'headers';
        if (isJpegStart(frame)) {
          frames.push(frame);
        } else {
          this.resyncs++;
        }
      } else {
        const soi = indexOfMarker(this.buf, 0xd8, 0);
        if (soi < 0) {
          // No start marker yet: keep only a trailing 0xFF that might begin one.
          this.buf = this.buf.length > 0 && this.buf[this.buf.length - 1] === 0xff
            ? this.buf.subarray(this.buf.length - 1)
            : new Uint8Array(0);
          break;
        }
        const eoi = indexOfMarker(this.buf, 0xd9, soi + 2);
        if (eoi < 0) {
          this.buf = this.buf.subarray(soi);
          if (this.buf.length > MAX_FRAME_BYTES) this.resync();
          break;
        }
        frames.push(this.buf.slice(soi, eoi + 2));
        this.buf = this.buf.subarray(eoi + 2);
        this.state = 'headers';
      }
    }
    return frames;
  }

  private resync(): void {
    this.resyncs++;
    this.buf = new Uint8Array(0);
    this.state = 'headers';
    this.need = 0;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Index of the first "\r\n\r\n", or -1. */
function indexOfHeaderEnd(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

/** Index of the two-byte marker FF <code> at or after `from`, or -1. */
function indexOfMarker(buf: Uint8Array, code: number, from: number): number {
  for (let i = from; i + 1 < buf.length; i++) {
    if (buf[i] === 0xff && buf[i + 1] === code) return i;
  }
  return -1;
}

function isJpegStart(frame: Uint8Array): boolean {
  return frame.length > 3 && frame[0] === 0xff && frame[1] === 0xd8;
}

function latin1(buf: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
  return s;
}

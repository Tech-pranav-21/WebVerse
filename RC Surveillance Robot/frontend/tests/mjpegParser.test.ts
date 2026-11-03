/**
 * MjpegFrameParser tests (MOCKED input: hand-built multipart bytes in the stock ESP32-CAM format).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MjpegFrameParser } from '../src/services/mjpegParser';

const BOUNDARY = '123456789000000000000987654321';
const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** A fake JPEG: SOI, a recognisable payload without 0xFF bytes, EOI. */
function jpeg(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  out[0] = 0xff;
  out[1] = 0xd8;
  for (let i = 2; i < size - 2; i++) out[i] = (seed + i) % 250;
  out[size - 2] = 0xff;
  out[size - 1] = 0xd9;
  return out;
}

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** One part as sent by the stock firmware. */
function part(frame: Uint8Array, withLength = true): Uint8Array {
  const header =
    `\r\n--${BOUNDARY}\r\nContent-Type: image/jpeg\r\n` +
    (withLength ? `Content-Length: ${frame.length}\r\n` : '') +
    `X-Timestamp: 1700000000.123456\r\n\r\n`;
  return cat(enc(header), frame);
}

function pushAll(parser: MjpegFrameParser, bytes: Uint8Array, chunk: number): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += chunk) frames.push(...parser.push(bytes.subarray(i, i + chunk)));
  return frames;
}

describe('MjpegFrameParser', () => {
  it('extracts a frame using Content-Length', () => {
    const f = jpeg(500, 1);
    const frames = new MjpegFrameParser().push(part(f));
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], f);
  });

  it('extracts several frames from one chunk, in order', () => {
    const [a, b, c] = [jpeg(300, 1), jpeg(400, 2), jpeg(350, 3)];
    const frames = new MjpegFrameParser().push(cat(part(a), part(b), part(c)));
    assert.deepEqual(frames, [a, b, c]);
  });

  it('is correct when the stream arrives one byte at a time', () => {
    const [a, b] = [jpeg(120, 4), jpeg(150, 5)];
    const frames = pushAll(new MjpegFrameParser(), cat(part(a), part(b)), 1);
    assert.deepEqual(frames, [a, b]);
  });

  it('is correct for every possible split point of a two-frame stream', () => {
    const [a, b] = [jpeg(90, 6), jpeg(110, 7)];
    const stream = cat(part(a), part(b));
    for (let split = 1; split < stream.length; split++) {
      const p = new MjpegFrameParser();
      const frames = [...p.push(stream.subarray(0, split)), ...p.push(stream.subarray(split))];
      assert.deepEqual(frames, [a, b], `split at ${split}`);
      assert.equal(p.resyncs, 0);
    }
  });

  it('falls back to JPEG start/end markers when Content-Length is absent', () => {
    const [a, b] = [jpeg(200, 8), jpeg(260, 9)];
    const frames = pushAll(new MjpegFrameParser(), cat(part(a, false), part(b, false)), 7);
    assert.deepEqual(frames, [a, b]);
  });

  it('tolerates junk before the first boundary', () => {
    const f = jpeg(100, 10);
    const frames = new MjpegFrameParser().push(cat(enc('some junk without a boundary'), part(f)));
    assert.deepEqual(frames, [f]);
  });

  it('drops a part whose body is not a JPEG (corrupt frame), counts it, and keeps going', () => {
    const good1 = jpeg(100, 11);
    const garbage = new Uint8Array(100).fill(0x41);
    const good2 = jpeg(100, 12);
    const p = new MjpegFrameParser();
    const frames = p.push(cat(part(good1), part(garbage), part(good2)));
    assert.deepEqual(frames, [good1, good2]);
    assert.equal(p.resyncs, 1);
  });

  it('ignores an absurd Content-Length instead of buffering gigabytes, and recovers', () => {
    const f = jpeg(100, 13);
    const absurd = enc(`\r\n--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: 999999999\r\n\r\n`);
    const p = new MjpegFrameParser();
    const frames = p.push(cat(absurd, part(f)));
    assert.deepEqual(frames, [f]);
    assert.ok(p.resyncs >= 1);
  });

  it('recovers when headers never terminate (data that is not MJPEG at all)', () => {
    const p = new MjpegFrameParser();
    p.push(new Uint8Array(20_000).fill(0x42)); // 20 KB without CRLFCRLF
    const f = jpeg(100, 14);
    const frames = p.push(part(f));
    assert.deepEqual(frames, [f]);
    assert.ok(p.resyncs >= 1);
  });

  it('survives a frame that was cut short: later frames still come through', () => {
    const a = jpeg(400, 15);
    const b = jpeg(400, 16);
    const c = jpeg(400, 17);
    // Camera dropped the end of frame A (e.g. a Wi-Fi glitch), then carried on with B and C.
    const truncatedA = part(a).subarray(0, part(a).length - 150);
    const p = new MjpegFrameParser();
    const frames = p.push(cat(truncatedA, part(b), part(c)));
    assert.ok(frames.length >= 1);
    assert.deepEqual(frames[frames.length - 1], c, 'the stream resynchronises and delivers the last intact frame');
  });

  it('returns nothing for an empty chunk and does not throw on tiny input', () => {
    const p = new MjpegFrameParser();
    assert.deepEqual(p.push(new Uint8Array(0)), []);
    assert.deepEqual(p.push(Uint8Array.of(0x0d)), []);
    assert.deepEqual(p.push(Uint8Array.of(0x0a)), []);
  });

  it('returns frames that do not alias the input buffer', () => {
    const f = jpeg(100, 18);
    const input = part(f);
    const frames = new MjpegFrameParser().push(input);
    input.fill(0);
    assert.deepEqual(frames[0], f);
  });

  it('parses a large number of frames without accumulating state', () => {
    const f = jpeg(2000, 19);
    const one = part(f);
    const p = new MjpegFrameParser();
    let count = 0;
    for (let i = 0; i < 2000; i++) count += p.push(one).length;
    assert.equal(count, 2000);
    assert.equal(p.resyncs, 0);
  });
});

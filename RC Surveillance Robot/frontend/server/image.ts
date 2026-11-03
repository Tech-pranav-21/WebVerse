/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ImageProblem = 'empty' | 'not_base64' | 'too_large' | 'not_jpeg' | 'bad_dimensions' | 'wrong_type';

export type ImageCheck =
  | { ok: true; bytes: number; width: number; height: number; base64: string }
  | { ok: false; problem: ImageProblem; message: string };

export const MIN_DIMENSION = 16;
export const MAX_DIMENSION = 4096;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL_PREFIX = /^data:image\/jpeg;base64,/i;

function fail(problem: ImageProblem, message: string): ImageCheck {
  return { ok: false, problem, message };
}

/** Start-of-frame markers carry the picture size. C4, C8 and CC are not frames. */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Read width and height from a JPEG's start-of-frame segment, or null if there is none. */
export function readJpegSize(buf: Uint8Array): { width: number; height: number } | null {
  let i = 2; // after FF D8
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) {
      i++; // fill bytes
      marker = buf[i + 1];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // start of scan / end: no frame header was seen
    const length = (buf[i + 2] << 8) | buf[i + 3];
    if (isSof(marker)) {
      if (i + 8 >= buf.length) return null;
      return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] };
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

/**
 * Check an uploaded image BEFORE it is sent anywhere: it must be valid base64, within the size
 * limit (checked from the encoded length first, so a huge payload is never decoded), a complete JPEG
 * (start and end markers) and of a sane size. Only JPEG is accepted: that is what the camera and the
 * dashboard's canvas produce.
 */
export function validateJpegBase64(input: unknown, mimeType: unknown, maxBytes: number): ImageCheck {
  if (mimeType !== 'image/jpeg') return fail('wrong_type', 'Only image/jpeg is accepted.');
  if (typeof input !== 'string' || input.length === 0) return fail('empty', 'The image is empty.');

  const base64 = input.replace(DATA_URL_PREFIX, '');
  if (base64.length % 4 !== 0 || !BASE64_RE.test(base64)) return fail('not_base64', 'The image is not valid base64.');

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const estimated = (base64.length / 4) * 3 - padding;
  if (estimated > maxBytes) {
    return fail('too_large', `The image is larger than the ${Math.round(maxBytes / 1024)} kB limit.`);
  }

  const buf = Buffer.from(base64, 'base64');
  if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return fail('not_jpeg', 'The data is not a JPEG image.');
  }
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) {
    return fail('not_jpeg', 'The JPEG is incomplete (it does not end properly).');
  }
  const size = readJpegSize(buf);
  if (!size) return fail('not_jpeg', 'The JPEG has no readable picture header.');
  if (size.width < MIN_DIMENSION || size.height < MIN_DIMENSION || size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
    return fail('bad_dimensions', `The picture is ${size.width}x${size.height}; it must be between ${MIN_DIMENSION} and ${MAX_DIMENSION} pixels each way.`);
  }
  return { ok: true, bytes: buf.length, width: size.width, height: size.height, base64 };
}

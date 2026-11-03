/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Clock } from './streamConnectionService';
import { systemClock } from './streamConnectionService';
import { isValidJpeg } from './frameCapture';

/**
 * Smart Snapshot, step 4: hand a stored snapshot to the browser as a real .jpg file.
 *
 * A web page cannot see whether the user finished or cancelled the browser's save, so the result
 * only ever says that the download was STARTED. Saving into the gallery is a different thing and is
 * never reported as a download.
 */

/** Time the temporary blob: URL stays valid so slow browsers can start reading it, then it is revoked. */
export const OBJECT_URL_REVOKE_DELAY_MS = 10_000;

export type DownloadResult = { ok: true; filename: string } | { ok: false; error: string };

export function isDownloadFailure(result: DownloadResult): result is { ok: false; error: string } {
  return !result.ok;
}

export interface DownloadDeps {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** Creates the <a> element, attaches it, clicks it and removes it again. */
  clickAnchor: (href: string, filename: string) => void;
  clock: Clock;
}

const defaultDeps: DownloadDeps = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  clickAnchor: (href, filename) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      document.body.removeChild(a);
    }
  },
  clock: systemClock,
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "esp32-cam-2026-10-21_14-05-09.jpg", in the viewer's local time (the time shown in the gallery). */
export function snapshotFilename(timestamp: number): string {
  const d = new Date(timestamp);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `esp32-cam-${date}_${time}.jpg`;
}

export async function downloadSnapshotBlob(
  blob: Blob,
  timestamp: number,
  overrides: Partial<DownloadDeps> = {},
): Promise<DownloadResult> {
  const deps = { ...defaultDeps, ...overrides };
  const filename = snapshotFilename(timestamp);

  // Check what is about to be written: stored data that was damaged must not become a broken file.
  let valid = false;
  try {
    valid = blob.type === 'image/jpeg' && (await isValidJpeg(blob));
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, error: 'the stored image is empty or damaged, so no file was created' };
  }

  let url: string;
  try {
    url = deps.createObjectURL(blob);
  } catch (err) {
    return { ok: false, error: `the browser could not create a download link (${err instanceof Error ? err.message : String(err)})` };
  }

  try {
    deps.clickAnchor(url, filename);
  } catch (err) {
    deps.revokeObjectURL(url);
    return { ok: false, error: `the browser refused to start the download (${err instanceof Error ? err.message : String(err)})` };
  }

  deps.clock.setTimeout(() => deps.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
  return { ok: true, filename };
}

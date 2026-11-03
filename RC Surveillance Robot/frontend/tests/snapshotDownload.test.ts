/**
 * Smart Snapshot: download tests (MOCKED browser: blob URLs and the anchor click are fakes).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJECT_URL_REVOKE_DELAY_MS,
  downloadSnapshotBlob,
  snapshotFilename,
} from '../src/services/snapshotDownload';
import { FakeClock } from './helpers';
import { blobBytes, jpegBlob } from './snapshotFakes';

function setup(overrides: { createThrows?: Error; clickThrows?: Error } = {}) {
  const clock = new FakeClock();
  const created: Blob[] = [];
  const revoked: string[] = [];
  const clicks: Array<{ href: string; filename: string }> = [];
  const deps = {
    clock,
    createObjectURL: (blob: Blob) => {
      if (overrides.createThrows) throw overrides.createThrows;
      created.push(blob);
      return `blob:fake/${created.length}`;
    },
    revokeObjectURL: (url: string) => void revoked.push(url),
    clickAnchor: (href: string, filename: string) => {
      if (overrides.clickThrows) throw overrides.clickThrows;
      clicks.push({ href, filename });
    },
  };
  return { clock, created, revoked, clicks, deps };
}

describe('snapshotFilename', () => {
  it('contains the capture date and time (local time, zero padded)', () => {
    assert.equal(snapshotFilename(new Date(2026, 9, 21, 14, 5, 9).getTime()), 'esp32-cam-2026-10-21_14-05-09.jpg');
    assert.equal(snapshotFilename(new Date(2027, 0, 2, 3, 4, 5).getTime()), 'esp32-cam-2027-01-02_03-04-05.jpg');
  });

  it('is a plain .jpg name with no characters that file systems reject', () => {
    assert.match(snapshotFilename(Date.now()), /^esp32-cam-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jpg$/);
  });
});

describe('downloadSnapshotBlob', () => {
  it('hands the browser the stored JPEG bytes under a dated filename', async () => {
    const t = setup();
    const blob = jpegBlob(800);
    const ts = new Date(2026, 9, 21, 14, 5, 9).getTime();
    const result = await downloadSnapshotBlob(blob, ts, t.deps);

    assert.deepEqual(result, { ok: true, filename: 'esp32-cam-2026-10-21_14-05-09.jpg' });
    assert.equal(t.clicks.length, 1);
    assert.deepEqual(t.clicks[0], { href: 'blob:fake/1', filename: 'esp32-cam-2026-10-21_14-05-09.jpg' });
    assert.equal(t.created.length, 1);
    const bytes = await blobBytes(t.created[0]);
    assert.equal(bytes.length, 800);
    assert.deepEqual([bytes[0], bytes[1], bytes[bytes.length - 2], bytes[bytes.length - 1]], [0xff, 0xd8, 0xff, 0xd9], 'a valid JPEG file');
    assert.equal(t.created[0].type, 'image/jpeg');
  });

  it('revokes the temporary URL after a delay, not immediately and not twice', async () => {
    const t = setup();
    await downloadSnapshotBlob(jpegBlob(), 1, t.deps);
    t.clock.advance(OBJECT_URL_REVOKE_DELAY_MS - 1);
    assert.deepEqual(t.revoked, [], 'slow browsers still need the URL');
    t.clock.advance(1);
    assert.deepEqual(t.revoked, ['blob:fake/1']);
    t.clock.advance(60_000);
    assert.equal(t.revoked.length, 1);
    assert.equal(t.clock.pendingTimers(), 0);
  });

  it('refuses damaged or empty data and creates no file or URL', async () => {
    for (const bad of [
      new Blob([]),
      new Blob([new Uint8Array(300).fill(3) as BlobPart], { type: 'image/jpeg' }),
      new Blob([(await blobBytes(jpegBlob(300))) as BlobPart], { type: 'image/png' }),
    ]) {
      const t = setup();
      const result = await downloadSnapshotBlob(bad, 1, t.deps);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /empty or damaged/);
      assert.equal(t.created.length, 0);
      assert.equal(t.clicks.length, 0);
    }
  });

  it('reports a browser that cannot create a download link', async () => {
    const t = setup({ createThrows: new Error('URL.createObjectURL is not available') });
    const result = await downloadSnapshotBlob(jpegBlob(), 1, t.deps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /could not create a download link/);
    assert.equal(t.clicks.length, 0);
  });

  it('reports a refused click and revokes the URL right away', async () => {
    const t = setup({ clickThrows: new Error('blocked by the browser') });
    const result = await downloadSnapshotBlob(jpegBlob(), 1, t.deps);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /refused to start the download.*blocked by the browser/);
    assert.deepEqual(t.revoked, ['blob:fake/1']);
    assert.equal(t.clock.pendingTimers(), 0);
  });
});

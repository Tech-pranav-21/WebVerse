/**
 * Smart Snapshot: orchestration tests (capture -> save -> notify, duplicate-click protection,
 * downloads and deletion). MOCKED: fake capture, fake storage, fake download.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureSource, SmartSnapshot, describeCaptureFailure } from '../src/services/snapshotActions';
import { SnapshotLibrary } from '../src/services/snapshotLibrary';
import type { CaptureFailure, CaptureResult, FrameImage } from '../src/services/frameCapture';
import type { DownloadResult } from '../src/services/snapshotDownload';
import { SnapshotStorageError } from '../src/services/snapshotStorage';
import { MemoryStorage, jpegBlob } from './snapshotFakes';

const STREAM = 'http://10.71.151.45/stream';
const okResult = (capturedAt = 5000, w = 640, h = 480): CaptureResult => ({
  ok: true,
  frame: { blob: jpegBlob(2048), width: w, height: h, capturedAt },
});
const failResult = (kind: CaptureFailure['kind'], message = `fail:${kind}`): CaptureResult => ({
  ok: false,
  failure: { kind, message },
});

const liveSource = (over: Partial<Extract<CaptureSource, { kind: 'live' }>> = {}): CaptureSource => ({
  kind: 'live',
  image: { complete: true, naturalWidth: 640, naturalHeight: 480 } as FrameImage,
  connected: true,
  statusLabel: 'connected',
  sourceUrl: STREAM,
  corsRequested: true,
  ...over,
});

/**
 * A promise the test resolves by hand, to hold an operation "in flight". Tests that use it set a timeout,
 * so a broken duplicate-click guard fails the test instead of leaving the run hanging.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(
  options: {
    fromImage?: (img: FrameImage) => Promise<CaptureResult>;
    fromStream?: (url: string) => Promise<CaptureResult>;
    download?: (blob: Blob, ts: number) => Promise<DownloadResult>;
    storage?: MemoryStorage;
  } = {},
) {
  const storage = options.storage ?? new MemoryStorage();
  let n = 0;
  const library = new SnapshotLibrary({ storage, makeId: () => `id-${++n}` });
  const calls = { image: 0, stream: [] as string[], download: [] as Array<{ blob: Blob; ts: number }> };
  const smart = new SmartSnapshot({
    library,
    captureFromImage: async (img) => {
      calls.image++;
      return options.fromImage ? options.fromImage(img) : okResult();
    },
    grabFromStream: async (url) => {
      calls.stream.push(url);
      return options.fromStream ? options.fromStream(url) : okResult();
    },
    download: async (blob, ts) => {
      calls.download.push({ blob, ts });
      return options.download ? options.download(blob, ts) : { ok: true, filename: 'esp32-cam-test.jpg' };
    },
  });
  return { smart, library, storage, calls };
}

describe('capturing a still', () => {
  it('captures the live frame, saves it to the gallery and says "saved", never "downloaded"', async () => {
    const { smart, library, storage, calls } = setup();
    const outcome = await smart.captureStill(liveSource());

    assert.equal(outcome.status, 'saved');
    assert.equal(calls.image, 1);
    assert.equal(calls.stream.length, 0, 'no extra request to the camera for a live capture');
    assert.equal(calls.download.length, 0, 'saving to the gallery is not downloading');
    assert.equal(library.getSnapshot().items.length, 1);
    assert.equal(storage.records.size, 1);

    const notice = smart.getSnapshot().notice!;
    assert.equal(notice.kind, 'success');
    assert.match(notice.message, /captured and saved to the gallery/);
    assert.match(notice.message, /640×480, 2 KB/);
    assert.doesNotMatch(notice.message, /downloaded|download started/i);
  });

  it('creates no snapshot and shows an error when the frame cannot be captured', async () => {
    const { smart, library, storage } = setup({ fromImage: async () => failResult('encode-failed', 'The browser could not encode the frame.') });
    const outcome = await smart.captureStill(liveSource());

    assert.equal(outcome.status, 'failed');
    assert.equal(library.getSnapshot().items.length, 0);
    assert.equal(storage.putCalls, 0);
    const notice = smart.getSnapshot().notice!;
    assert.equal(notice.kind, 'error');
    assert.match(notice.message, /could not encode/);
  });

  it('refuses a live capture when the stream is not connected (the picture could be an old frame)', async () => {
    const { smart, library, calls } = setup();
    const outcome = await smart.captureStill(liveSource({ connected: false, statusLabel: 'reconnecting' }));
    assert.equal(outcome.status, 'failed');
    assert.equal(calls.image, 0);
    assert.equal(library.getSnapshot().items.length, 0);
    assert.match(smart.getSnapshot().notice!.message, /not connected \(reconnecting\).*old frame/);
  });

  it('refuses when there is no live picture on screen', async () => {
    const { smart, calls } = setup();
    const outcome = await smart.captureStill(liveSource({ image: null }));
    assert.equal(outcome.status, 'failed');
    assert.equal(calls.image, 0);
  });

  it('Snapshot mode takes one frame from the stream URL and never asks for /capture', async () => {
    const { smart, library, calls } = setup();
    const outcome = await smart.captureStill({ kind: 'stream', url: STREAM });
    assert.equal(outcome.status, 'saved');
    assert.deepEqual(calls.stream, [STREAM]);
    assert.equal(calls.image, 0);
    assert.ok(calls.stream.every((u) => !u.includes('/capture')));
    assert.equal(library.getSnapshot().items[0].sourceUrl, STREAM);
  });

  it('records the capture time of the frame, not the time of the click', async () => {
    const { smart, library } = setup({ fromImage: async () => okResult(1234) });
    await smart.captureStill(liveSource());
    assert.equal(library.getSnapshot().items[0].timestamp, 1234);
  });
});

describe('quiet captures (automatic captures such as motion detection)', () => {
  it('still saves the snapshot and reports the outcome, but shows no banner', async () => {
    const { smart, library, storage } = setup();
    const outcome = await smart.captureStill(liveSource(), { quiet: true });
    assert.equal(outcome.status, 'saved');
    assert.equal(library.getSnapshot().items.length, 1);
    assert.equal(storage.records.size, 1);
    assert.equal(smart.getSnapshot().notice, null);
  });

  it('shows no banner for a failed capture either; the caller gets the failure', async () => {
    const { smart, library } = setup({ fromImage: async () => failResult('blocked') });
    const outcome = await smart.captureStill(liveSource({ corsRequested: false }), { quiet: true });
    assert.equal(outcome.status, 'failed');
    if (outcome.status === 'failed') assert.equal(outcome.failure.kind, 'blocked');
    assert.equal(library.getSnapshot().items.length, 0);
    assert.equal(smart.getSnapshot().notice, null);
  });

  it('reports a snapshot that could not be stored without a banner', async () => {
    const storage = new MemoryStorage();
    storage.failPut = new SnapshotStorageError('quota', 'the browser storage for this site is full');
    const { smart } = setup({ storage });
    const outcome = await smart.captureStill(liveSource(), { quiet: true });
    assert.equal(outcome.status, 'session-only');
    assert.equal(smart.getSnapshot().notice, null);
  });

  it('is busy like any other capture, so an automatic one never overlaps a manual one', async () => {
    const gate = deferred<CaptureResult>();
    const { smart, calls } = setup({ fromImage: () => gate.promise });
    const manual = smart.captureStill(liveSource());
    assert.deepEqual(await smart.captureStill(liveSource(), { quiet: true }), { status: 'busy' });
    assert.equal(calls.image, 1);
    gate.resolve(okResult());
    assert.equal((await manual).status, 'saved');
    assert.ok(smart.getSnapshot().notice, 'the manual capture still announces itself');
  });

  it('without the option the banner is shown as before', async () => {
    const { smart } = setup();
    await smart.captureStill(liveSource());
    assert.ok(smart.getSnapshot().notice);
  });
});

describe('saving a frame that was captured elsewhere (AI recognition keeps the analysed frame)', () => {
  const frameOf = (capturedAt = 7000) => ({ blob: jpegBlob(4096), width: 640, height: 480, capturedAt });

  it('saves exactly that frame to the gallery and storage, with its own capture time', async () => {
    const { smart, library, storage, calls } = setup();
    const frame = frameOf(7000);
    const outcome = await smart.saveFrame(frame, STREAM);
    assert.equal(outcome.status, 'saved');
    assert.equal(calls.image, 0, 'nothing is captured: the camera is not touched');
    assert.equal(calls.stream.length, 0);
    const item = library.getSnapshot().items[0];
    assert.equal(item.blob, frame.blob);
    assert.equal(item.timestamp, 7000);
    assert.equal(item.sourceUrl, STREAM);
    assert.equal(storage.records.size, 1);
    assert.match(smart.getSnapshot().notice!.message, /captured and saved to the gallery/);
  });

  it('quiet saves show no banner, and still report a storage problem to the caller', async () => {
    const { smart } = setup();
    assert.equal((await smart.saveFrame(frameOf(), STREAM, { quiet: true })).status, 'saved');
    assert.equal(smart.getSnapshot().notice, null);

    const storage = new MemoryStorage();
    storage.failPut = new SnapshotStorageError('quota', 'the browser storage for this site is full');
    const full = setup({ storage });
    const outcome = await full.smart.saveFrame(frameOf(), STREAM, { quiet: true });
    assert.equal(outcome.status, 'session-only');
    assert.equal(full.smart.getSnapshot().notice, null);
    assert.equal(full.library.getSnapshot().items.length, 1, 'the image is kept for the session');
  });

  it('does not wait for, or block, a capture in progress (it never touches the camera)', async () => {
    const gate = deferred<CaptureResult>();
    const { smart, library } = setup({ fromImage: () => gate.promise });
    const capture = smart.captureStill(liveSource());
    assert.equal((await smart.saveFrame(frameOf(), STREAM, { quiet: true })).status, 'saved');
    assert.equal(library.getSnapshot().items.length, 1);
    gate.resolve(okResult());
    assert.equal((await capture).status, 'saved');
    assert.equal(library.getSnapshot().items.length, 2);
  });

  it('ignores a second save while one is being stored', async () => {
    const slow = new MemoryStorage();
    const release = deferred<void>();
    const original = slow.put.bind(slow);
    slow.put = async (record) => {
      await release.promise;
      return original(record);
    };
    const { smart, library } = setup({ storage: slow });
    const first = smart.saveFrame(frameOf(), STREAM, { quiet: true });
    assert.deepEqual(await smart.saveFrame(frameOf(), STREAM, { quiet: true }), { status: 'busy' });
    release.resolve();
    assert.equal((await first).status, 'saved');
    assert.equal(library.getSnapshot().items.length, 1);
  });
});

describe('browser security (canvas SecurityError) messages', () => {
  const blocked: CaptureFailure = { kind: 'blocked', message: 'blocked' };

  it('without CORS capture: explains the cause and offers the one-click remedy', async () => {
    const { smart, library } = setup({ fromImage: async () => ({ ok: false, failure: blocked }) });
    await smart.captureStill(liveSource({ corsRequested: false }));
    const notice = smart.getSnapshot().notice!;
    assert.equal(notice.action, 'enable-capture');
    assert.match(notice.message, /plain cross-origin image/);
    assert.match(notice.message, /Access-Control-Allow-Origin/);
    assert.equal(library.getSnapshot().items.length, 0, 'nothing is created');
  });

  it('with CORS capture already on: says what only the camera can fix and does not pretend the page can', async () => {
    const text = describeCaptureFailure(blocked, { corsRequested: true, live: true });
    assert.equal(text.action, undefined);
    assert.match(text.message, /Reconnect/);
    assert.match(text.message, /only the camera firmware/);
    assert.match(text.message, /not this dashboard/);
  });

  it('passes other failures through unchanged', () => {
    assert.equal(describeCaptureFailure({ kind: 'timeout', message: 'No frame arrived' }, { corsRequested: true, live: false }).message, 'No frame arrived');
  });
});

describe('storage failures', () => {
  it('keeps the captured image as session-only and says it could not be stored', async () => {
    const storage = new MemoryStorage();
    storage.failPut = new SnapshotStorageError('quota', 'the browser storage for this site is full');
    const { smart, library } = setup({ storage });

    const outcome = await smart.captureStill(liveSource());
    assert.equal(outcome.status, 'session-only');
    if (outcome.status === 'session-only') assert.match(outcome.error, /full/);
    assert.equal(library.getSnapshot().items.length, 1);
    assert.equal(library.getSnapshot().items[0].persistence, 'session');
    const notice = smart.getSnapshot().notice!;
    assert.equal(notice.kind, 'error');
    assert.match(notice.message, /captured.*could not be stored.*full/);
    assert.match(notice.message, /download it to keep it/);
    assert.doesNotMatch(notice.message, /saved to the gallery/);
  });
});

describe('duplicate-click protection', () => {
  it('ignores a second capture while one is running, then works again', { timeout: 5000 }, async () => {
    const gate = deferred<CaptureResult>();
    let first = true;
    const { smart, library, calls } = setup({
      fromStream: () => (first ? ((first = false), gate.promise) : Promise.resolve(okResult())),
    });

    const seenCapturing: boolean[] = [];
    smart.subscribe(() => seenCapturing.push(smart.getSnapshot().capturing));

    const a = smart.captureStill({ kind: 'stream', url: STREAM });
    const b = smart.captureStill({ kind: 'stream', url: STREAM });
    const c = smart.captureStill(liveSource());
    assert.equal(smart.getSnapshot().capturing, true);
    assert.deepEqual(await Promise.all([b, c]), [{ status: 'busy' }, { status: 'busy' }]);
    assert.equal(calls.stream.length, 1, 'only one connection to the camera');
    assert.equal(calls.image, 0);

    gate.resolve(okResult());
    assert.equal((await a).status, 'saved');
    assert.equal(library.getSnapshot().items.length, 1, 'one click, one snapshot');
    assert.equal(smart.getSnapshot().capturing, false);
    assert.equal(seenCapturing[0], true);
    assert.equal(seenCapturing[seenCapturing.length - 1], false);

    assert.equal((await smart.captureStill({ kind: 'stream', url: STREAM })).status, 'saved');
    assert.equal(library.getSnapshot().items.length, 2);
  });

  it('shares the guard with the Snapshot-mode preview, so the camera is never asked for two connections', { timeout: 5000 }, async () => {
    const gate = deferred<CaptureResult>();
    const { smart, calls } = setup({ fromStream: () => gate.promise });
    const capture = smart.captureStill({ kind: 'stream', url: STREAM });
    assert.deepEqual(await smart.previewFrame(STREAM), { status: 'busy' });
    assert.equal(calls.stream.length, 1);
    gate.resolve(okResult());
    await capture;
    const preview = await smart.previewFrame(STREAM);
    assert.equal(preview.status, 'ok');
  });

  it('releases the guard even if something throws unexpectedly', async () => {
    const { smart, library } = setup({
      fromImage: async () => {
        throw new Error('canvas exploded');
      },
    });
    const outcome = await smart.captureStill(liveSource());
    assert.equal(outcome.status, 'failed');
    assert.equal(smart.getSnapshot().capturing, false, 'the button is not stuck');
    assert.match(smart.getSnapshot().notice!.message, /canvas exploded/);
    assert.equal(library.getSnapshot().items.length, 0);
  });
});

describe('Snapshot-mode preview', () => {
  it('returns a real frame without adding it to the gallery', async () => {
    const { smart, library } = setup();
    const outcome = await smart.previewFrame(STREAM);
    assert.equal(outcome.status, 'ok');
    assert.equal(library.getSnapshot().items.length, 0);
    assert.equal(smart.getSnapshot().notice, null);
  });

  it('reports a failure, so auto-refresh can stop instead of polling a dead camera', async () => {
    const { smart } = setup({ fromStream: async () => failResult('load-failed', 'The camera did not deliver a frame.') });
    const outcome = await smart.previewFrame(STREAM);
    assert.equal(outcome.status, 'failed');
    assert.match(smart.getSnapshot().notice!.message, /did not deliver a frame/);
  });

  it('a cancelled capture (the user left Snapshot mode) is not reported as an error', async () => {
    const { smart } = setup({ fromStream: async () => failResult('cancelled', 'The capture was cancelled.') });
    const outcome = await smart.captureStill({ kind: 'stream', url: STREAM });
    assert.equal(outcome.status, 'failed');
    assert.equal(smart.getSnapshot().notice, null);
    const preview = await smart.previewFrame(STREAM);
    assert.equal(preview.status, 'failed');
    assert.equal(smart.getSnapshot().notice, null);
  });
});

describe('downloading from the gallery', () => {
  it('starts a download of the stored JPEG and says it STARTED', async () => {
    const { smart, calls } = setup();
    const captured = await smart.captureStill(liveSource());
    assert.equal(captured.status, 'saved');
    const id = captured.status === 'saved' ? captured.item.id : '';

    const outcome = await smart.downloadSnapshot(id);
    assert.deepEqual(outcome, { status: 'started', filename: 'esp32-cam-test.jpg' });
    assert.equal(calls.download.length, 1);
    assert.equal(calls.download[0].ts, 5000);
    const notice = smart.getSnapshot().notice!;
    assert.equal(notice.kind, 'success');
    assert.match(notice.message, /Download started: esp32-cam-test\.jpg/);
    assert.doesNotMatch(notice.message, /downloaded|saved to the gallery/);
  });

  it('never claims success when the file could not be created', async () => {
    const { smart } = setup({ download: async () => ({ ok: false, error: 'the stored image is empty or damaged, so no file was created' }) });
    const captured = await smart.captureStill(liveSource());
    const id = captured.status === 'saved' ? captured.item.id : '';
    const outcome = await smart.downloadSnapshot(id);
    assert.equal(outcome.status, 'failed');
    const notice = smart.getSnapshot().notice!;
    assert.equal(notice.kind, 'error');
    assert.match(notice.message, /Download failed: .*damaged.*No file was saved/);
    assert.doesNotMatch(notice.message, /started/);
  });

  it('reports a snapshot that no longer exists', async () => {
    const { smart, calls } = setup();
    assert.deepEqual(await smart.downloadSnapshot('gone'), { status: 'missing' });
    assert.equal(calls.download.length, 0);
    assert.equal(smart.getSnapshot().notice!.kind, 'error');
  });

  it('ignores a second click on the same snapshot while its download is starting, but not other snapshots', { timeout: 5000 }, async () => {
    const gate = deferred<DownloadResult>();
    const { smart, calls } = setup({ download: () => gate.promise });
    const a = await smart.captureStill(liveSource());
    const b = await smart.captureStill(liveSource());
    const idA = a.status === 'saved' ? a.item.id : '';
    const idB = b.status === 'saved' ? b.item.id : '';

    const first = smart.downloadSnapshot(idA);
    assert.deepEqual(smart.getSnapshot().busyIds, [idA]);
    assert.deepEqual(await smart.downloadSnapshot(idA), { status: 'busy' });
    const other = smart.downloadSnapshot(idB);
    assert.equal(calls.download.length, 2, 'the other snapshot is independent');

    gate.resolve({ ok: true, filename: 'x.jpg' });
    await Promise.all([first, other]);
    assert.deepEqual(smart.getSnapshot().busyIds, []);
  });
});

describe('deleting from the gallery', () => {
  it('removes the snapshot and its stored data', async () => {
    const { smart, library, storage } = setup();
    const captured = await smart.captureStill(liveSource());
    const id = captured.status === 'saved' ? captured.item.id : '';
    assert.equal(await smart.removeSnapshot(id), true);
    assert.equal(library.getSnapshot().items.length, 0);
    assert.equal(storage.records.size, 0);
  });

  it('reports a failed delete and keeps the snapshot', async () => {
    const { smart, library, storage } = setup();
    const captured = await smart.captureStill(liveSource());
    const id = captured.status === 'saved' ? captured.item.id : '';
    storage.failRemove = new Error('locked');
    assert.equal(await smart.removeSnapshot(id), false);
    assert.equal(library.getSnapshot().items.length, 1);
    assert.match(smart.getSnapshot().notice!.message, /was not deleted: locked/);
  });

  it('clearAll empties everything, or reports why it could not', async () => {
    const { smart, library, storage } = setup();
    await smart.captureStill(liveSource());
    await smart.captureStill(liveSource());
    storage.failClear = new Error('locked');
    assert.equal(await smart.clearAll(), false);
    assert.equal(library.getSnapshot().items.length, 2);
    storage.failClear = null;
    assert.equal(await smart.clearAll(), true);
    assert.equal(library.getSnapshot().items.length, 0);
  });
});

describe('notifications', () => {
  it('dismissNotice clears the message, and each message has its own id', async () => {
    const { smart } = setup();
    await smart.captureStill(liveSource());
    const first = smart.getSnapshot().notice!;
    smart.dismissNotice();
    assert.equal(smart.getSnapshot().notice, null);
    await smart.captureStill(liveSource());
    assert.notEqual(smart.getSnapshot().notice!.id, first.id);
  });
});

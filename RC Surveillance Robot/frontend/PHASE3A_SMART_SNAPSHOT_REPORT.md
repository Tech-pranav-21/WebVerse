# Phase 3A Report: Smart Snapshot

Scope: Capture Still, Snapshot mode and the Snapshot Gallery. No video recording, motion detection, motor, Bluetooth or driving code, no backend, no new package, no change to the configured camera address.

## Read this first

1. **Nothing here has been verified through the dashboard on the physical ESP32-CAM.** The RC car was switched off (charging) before that test could run. What *was* done on the real camera is listed in section 3, and is a standalone browser test, not the dashboard.
2. Every other result is either an **automated mocked test** (fake canvas, fake image, fake IndexedDB) or a **real-browser run against the MOCK camera** (`tools/mock-esp32-cam`, 160×120 test frames). Those prove how the dashboard and the browser behave; they say nothing about your camera's timing or firmware.
3. The camera has no `/capture`. Smart Snapshot never requests it.

## 1. What changed

| Area | Before | Now |
| --- | --- | --- |
| Capture Still, live stream | Drew the plain cross-origin `<img>` on a canvas (always a `SecurityError`), then fell back to the missing `/capture`, then saved a "remote reference" to a URL that does not work | Reads the displayed frame; if the browser blocks it, says why and offers the fix. Never creates an image it did not read |
| Snapshot mode | Fetched `/capture` (also on a timer) | Takes the first frame of `/stream` in a temporary image and closes the connection; auto-refresh stops at the first failure |
| Gallery storage | `sessionStorage`, base64, about 5 MB limit, 15 items, lost when the tab closes | IndexedDB, real JPEG blobs, newest 100, survives refresh and restart |
| Download | `<a download>` of a data URL, or "open the URL in a new tab" for references | JPEG built from the stored blob, validated, dated filename, blob URL revoked |
| Wording | One "captured" message | *captured*, *saved to gallery*, *download started* kept apart; a gallery save is never called a download |

New files: `services/frameCapture.ts`, `snapshotStorage.ts`, `snapshotLibrary.ts`, `snapshotDownload.ts`, `snapshotActions.ts`; `hooks/useSmartSnapshot.ts`, `hooks/useObjectUrl.ts`; `components/SnapshotNoticeBanner.tsx`; tests `frameCapture`, `snapshotStorage`, `snapshotLibrary`, `snapshotDownload`, `snapshotActions` and `snapshotFakes` (helpers); this report.

Modified: `types/camera.ts` (`SnapshotItem` now holds a Blob; `CameraConfig.captureCors`), `config/cameraConfig.ts` (default off), `services/cameraService.ts` (old snapshot storage removed), `services/streamTransports.ts` (opt-in `crossorigin`), `services/streamConnectionService.ts` (`corsCapture` restarts the stream), `hooks/useStreamConnection.ts`, `components/CameraView.tsx`, `SnapshotGallery.tsx`, `SettingsModal.tsx`, `CameraToolbar.tsx` (tooltip), `NetworkGuideView.tsx` (one sentence), `pages/Dashboard.tsx`, `tsconfig.test.json`, existing tests `streamTransports.test.ts` and `streamConnection.test.ts` (tests added, none removed), `README.md`.

## 2. Design decision: how a frame is read, and why

A canvas can export pixels only if the image is not cross-origin tainted. Options for the user's camera, which serves `/` and `/stream` and sends `Access-Control-Allow-Origin: *` on `/stream`:

- **`<img crossorigin="anonymous">` + canvas (chosen).** Keeps the proven plain-image stream; needs the header. Opt-in because a camera *without* the header makes the browser refuse the stream.
- **Frame monitor (`fetch`) bytes.** Also works, but its 5 s stall timeout is tight for a camera that delivered frames 2 to 7 s apart in the one probe made (section 3), so it was not made the capture path. It still works for capture because its frames are same-origin blobs.
- **A second `/stream` request on demand** was rejected for live mode: a camera that serves one viewer would drop or starve the live picture. Snapshot mode uses it only because no live connection is open there.

An earlier Phase 1 note says an `<img crossorigin>` on the multipart stream is refused even with the header. **That did not reproduce** in Chromium 152 on the mock camera (loads, canvas readable) nor in the one real-camera check below. Phase 1 used Chromium 141 in a different environment; the cause of the difference was not investigated.

## 3. Real-device results (physical ESP32-CAM, 10.71.151.45, 2026-10-21)

Done with `curl`, a small Node reader and one page in the in-app Chromium 152. The camera was powered and reachable at that time.

| Check | Result |
| --- | --- |
| `GET /stream` response headers | `200`, `Content-Type: multipart/x-mixed-replace; boundary=frame`, **`Access-Control-Allow-Origin: *`** |
| `GET /` | `200 text/html`, no CORS header |
| `GET /capture` | connection reset (unsupported, as stated) |
| Wire format | `--frame`, `Content-Type: image/jpeg`, `Content-Length`, JPEG of about 20 kB. The existing parser's Content-Length path handles it |
| `<img crossorigin="anonymous" src=".../stream?smart=...">` from a page on another origin | **loaded after 2.7 s, 640×480, `canvas.toDataURL('image/jpeg')` succeeded** (so the header is sufficient in Chromium) |
| Frame cadence | one 10 s probe: first frame at 7.4 s, next at 9.3 s; an earlier 6 s probe received 2 frames. A single observation; another viewer may have been connected |
| The extra `?smart=` query string | accepted by the firmware (the image loaded) |

**Not tested on the real camera:** Capture Still in the dashboard, Snapshot mode, auto-refresh, gallery with real frames, whether the camera serves a second stream request while one is open, Firefox/Safari. A dashboard run against the camera was attempted and could not complete because the camera was by then unreachable (`ping`: host unreachable).

## 4. Simulated results (mock camera, real Chromium 152, through the dashboard)

Mock camera started with `--cors`; dashboard served by Vite.

| Scenario | Result |
| --- | --- |
| Capture Still with the plain image (default settings) | `SecurityError` caught; no snapshot; message and *Allow snapshot capture* button shown |
| Click that button | stream reconnected with `crossorigin="anonymous"`; setting persisted |
| Capture Still again | "Capturing..." then "captured and saved to the gallery (160×120, 1 KB)" |
| IndexedDB record | `image/jpeg`, starts `FFD8`, ends `FFD9`, decodes to 160×120, correct source URL |
| Page refresh | gallery shows the snapshot as **SAVED**, image decodes |
| Download (anchor click intercepted so nothing was written to disk) | blob 1,480 bytes, `image/jpeg`, `FFD8…FFD9`, decodes; filename `esp32-cam-2026-10-21_00-28-43.jpg`; message "Download started"; blob URL revoked after 10 s |
| Storage full (write forced to throw `QuotaExceededError`) | image kept as **SESSION ONLY**, message says it could not be stored; the saved one untouched |
| Delete | IndexedDB records 1 → 0 |
| Snapshot mode, Fetch Frame Now | connections 0 → 1 → 0; request was `/stream?_snap=…`; **zero requests to the control port (`/capture`)** |
| Three rapid Capture Still clicks (Snapshot mode) | button disabled, **1** stream request, **1** gallery item |
| Auto-Refresh 2 s, then camera taken down | 3 grabs in 7 s; one failed attempt; Auto-Refresh switched to Off; error shown; **no further attempts** over the next 8 s |
| Live Feed ↔ Snapshot ↔ Gallery switching, with the option on and off | never more than one connection; 0 when the feed is not showing |

Method note: an unexplained extra stream connection appeared during testing. It came from a leftover test page of mine in another browser tab, not from the dashboard; reloading that tab removed it and the switching sequence above was then re-run clean.

## 5. Automated results

| Command | Result |
| --- | --- |
| `npm test` | **373 passed, 0 failed** (291 existing + 82 new) |
| `npm run lint` | passed (`tsc --noEmit` for the app, strict `tsc` for the tests) |
| `npm run build` | passed (`vite build`, 1,697 modules) |

New tests cover: successful capture, capture failure, `SecurityError`, non-JPEG output, unsupported `/capture` (never requested), valid download bytes and filename, URL revocation, gallery integration, deletion removing stored data, persistence across a simulated refresh, storage errors (quota, unavailable, damaged records), duplicate clicks, cancellation, and the CORS-before-`src` ordering and stream restart. **Mutation checks were not completed.** A script that rewrote source files to inject bugs was started and then stopped; it left one injected bug (the duplicate-click guard removed) in `snapshotActions.ts`, which was found, reverted and re-verified (all other targets checked unchanged; final `npm test` and `npm run build` were run after the revert). With that bug in place the duplicate-click test hung rather than failed, so the three tests that hold an operation open now have a 5 s timeout (the timeout itself was not exercised). All tests are mocked.

## 6. Verify on the real camera when the car is on

1. Open the dashboard, Settings: Base URL `http://10.71.151.45`, Stream path `/stream`. Wait for *Connected* (the first frame may take several seconds).
2. Click Capture Still. Expected: the "will not let this page read" message with the button. Click it, wait for *Connected* again, click Capture Still: "captured and saved". Open the gallery: 640×480 image, **SAVED**.
3. Refresh the page: the snapshot is still there. Click Download: a `.jpg` arrives; open it.
4. Switch to Snapshot mode, Fetch Frame Now (allow up to 15 s). Check the camera is not asked for `/capture` (DevTools, Network).
5. Optional: with the live view open in another browser tab, repeat step 4 to learn whether the camera serves two streams at once.

## 7. Remaining limitations

- Unverified on hardware (section 3). Chromium only.
- The camera must keep sending `Access-Control-Allow-Origin` on `/stream`; if a future firmware drops it, capture is impossible from this dashboard.
- A snapshot is the stream frame size; the firmware offers no other still.
- With *Allow snapshot capture* on, a camera without the header makes the picture disappear (documented, off by default).
- Settings "Test Connection" and the Diagnostics "/capture" row still probe `/capture` and report failure on this camera. Left unchanged as out of scope.
- Old `sessionStorage` snapshots are not migrated.
- The 5 s Frame monitor stall timeout may be too tight for this camera's frame spacing (one observation); not changed.

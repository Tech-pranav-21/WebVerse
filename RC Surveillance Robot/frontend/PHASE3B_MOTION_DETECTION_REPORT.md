# Phase 3B Report: Motion Detection

Scope: browser-based motion detection on the live stream, its controls, alerts, event history and the optional Smart Snapshot link. No video recording, no backend, no cloud service, no new package, no motor, Bluetooth or driving code, no change to the configured camera address.

## Read this first

1. **Nothing here has been run against the physical ESP32-CAM.** The car was off (charging) and the camera was not contacted at all during this phase.
2. Results are of two kinds only: **automated mocked tests** (generated frames, fake clock, fake canvas) and **real-browser runs against the MOCK camera** (`tools/mock-esp32-cam`, 160×120 test frames cycling at 10 fps). The mock's frames change by about 3 to 5 % of the picture from one second to the next (3.1 to 4.7 % was measured), so it stands in for "movement" near the Medium threshold. It does not model a real camera's noise, exposure or frame rate.
3. The default thresholds are conservative guesses. **They are untuned** until you see your camera's noise floor (section 7).

## 1. What was built

| Piece | File |
| --- | --- |
| Frame comparison (pure algorithm) | `services/motionDetector.ts` |
| Pixel access from the stream `<img>` | `services/frameSampler.ts` |
| Supervisor: timer, status, confirmation, cooldown, lifecycle, snapshot link | `services/motionMonitor.ts` |
| Settings, sensitivity presets, validation | `services/motionSettings.ts` |
| Event history (localStorage) | `services/motionHistory.ts` |
| "Click again to confirm" | `services/confirmGate.ts` |
| Types | `types/motion.ts` |
| React binding | `hooks/useMotionDetection.ts` |
| UI | `components/MotionDetectionPanel.tsx` |

Tests (new): `motionDetector`, `frameSampler`, `motionHistory` (includes the confirm gate), `motionMonitor`, plus the helper `motionFakes.ts`; new cases in `snapshotActions.test.ts`.

Modified: `Dashboard.tsx` (renders the panel), `useStreamConnection.ts` (exposes `getImage()` and `browserStore()`, both additive; the connection architecture is untouched), `snapshotActions.ts` and `useSmartSnapshot.ts` (a `quiet` option for automatic captures), `tsconfig.test.json`, `README.md`.

**Reuse.** The frame source is the stream `<img>` the dashboard already shows (no second camera connection), made readable by the Phase 3A "Allow snapshot capture" setting. Snapshots on motion call the existing `SmartSnapshot.captureStill`; there is no second gallery, storage path or download code.

## 2. Algorithm and thresholds

Every check interval (default 1 s, options 0.25 to 5 s): draw the picture into one reused 64×48 canvas, read the pixels, convert to grayscale (3,072 bytes). Then:

1. **Same picture?** 32-bit checksum equal to the last picture: skip (counted as "repeated"), nothing is compared.
2. **Brightness compensation.** The median of (current minus previous) over the watched area is subtracted. A median, not a mean, so a moving object covering a minority of the picture does not shift the baseline.
3. **Changed pixel** = difference after compensation **greater than** the noise tolerance.
4. **changedPercent** = changed pixels / pixels in the watched area. A change must also cover at least 4 pixels.
5. **Alert** when changedPercent is at least the minimum area for N consecutive comparisons (default 2) and the cooldown (default 15 s) is over.

| Preset | Noise tolerance | Minimum area |
| --- | --- | --- |
| Low | 40 | 8 % |
| Medium (default) | 28 | 4 % |
| High | 18 | 1.5 % |

An explicit minimum area overrides the preset's, but never goes below 0.5 %. Watched area: whole picture, centre half, left, right, top or bottom half.

## 3. CPU and memory

Counted, not profiled. One timer chain (`setTimeout`), never an interval. Per check: one `drawImage` of the stream element to 3,072 pixels, one 12 kB `getImageData` (`willReadFrequently`), two passes over 3,072 bytes. Two 3 kB buffers and one canvas are allocated once and swapped, not copied. In the mock-browser run the page made **24 pixel reads in 24 s** (1 per second). Stop, leaving the Live Feed, a hidden tab and a disconnect all clear the timer and shrink the canvas to 0×0. **Not measured:** actual CPU percentage on a real machine or phone.

## 4. Lifecycle rules (as implemented and tested)

- Detection runs only while the Live Feed shows in Live Stream mode (the only time a stream element exists). Leaving that tab stops it; it returns as OFF and never restarts by itself.
- Disconnect, Snapshot mode or hidden tab: timer cleared, previous picture discarded, status CAMERA DISCONNECTED / PAUSED. Back to connected and visible: resumes by itself with a **fresh baseline**.
- A camera that freezes for 15 s and then sends frames again: the first new picture is a fresh baseline.
- A second Start while running changes nothing.
- FRAME ACCESS BLOCKED and ERROR stop the checking (no retry loop). They are retried when the stream reconnects, or after Stop + Start.
- **PAUSED is a state I added** beyond your list, because showing ACTIVE while nothing is being processed would be untrue.
- A plain `<img>` cannot report a mid-stream stall, so after the camera dies the dashboard's own health monitor needs a few seconds (about 3 s on the mock) to report the stream as disconnected. Until then the frozen picture is simply skipped as a repeat.

## 5. Browser security limits

`getImageData` on a cross-origin image without CORS throws `SecurityError`; the panel then shows FRAME ACCESS BLOCKED, explains it and offers the existing *Allow snapshot capture* button. Nothing is claimed active and no event is created. The camera must send `Access-Control-Allow-Origin` on `/stream`. It did when checked on 2026-10-21 (Phase 3A, standalone browser test); this phase did not re-check it. Chromium only.

## 6. Verification

### Automated (mocked): 489 tests pass, 0 fail

`npm test` 489 passed (373 before, 116 new). `npm run lint` passed. `npm run build` passed. They cover: identical frames (no motion, skipped, never ACTIVE), changed frames, sensitivity differences, noise tolerance, minimum area and floor, brightness changes, watched areas, cooldown, confirmation, no duplicate loops, start/stop, disconnect and reconnect (fresh baseline), Snapshot mode, hidden tab, decode errors, canvas `SecurityError` (also through the real sampler class), history storage, size limits, corruption and storage failure, the clear confirmation, optional snapshots (saved, failed, skipped, never during cooldown), and cleanup.

Mutation checks were run **on a scratch copy only** (the project was never modified). Of 13 injected bugs, 10 were caught on the first run. Of the 3 misses, two were equivalent mutants (the code resets its state in two places, so removing one changes nothing) and one was a real test gap (a second Start resetting a running detector), which I closed with a new test. Sharper versions of those three, and a compile-safe version of a fourth that had only produced a build error, were then all caught.

### Mock-browser (real Chromium 152, mock camera, through the dashboard)

| Check | Result |
| --- | --- |
| Start with CORS capture off | only FRAME ACCESS BLOCKED; 1 pixel read then 0 more in 3 s; no events; remedy button |
| Click the remedy, stream reconnects | CAMERA DISCONNECTED → STARTING → ACTIVE by itself |
| Frames change ≥ 4 % | MOTION DETECTED, back to ACTIVE after about 4 s |
| Cooldown | two events 26 s apart at a 15 s cooldown |
| Snapshot on motion | each event links one saved snapshot; 2 events, 2 valid JPEGs (`FFD8`) in the gallery; no banners |
| Pixel reads | 1 per second |
| Camera refuses connections for 9 s | CAMERA DISCONNECTED; no events, no reads during the outage; STARTING → ACTIVE after |
| Camera frozen 20 s | compared count did not change, repeated skipped 5 → 19, no events, "No new camera picture for 19 s" shown and cleared |
| Frozen 21 s then frames resume (after the fix in section 4) | compared count unchanged: first fresh frame only a baseline |
| Page reload | 5 stored events restored |
| Leave the Live Feed | 0 reads in 5 s; panel gone; OFF on return, 0 reads |
| Snapshot display mode | PAUSED with explanation, 0 reads; back to Stream: resumes |
| Hidden tab (**simulated** by overriding `visibilityState`) | PAUSED, 0 reads; shown: STARTING then ACTIVE |
| Clear history | first click only asks; Cancel and a 6 s timeout both withdraw it; confirm empties the list and removes the stored key |
| Mobile (375×812 emulation, not a phone) | no horizontal scroll, nothing overflowing |
| Accessibility basics | 13 controls named and tabbable, polite live status region, labelled sensitivity group |

### Real camera

**Not verified.** No physical-camera test was attempted.

## 7. Verify on the real camera when the car is on

Steps are in README section 15. The most useful reading is step 3: hold still and watch the "changed %" readout; that is your camera's noise floor, and the sensitivity should sit clearly above it.

## 8. Remaining limitations

- Everything in section 6 "Real camera". Thresholds, false-alert rate and detection latency on the real camera are unknown. The real camera delivered frames 2 to 7 s apart in one Phase 3A probe, which would make the 2-frame confirmation take several seconds.
- Detection needs the Live Feed in Live Stream mode in an open, visible tab. It is not a background or unattended recorder.
- Only consecutive frames are compared, so very slow movement is missed; lighting, shadows, vibration and exposure can cause false alerts.
- The Frame monitor combination (same-origin frames) and Firefox/Safari were not tried.
- CPU load was counted, not profiled.
- The status can lag a real stream failure by a few seconds (plain `<img>` limitation, section 4).
- No sound or system notification: alerts are visual only.

# Phase 1 Report: Camera Feed Freezes, Status Accuracy and Recovery

Scope: the RC Surveillance Robot dashboard (React 19, TypeScript, Vite, Tailwind, ESP32-CAM MJPEG).
Nothing was added for motors, Bluetooth, driving, a backend, or a redesign. The camera address stays configurable in Settings (your camera, 10.71.151.45, is entered there; the default in code was not changed).

## Read this first

1. **I could not determine the physical cause of the freezes, and no frontend change can.** Without your camera, car, power rail and Wi-Fi, the honest answer is "unproven". Section 1 lists what the evidence does and does not support. Section 6 is a step-by-step hardware test that will find it.
2. **I found and fixed real defects in the dashboard that made the problem look worse and impossible to diagnose.** The original code showed "Stream Active" while the picture was frozen or blank, could not reconnect, opened two or three stream connections for one viewer, and let late probe results overwrite the status. These were reproduced against a mock camera (before) and are fixed (after).
3. **What the dashboard can and cannot see depends on a setting.** A plain browser video element reports only the first frame of a connection; it can never see a mid-stream stall. The new optional **Frame monitor** can, but only if your camera sends an `Access-Control-Allow-Origin` header. That is the key thing to check on your camera (Section 6, step 2).
4. **Everything below that was verified was verified against a MOCK camera and fake clocks, not hardware.** Section 4 separates the two. I could not run `vite build` in my sandbox (Section 4.3), so please run `npm run build` yourself.

---

## 1. Root cause, or the remaining uncertainty (deliverable 1)

### 1.1 What was observed (original code, mock camera, real Chromium)

| # | Observation | Evidence |
|---|---|---|
| 1 | A plain `<img>` MJPEG stream fires exactly one `load` event (first frame). A stall, a reset and a corrupt frame later on raise **no event**. | experiments E1, E3a, E9 |
| 2 | During a stall the picture simply stops on the last frame, the socket stays open, and the stream **resumes by itself** when the camera resumes. | E2 (40 s stall, then resume) |
| 3 | After a connection reset the browser **does not reconnect**; the element is left with no decodable image (`complete` true, width 0) and no event. After a camera reboot the same holds until a new element is created. | E3a (8 repeats), E4a/E4b |
| 4 | One corrupt (non-JPEG) frame in the middle of a stream blanks the element and it **stays blank** although the connection continues. A truncated frame does not. | E9 |
| 5 | Removing an `<img>` from the page does **not** close its connection; clearing its `src` does. Re-using the same URL can re-attach to the old (possibly stalled) request instead of opening a new one. | E5, E6 |
| 6 | The original probes left stream connections open (a successful probe of the stream URL kept its connection). | E7 |
| 7 | Without `Access-Control-Allow-Origin` from the camera, `fetch()` of the stream fails ("Failed to fetch") and an `<img crossorigin>` is refused. With the header, `fetch()` reads the stream frame by frame and sees stalls and resets. (A plain cross-origin `<img>` is never readable from a canvas, with or without the header.) | E8, E6-taint |

### 1.2 What the original dashboard did (same harness)

| Situation | Original dashboard |
|---|---|
| Healthy start | "Stream Active", but **2 stream connections** open for one viewer |
| Stream stalled 12 s | Still "Stream Active", picture frozen |
| Connection reset | Still "Stream Active", picture **blank**, never recovers |
| Reconnect while stalled | 3 connections open; after the camera resumed the header said **"Connection Error" while the picture was playing** |
| Two quick Reconnect clicks (header, then toolbar) | 2 extra requests, final status "Connection Error" |
| Camera serving one client at a time | "Connection Error" shown **while the picture was playing** (the probe was starved by the stream) |
| Leave the Live Feed tab and come back | connection never closed; probes added one more |
| Automatic reconnect | **None.** `autoReconnect` existed only as an unused config field (default false). |

### 1.3 Your symptom against the evidence

You said the feed freezes at speed **and recovers by itself**. The original app had no reconnect logic, and a browser never reconnects an `<img>` stream by itself (observation 3). So a feed that came back on its own means **the connection stayed open and the camera or network resumed sending**: a stall, not a drop. That is an inference, not a measurement; it fits observation 2 exactly. It argues against the camera fully rebooting (a reboot would have left the picture dead until a page action) unless you reloaded the page.

### 1.4 The seven suspected causes, assessed separately

| | Cause | Verdict | What the frontend can do |
|---|---|---|---|
| A | **Stale frames** shown as if live | Confirmed as a display behaviour: a stalled `<img>` keeps showing the last frame with no signal (obs. 1, 2, 4). Not the *origin* of your freeze, but it is why a freeze is invisible and indistinguishable from a still scene. | Frame monitor measures every frame and reconnects a stalled stream. Plain mode can only detect a blank/undecodable image. |
| B | **Wrong status** | Confirmed, several ways (1.2). | Fixed: one owner, evidence-based status (Section 3). |
| C | **Overlapping reconnects / extra connections** | Confirmed in the app (1.2). Whether it hurts *your* camera depends on firmware that serves one client at a time; **unverified for your camera**. | Fixed: at most one stream connection, ever (tests assert it in every scenario). |
| D | **Timeouts** | The old probe gave up after 4 s on a stream URL and the status then followed it. A first frame arriving just after that limit was reported as a failed endpoint, and the fallback check left a stream connection open (E7c). | Fixed: connect timeout counts from opening the stream to the first frame (8 s), stall timeout 5 s (monitor), all in one policy object. Values are **not tuned on hardware**. |
| E | **Camera restarts** | Cannot be told apart from other causes in the browser; the dashboard now recovers from them (mock: 5 s refusing connections recovered about 6 s after detection). | Retry with bounded back-off. Cannot prevent the restart. |
| F | **Wi-Fi** | **Unknown.** A browser cannot read signal strength or packet loss, and I did not invent such numbers. | Frame monitor shows the *effect* (frame rate, longest freeze) for correlation with distance and position. |
| G | **Power / vibration** | **Unknown, and a frontend cannot fix it.** A brownout reboot looks like a connection loss followed by a boot delay. | Recovery after the reboot only. The fix is on the car (Section 7). |

### 1.5 Remaining uncertainty

- Which of E, F, G (or a firmware/frame-size effect) causes the stall on your car. The Frame monitor "longest freeze" figure and the event log are the instrument for that; the test in Section 6 uses them.
- Whether your firmware sends CORS headers (decides if the Frame monitor works), serves one stream client at a time, and accepts `/stream?_rc=N` (the dashboard adds that parameter on retries; some firmware may reject unexpected query strings). All three are one-minute checks in Section 6.

---

## 2. Files changed and why (deliverable 2)

New files:

| File | Why |
|---|---|
| `src/services/streamConnectionService.ts` | `StreamConnection`: the single owner of the stream connection, status, retries and recovery bookkeeping. No DOM/React; clock and transport injected so it is testable. |
| `src/services/streamTransports.ts` | Two ways to open the stream: plain `<img>` (default) and `fetch()` reader (Frame monitor), plus a latest-frame-wins blob renderer. |
| `src/services/mjpegParser.ts` | Splits the multipart MJPEG byte stream into JPEG frames (Frame monitor); tolerant of arbitrary chunking and corrupt data. |
| `src/services/streamStatusText.ts` | Honest tooltip/hint wording and time formatting. |
| `src/hooks/useStreamConnection.ts`, `src/hooks/useNow.ts` | Bind the connection to React (`useSyncExternalStore`); relative-time labels. |
| `src/components/StreamHealthCard.tsx` | Diagnostics "Stream Health" card. |
| `tests/*.test.ts`, `tsconfig.test.json`, `tools/run-tests.mjs` | Mocked unit tests and a zero-dependency runner. |
| `tools/mock-esp32-cam/` | A mock camera to exercise the dashboard without hardware. |
| `docs/phase1-evidence/` | Raw results behind this report. |

Modified files:

| File | Change |
|---|---|
| `src/pages/Dashboard.tsx` | Removed the probe-driven status logic; uses `useStreamConnection`. Stream is open only while Live Feed is shown in stream mode. |
| `src/components/CameraView.tsx` | Renders from `health`; the `<img>` has no `src` of its own (the manager sets it); reconnecting placeholder with attempt and countdown; failure panel shows error and host reachability; Retry never disabled; OSD shows fps and longest gap in monitor mode. Snapshot capture, reticle, fit, fullscreen, snapshot mode are unchanged. |
| `src/components/DiagnosticsPanel.tsx` | Adds the Stream Health card. Probes now abort on settings change/unmount and ignore stale results (run token + settings epoch). CORS note made accurate. Existing three probes kept. |
| `src/components/SettingsModal.tsx` | New "Stream Recovery" section: auto-reconnect, base retry delay, Frame monitor. "Test Connection" ignores stale results and is cancelled when the dialog closes. |
| `src/components/Header.tsx`, `CameraToolbar.tsx`, `CameraStatus.tsx`, `ConnectionIndicator.tsx` | Reconnect no longer disabled; new "Reconnecting" state; status tooltip states what the status is based on; label "Stream Active" -> "Connected". |
| `src/services/connectionService.ts` | Probes always release their connection, support cancellation, and the fallback host check targets the camera origin, not the stream URL. |
| `src/types/camera.ts`, `src/config/cameraConfig.ts`, `src/services/cameraService.ts` | New types/fields; `autoReconnect` default true; stored configs from older versions get the new recovery defaults (camera address and paths are kept). |
| `package.json` | Scripts only: `lint` also type-checks tests, new `test`. **No new dependencies; `package-lock.json` untouched.** |
| `tsconfig.json` | `exclude` for tests/tools/build output. |
| `README.md`, `.gitignore` | Documentation; ignore `.test-build/`. |

## 3. Summary of modifications (deliverable 3)

- **One owner for the stream.** `StreamConnection` opens, closes and retries the stream. Every event carries an attempt id; anything from a superseded attempt is ignored, so a late result cannot overwrite newer status.
- **Evidence-based status.** Connecting / Connected / Reconnecting / Disconnected / Error (plus Host reachable and Unconfigured). Connected means a frame arrived on the current connection. A responding host never produces Connected. Camera reachability is stored and shown separately and never changes stream status.
- **Recovery.** Connect timeout 8 s; in monitor mode a stall of 5 s; in plain mode an undecodable image for 2 s. Up to 6 retries; after a working stream drops the first retry is within 1 s, otherwise delays start at the configured base (default 5 s) and double up to 60 s; the retry counter resets only after 10 s of stable connection (a flapping connection does not get fast retries again). Then it stops and shows Error. Manual Reconnect always works, resets the budget, closes the old connection first, collapses rapid clicks, and cancels any pending automatic retry.
- **No overlapping streams.** The old connection is explicitly closed (source cleared, or fetch aborted) before a new one opens; later attempts use a unique `_rc` query parameter so the browser cannot re-attach to the old request. The connection is closed when the Live Feed is hidden. Probes release their connections.
- **Cleanup.** Timers, handlers, in-flight host checks and fetches are cancelled on shutdown, config change and unmount (also safe under React StrictMode, checked).
- **Diagnostics.** Status, evidence level, last confirmed frame, attempts, recovery result, last error, host reachability, frame rate and longest freeze (monitor mode), and an event log. No Wi-Fi or packet-loss numbers.
- **Behaviour changes you should know about:** auto-reconnect is now on by default (it did nothing before); leaving the Live Feed tab now closes the stream and returning opens a fresh one; the status label "Stream Active" is now "Connected".

## 4. Tests run and actual results (deliverable 4)

Environment: Linux sandbox, Node 22.22.0, TypeScript from the project's `node_modules`, Playwright's headless Chromium 141.

### 4.1 Commands and results

| Command | Result |
|---|---|
| `npm run lint` (`tsc --noEmit` for the app, then for the tests) | exit 0, no errors |
| `npm test` | **118 tests, 26 suites, 118 pass, 0 fail, 0 skipped**, about 0.6 s. Full listing: `docs/phase1-evidence/unit-tests-spec-output.txt` |
| `npm run build` (`vite build`) | **NOT RUN, see 4.3** |

Test files and what they cover (all **mocked**):

| File | Tests | Covers |
|---|---|---|
| `tests/streamConnection.test.ts` | 58 | initial connect; connect timeout then retry then recovery; connection lost after working; camera restart; bounded retries and back-off cap; auto-reconnect off; manual reconnect; duplicate-click collapse; retry cancelled by manual reconnect; stale attempt events ignored; stale host results ignored; monitor-mode stall detection and freeze measurement; plain-mode blank-image watchdog; transport failing inside `open()`; visibility (feed hidden/shown); configuration changes; mixed content; no stream path; shutdown cleanup (timers, sessions, probes); StrictMode-style restart; snapshot contract for `useSyncExternalStore`. A check after every test asserts that **no more than one stream was ever open at once**. |
| `tests/mjpegParser.test.ts` | 13 | frame extraction by Content-Length and by markers; every possible split point; byte-by-byte; garbage, absurd lengths, non-terminating headers, truncated frame. |
| `tests/connectionProbes.test.ts` | 16 | probes release their connection (success, error, timeout, cancel); no connection opened if already cancelled; host check never re-requests the stream URL; mixed content makes no request. Stubbed `Image` and `fetch`. |
| `tests/streamTransports.test.ts` | 21 | plain-image transport (single `load`, close semantics, no events after close, blank-image poll); fetch transport (CORS request, errors, close aborts the request, silence after close); blob renderer (latest frame wins, no leaked blob URLs, reset). |
| `tests/streamStatusText.test.ts` | 10 | status wording does not overclaim; formatting helpers. |

Per-file counts add up to the 118 reported by the run (58 + 13 + 16 + 21 + 10).

**Do the tests have teeth?** All 118 passed on the first run, which proves little, so I deliberately broke the code 19 ways (removing stale-event guards, the click debounce, timer cleanup, session close, retry bound, back-off, stall check, probe release, abort, and so on) and re-ran the suite. **18 of 19 were caught.** One initial miss (a retry timer not being cleared) exposed a real gap: a manual reconnect that fails again could be cut short by the timer it replaced. I added a regression test and a defensive `clearTimer`, and the combined mutation is now caught. The one remaining mutant (clearing the image source before detaching handlers in the plain transport) is equivalent: a `closed` flag already makes the handlers inert.

### 4.2 Browser runs of the real application against the mock camera

The application source was bundled with bun and run in headless Chromium against `tools/mock-esp32-cam` (before = original source, after = modified). Raw results: `docs/phase1-evidence/dashboard-*.json`. Times are as seen by the page.

| Situation | Before (original) | After (modified) |
|---|---|---|
| Healthy start | Connected; **2** stream connections | Connected; **1** connection |
| Connection reset (RST) | "Stream Active", picture blank, never recovers | Reconnecting after about 2.5 s, picture back and Connected at about 3.7 s |
| Stall, plain mode | "Stream Active", frozen | Still "Connected", frozen. **Not detectable in plain mode**, by design of the browser (Section 8). Tooltip says so. |
| Stall 9.5 s, **Frame monitor** | n/a | Detected after 5 s without a frame, old connection closed, Reconnecting; Connected again 0.4 s after the camera resumed. Diagnostics: "Recovered after 4.7 s and 1 automatic retry", longest freeze 9.8 s |
| Manual Reconnect while stalled | 3 connections open; later "Connection Error" while the picture plays | +1 request, 1 connection open; after resume Connected and moving |
| Rapid Reconnect clicks (before: 2 clicks; after: 4 clicks within 0.3 s) | 2 extra requests; final "Connection Error" | **+1 request**, 1 connection |
| Camera serving one client at a time | "Connection Error" with a playing picture | Connected, moving, 1 open, 0 queued, also after header and toolbar Reconnect |
| Camera reboot, refusing connections 5 s | browser never reconnects | Reconnecting at 2.5 s, Connected at 8.6 s |
| Camera reboot, silent for 6 s ("blackhole") | new connection hangs | Connected at 16.7 s (8 s connect timeout plus back-off) |
| Frame monitor, camera without CORS header | n/a | Reconnecting with an explicit "Access-Control-Allow-Origin" explanation; bounded retries; no connection left open |
| Leave Live Feed, return, run Diagnostics probes | 2 open, 2 open, 2 open, then 3 (leak) | 1 open, **0** while away, 1 on return, **0** after probes |
| Settings: tick Frame monitor and save | n/a | works; value persisted; OSD shows fps and longest gap |
| React StrictMode build | n/a | start, reset, tab-switch and monitor-stall scenarios identical, no page errors |

Page errors in all runs: none.

### 4.3 What I could not run, and why

- **`npm run build` / `vite build`**: not possible in my sandbox. The supplied `node_modules` contains Windows-native binaries and the Linux Rolldown binding is missing; `npm ci` is blocked because the sandbox cannot reach the npm registry. I did not work around this. `tsc` type-checks the whole application (exit 0) and the real source was bundled with bun, but **that is not the same as your Vite + Tailwind build**. Please run it.
- **Visual check of the new UI**: Tailwind was not processed in my browser runs, so I verified behaviour and text, not appearance. The new markup uses ordinary Tailwind classes in the style of the existing components, but please look at it.
- **Firefox, Safari, mobile browsers**: not tested. All browser observations are Chromium only.

### 4.4 Mocked versus real hardware

| Claim | Mocked / simulated | Needs your hardware |
|---|---|---|
| Status transitions, retry limits, back-off, duplicate prevention, stale-result handling, cleanup | yes (unit tests, fake clock) | |
| How a browser `<img>` and `fetch()` behave on stall, reset, garbage frame, reboot | yes (real Chromium, mock camera imitating the stock wire format) | Confirm your firmware's format matches |
| The dashboard recovers from a stall / reset / reboot | yes (mock) | Whether *your* freeze is one of these |
| Cause of the freeze at speed | **no** | **yes** |
| Camera sends CORS header; serves one client; accepts `?_rc=` | **no** (mock is configurable) | **yes** |
| Retry delays and timeouts suit the real camera | **no** | **yes** |
| Frame monitor CPU cost with real frame sizes and rates | **no** (160x120 frames at 10 fps) | **yes** |

---

## 5. Commands to run locally (deliverable 5)

Windows PowerShell or any shell, from the `frontend` folder:

```
npm install
npm run lint
npm test
npm run build
npm run dev          (opens on http://localhost:3000, use plain http)
```

Try the dashboard against the mock camera, without hardware (Node 18.3 or newer):

```
node tools/mock-esp32-cam/mock-esp32-cam.mjs --cors
```

Then in Settings: Base URL `http://localhost:8080`, Stream path `:8081/stream`, Snapshot `/capture`. Failure injection (open in a browser tab):

```
http://localhost:8082/__chaos?action=stall
http://localhost:8082/__chaos?action=resume
http://localhost:8082/__chaos?action=drop
http://localhost:8082/__chaos?action=reboot&ms=8000
http://localhost:8082/__chaos?action=reboot&ms=8000&mode=blackhole
http://localhost:8082/__chaos?action=corrupt&kind=garbage
http://localhost:8082/__stats
```

Useful options: `--single-client` (serve one viewer at a time), omit `--cors` to see the Frame-monitor error path, `--fps 25`.

`npm test` compiles the tests into `.test-build/` (git-ignored) and runs every file there.

## 6. Physical camera test, step by step (deliverable 6)

Goal: find out *which* of Wi-Fi, power, firmware or a second connection stalls the stream. Change one thing at a time and write the result in the log table at the end.

**Before you start.** Note the firmware sketch and version, the camera board, how it is powered, and the Wi-Fi router. Open the dashboard at `http://localhost:3000` (plain http), and enter your camera address in Settings.

1. **Baseline, car stationary.** Open Live Feed. Expect Connected. Open Diagnostics, Stream Health: Evidence will say "first frame only".
2. **Check whether your camera sends CORS headers.** In Chrome: F12, Network tab, reload the Live Feed, click the `stream` request, look under Response Headers for `access-control-allow-origin`.
   - Present: go to Settings, Stream Recovery, tick **Frame monitor**, Save. The OSD now shows fps and the longest gap, and stalls are detected and recovered.
   - Absent: the Frame monitor will fail with a clear message. Either add the header to the stream handler in your firmware (in the stock example the stream handler sets response headers with `httpd_resp_set_hdr`; add `Access-Control-Allow-Origin: *` there; I could not verify here whether your sketch version already does), or continue in plain mode, where you can detect resets but not stalls (you will see the freeze with your own eyes and can note its time).
3. **Does the camera serve only one viewer?** With the dashboard streaming, open `http://<camera>:81/stream` in a second tab. If the dashboard's picture stops or the second tab stays blank, your firmware serves one client at a time: keep one viewer, and note it for the log.
4. **Does it accept the retry URL?** Open `http://<camera>:81/stream?_rc=2` in a tab. If it shows video, retries work as designed. If it errors, tell me; the `_rc` parameter is produced in one function (`urlForAttempt`).
5. **Stationary soak, 10 minutes**, car's normal battery, motors off. Read the Stream Health event log and (Frame monitor) "longest gap". Gaps here point to Wi-Fi or firmware, not driving.
6. **Motors on, wheels off the ground**, 5 minutes. Then **slow on the ground**, 5 minutes, then **fast**, 5 minutes. After each, record events and longest gap. A freeze that begins exactly when the motors start, or "connection lost" followed by a boot delay, points at the power rail (voltage sag or brownout).
7. **Distance / position.** Repeat the fast run close to the router, then far or behind obstacles. Freezes only when far point to Wi-Fi range. Also test with the RC transmitter off if you use a 2.4 GHz radio, since it shares the band with Wi-Fi.
8. **Power check.** With a multimeter or scope at the camera board's 5 V pins during motor start-up, look for dips below about 4.7 V. Open the Arduino Serial Monitor (115200 baud) and watch for "Brownout detector was triggered" or unexpected resets. Retest with a separate regulated 5 V supply of at least 2 A for the camera and a large capacitor close to the board.
9. **Recovery test.** While viewing, unplug the camera's power for 5 seconds and replug. Expect Reconnecting, then Connected. Note the time to recover.
10. **Wi-Fi signal (the only real source).** If you want signal strength, print `WiFi.RSSI()` once per second in your sketch's Serial Monitor and compare with the dashboard's freeze times. The browser cannot read it.

Log template (copy into a notebook):

| Run | Condition | Frame monitor? | Freezes (count) | Longest gap | Auto-recovered? | Notes (events, serial output, RSSI) |
|---|---|---|---|---|---|---|

## 7. Remaining hardware and network concerns (deliverable 7)

- **Power.** An ESP32-CAM draws sharp current spikes when Wi-Fi transmits and when the sensor starts. A shared motor battery, a thin wire or a weak regulator can sag below the brownout threshold. The dashboard can only reconnect after the camera comes back.
- **Wi-Fi.** The ESP32-CAM is 2.4 GHz only. A moving car changes distance and orientation, and a metal chassis can shadow the antenna. A 2.4 GHz RC transmitter can interfere. Router channel, distance and an external antenna are worth testing.
- **Firmware load.** Larger frames (resolution, JPEG quality), frame rate, and how the stream task shares the CPU with Wi-Fi affect how much data must be retransmitted when the link is weak. Try a smaller frame size or a higher JPEG quality number (more compression) and compare the longest-gap figure. I have not tested this; it is a hypothesis to compare, not a fix.
- **One client at a time.** If your firmware serves one stream client, any second viewer (another tab, phone, a leftover connection) can block or starve the real one. The dashboard no longer creates extra connections of its own.

## 8. Known limitations (deliverable 8)

- **Plain mode cannot see a stall.** In the default mode the page learns only about the first frame, resets that leave a blank image, and load errors. A freeze that recovers by itself, which is what you described, is invisible there, and the status will still say Connected. The tooltip says so. Use the Frame monitor (needs CORS) or watch the picture.
- **Frame monitor is experimental.** It reads the stream with `fetch()` and paints each frame through a short-lived blob URL. Tested only with tiny mock frames at 10 fps; CPU use with 640x480 or larger frames at higher fps on your machine is unmeasured. One bad frame is dropped rather than breaking the display.
- **Timeouts and delays are defaults, not measured values.** Connect 8 s, stall 5 s, blank-image grace 2 s, 6 retries, 1 s quick retry, 10 s stability. They are in `DEFAULT_STREAM_POLICY`; only the base retry delay and the on/off switch are in the Settings UI.
- **Detection delay in plain mode** after a reset is about 2.5 s (a 2 s grace plus the 1 s check interval).
- **Hidden tabs.** Browsers throttle timers in background tabs, so detection and retries can be delayed while the dashboard tab is not visible. Not tested.
- **The `_rc` retry parameter** may be rejected by some firmware (unverified); there is no fallback to the plain URL.
- **Chromium only** for all browser observations (Firefox and Safari handle multipart images differently and were not tested).
- **Behaviour change:** switching away from the Live Feed now disconnects it and a fresh connection starts when you return.
- **Snapshot mode, gallery, Network Guide, fullscreen, capture** were not changed and were not re-tested beyond type-checking and the stream scenarios above.
- Mixed-content handling (HTTPS page, HTTP camera) is covered by unit tests only, not in a browser.

## 9. Files deliberately left unchanged (deliverable 9)

`src/components/Sidebar.tsx`, `SnapshotGallery.tsx`, `NetworkGuideView.tsx`, `src/App.tsx`, `src/main.tsx`, `src/index.css`, `index.html`, `vite.config.ts`, `metadata.json`, `.env.example`, `public/`, `package-lock.json` (no dependency changes), the camera address defaults and environment-variable names, and the snapshot/gallery storage and capture logic.

Not included in the ZIP: `node_modules/` (Windows-native, reinstall with `npm install`), your previous `dist/` build output, and the stale nested archive `rc-surveillance-robot-frontend.zip` that came inside your upload.

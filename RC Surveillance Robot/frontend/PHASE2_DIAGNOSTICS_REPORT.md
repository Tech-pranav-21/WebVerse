# Phase 2 Report: Advanced Diagnostics and Monitoring

Scope: the Diagnostics tab of the RC Surveillance Robot dashboard (React 19, TypeScript, Vite, Tailwind, ESP32-CAM MJPEG), built on top of Phase 1.
Nothing was added for motors, Bluetooth, driving, a backend, a database, or a redesign. No dependency was added. The camera address, stream path and snapshot path were not changed. Phase 3 was not started.

## Read this first

1. **Everything new lives on the Diagnostics tab.** The Live Feed page, Settings, Snapshot Gallery, Network & CORS Guide, Fullscreen and the Stream Recovery settings behave as they did in Phase 1 (Section 9 lists the few small differences).
2. **What was verified, and what was not.** 291 mocked unit tests pass. The real dashboard code was also driven in headless Chromium against a mock ESP32-CAM, in 15 Phase 2 scenarios and the 11 Phase 1 scenarios. **I did not test a physical ESP32-CAM, real Wi-Fi or a phone.** **I could not run the production build** in my sandbox (Section 4.3), so please run `npm run build` yourself.
3. **The dashboard now says, for every number, whether it was measured, not measured yet, or cannot be measured.** A browser cannot read Wi-Fi signal strength or packet loss, so those are shown as "cannot be measured", never estimated. A request time is a browser HTTP request time, not Wi-Fi latency.
4. **Two limits you should know about before trusting a number.**
   - The video stream is opened only while the Live Feed is on screen (a Phase 1 rule, kept on purpose so diagnostics never open a second connection to a camera that may serve one viewer). So on the Diagnostics tab the stream state reads "Disconnected - stream not open on this page", and "Measure now" measures a camera that is idle from this dashboard's point of view, not one under video load.
   - In plain video mode the page sees only the first frame of each connection. A mid-stream freeze is invisible there. Turning on **Frame monitor** (Settings, Stream Recovery) makes stalls visible, but only if your camera sends an `Access-Control-Allow-Origin` header. That requirement is unchanged and is now also shown in the Diagnostics tab.

---

## 1. Summary of the Phase 2 features (deliverable 1)

### 1.1 Diagnostics Summary (new card at the top of Diagnostics)

A banner with the stream state, then one row per fact. Each row carries a chip: **Measured**, **Not measured yet**, or **Cannot be measured**.

| Row | What it shows | Honesty rule built in |
| --- | --- | --- |
| Video stream | Not configured, Host reachable (no stream configured), Connecting, Stream connected, Stalled - reconnecting, Reconnecting, Disconnected (with "stream not open on this page" when that is the reason), Error | Uses the Phase 1 status model. "Stalled" appears only when a stall was actually detected (Frame monitor). Plain mode never says stalled. "Connected" in plain mode says it proves only the first frame. |
| Camera host reachability | Answers (request took N ms), No answer (timed out / network error), checking, no check run yet, or "cannot be measured here" (mixed content) | "Answers" always carries "does not show that video is flowing". A failed check while the stream is connected is shown as a warning about one request. A failed check that is older than the last video frame is marked **outdated**, because a frame proves the camera answered afterwards. |
| First frame of this connection / Last confirmed frame | When, with the clock time | Plain mode: "first frame of the connection", not proof that video is still advancing. Frame monitor: "last confirmed frame", and it says picture content is not compared. When the stream is not open the label says "of the last connection". |
| Most recent connection error | The message, when, and whether the stream reconnected since | |
| Reconnection attempts | In the current recovery (n of 6) and since page load | |
| Did reconnection succeed? | Yes (after how long), Not yet, No (retries used up), No reconnection was needed, or **Unknown - recovery was interrupted** | If you leave the Live Feed while a recovery is running, it no longer says "no reconnection was needed". |
| Most recent successful recovery | When, how long it took, retries used | |

Below the rows, "What this page can and cannot measure" lists six capabilities as Available / Limited / Cannot be measured: first frame and connection errors, detecting a stalled stream, camera reachability and request time, whether the picture itself changed, Wi-Fi signal strength, packet loss and true network latency. The stall item explains what is needed (Frame monitor plus the CORS header) and what is wrong when the monitor is on but blocked.

### 1.2 Connection History (new card)

A readable, newest-first event list with an All / Problems filter.

| Event | Severity | When it is recorded |
| --- | --- | --- |
| Dashboard opened | info | Once per page load (React StrictMode does not duplicate it) |
| Settings changed | info | The camera address or stream settings changed (the stream reconnects with them) |
| Connecting | info | A connection was opened |
| First frame | ok | The first decodable frame arrived (and how long it took) |
| Stream lost | error | A working stream dropped (reset, ended, display lost) |
| Connect failed | error | A connection never produced a frame |
| Stream stalled | warn | Frame monitor only: no frame for 5 s while the connection stayed open |
| Reconnecting | info | A retry started (n of 6) |
| Recovered | ok | A frame arrived after a failure, with the time it took |
| Reconnect failed | error | A retry failed (identical causes are folded) |
| Reconnect stopped | error | Automatic retries were used up or are off |
| Host unreachable | warn | The reachability check changed from not-failing to failing |
| Host reachable | ok | It changed back |
| Cause unknown | warn | The host answers but the stream still delivers no frames; the text says the browser cannot tell why |

Rules: one entry per distinct cause per continuous failure (repeats are counted, "x3, last 14:02:11", never listed again); a host event is recorded only on a change, not on every probe; a result that arrives after the camera settings changed, or after the stream already recovered, is dropped or marked outdated instead of becoming an event; capped at 100 events and about 40 kB; "Clear history" asks for a second click and expires after 6 seconds.

Persistence uses `localStorage` (the same mechanism the camera settings already use), key `rc_surveillance_connection_history_v1`. Limits are in Section 7.

### 1.3 Camera Response Time (new card)

- **Measure now**: one small browser request to the camera's web server (the configured base address), timed with a monotonic clock until the response headers arrive, then aborted so no body stays open. 2.5 s timeout.
- Shows the latest value, whether it answered, timed out or failed, the last 20 requests as bars (failures are marked, not drawn as a duration), and min/median/max of answered requests only (a timeout is not a latency).
- **Measure periodically** is **off by default** (5, 10, 30 or 60 s). It pauses while the tab is hidden, never overlaps a running request, and stops when you leave the Diagnostics tab.
- Never changes the stream status: a failed measurement is recorded as a measurement, and at most as a "Host unreachable" history entry.
- The card states what is measured, that the browser hides the status code (so any HTTP answer counts as "host answers"), that it includes connection set-up and the camera's own processing time, and that Wi-Fi signal strength and packet loss are not available.
- Not run at all, with an explanation, when the dashboard is served over HTTPS and the camera is plain HTTP (the browser would block it, which would look like an outage).

### 1.4 Copy Report (in the Diagnostics Summary card)

**Copy Report** puts a plain-text report on the clipboard; **Show report** displays it. The report holds: generated time (UTC), diagnostics version, browser name, whether the page is HTTP or HTTPS and whether the browser reports online; the camera address with credentials, query string and fragment removed; stream and snapshot paths without query strings; current state; every summary row with its Measured / Not measured / Cannot be measured tag; response-time statistics; the capability list; the newest 25 events (oldest first, with a note when more are stored); the storage status; and eight known measurement limitations.

- Clipboard: `navigator.clipboard` when available. That API exists only on HTTPS or localhost, and the dashboard is often opened over plain HTTP from a LAN address, so there is a fallback (a hidden text box and `execCommand('copy')`). If both fail, the report is shown in a text box, already selected, with a message to press Ctrl+C. The button is never left disabled.
- Secrets: a shared redaction module removes `user:password@`, query strings, fragments, `password=`, `token=`, `secret=`, `api_key=`, `Authorization:` and `Bearer ...` text from everything that is stored or copied. A secret placed inside a URL **path** cannot be recognised; the dashboard never builds such URLs.
- It does **include** the camera address (for example a private 192.168.x.x or 10.x.x.x address) and the browser's name string. The feedback message and the last line of the report say so. Remove them before posting publicly if you prefer.
- No snapshot, image or video data is ever included.

### 1.5 Honest limits, in the interface and in the report

The Diagnostics tab and the report state the plain-mode limit (first frame only), the Frame monitor requirement (CORS header), that picture content is not compared (a camera repeating one image would still look alive), that the request time is not Wi-Fi latency, and that signal strength and packet loss cannot be read by a web page.

### 1.6 Layout

Diagnostics order: header, Diagnostics Summary, Stream Health, Camera Response Time, Connection History, an explanatory note, the three probe tests, the power advisory, the console log. All cards stack on narrow screens (checked at 1280 px and 390 px wide: no horizontal overflow). The Phase 1 verbose log inside the Stream Health card moved into a collapsed section "Detailed stream log of this page session" so the new history is the main log.

---

## 2. Files changed and why (deliverable 2)

### New files

| File | Why |
| --- | --- |
| `src/services/redact.ts` | Removes credentials, query strings, fragments and secret-looking text before anything is stored or copied. |
| `src/services/connectionHistory.ts` | The history store: typed events, folding of repeats within one failure, caps, `localStorage` persistence with a memory-only fallback, clearing, validation of stored data. No React, no DOM. |
| `src/services/diagnosticsSummary.ts` | Turns the Phase 1 health snapshot into the summary rows, capability list and response-time statistics, with the measured / not measured / cannot-be-measured wording. Pure functions. |
| `src/services/diagnosticReport.ts` | Builds the report text. Pure function. |
| `src/services/clipboard.ts` | Copy with the Clipboard API, a fallback, and typed failure reasons. Environment is injectable for tests. |
| `src/components/DiagnosticsSummaryCard.tsx` | Summary card, capabilities list, Show/Copy Report, feedback. |
| `src/components/ResponseTimeCard.tsx` | Measure now, opt-in periodic measurement, bars and statistics, explanations. |
| `src/components/ConnectionHistoryCard.tsx` | History list, filter, two-step clear, storage note. |
| `tests/redact.test.ts`, `tests/connectionHistory.test.ts`, `tests/phase2Monitoring.test.ts`, `tests/diagnosticsSummary.test.ts`, `tests/diagnosticReport.test.ts`, `tests/clipboard.test.ts` | Phase 2 tests (Section 4). |
| `PHASE2_DIAGNOSTICS_REPORT.md`, `docs/phase2-evidence/` | This report and its raw evidence. |

### Modified files (line counts are against the Phase 1 ZIP)

| File | Change | Why |
| --- | --- | --- |
| `src/services/streamConnectionService.ts` (+276 / -34) | Records history events at the existing state transitions; adds `measureHost`, `setAutoMeasure`, `clearHistory`, `checkHost(trigger)`; keeps a ring of 30 reachability samples; remembers failure kind, last successful recovery and interrupted recovery; guards every asynchronous probe with a sequence token. The Phase 1 state machine (phases, retry schedule, attempt ids) is unchanged. | The connection manager is the single owner of the stream, so it is the only place that can record events without guessing. |
| `src/types/camera.ts` (+121) | New types for events, samples, failure kinds, recovery summary; new **optional/additive** fields on the health snapshot. Phase 1 fields are untouched. | |
| `src/services/connectionService.ts` (+19 / -3) | The reachability probe measures with `performance.now()` (monotonic) and reports why it failed (timeout, cancelled, network). | A wall clock can jump; "cancelled" must not look like a failure. |
| `src/services/streamStatusText.ts` (+31 / -3) | `formatEventTime`; `hostResultIsOutdated`; the reachability sentence no longer warns about power/Wi-Fi once a frame arrived after the failed check. | Avoids a stale warning. |
| `src/hooks/useStreamConnection.ts` (+37 / -4) | Builds the history on `localStorage` (write-tested first), passes the page-session id and visibility check, exposes the three new actions. | |
| `src/pages/Dashboard.tsx` (+4 / -1) | Passes the three actions to Diagnostics. | |
| `src/components/DiagnosticsPanel.tsx` (+53 / -2) | Renders the three new cards, an explanatory note about one-off probes, and works out whether the probe shares the stream's port. | |
| `src/components/StreamHealthCard.tsx` (+23 / -11) | Rows stack on narrow screens; "request took N ms" wording; outdated-failure wording; verbose log collapsed; recovery text for an interrupted recovery. | |
| `tsconfig.test.json` | Lists the new pure modules for the test compile. | |
| `tests/helpers.ts`, `tests/connectionProbes.test.ts`, `tests/streamStatusText.test.ts` | Helpers extended; tests **added** (no Phase 1 test removed or edited; `streamConnection`, `mjpegParser` and `streamTransports` tests are byte-identical to Phase 1). | |
| `README.md` | New section 13 and project structure. | |

---

## 3. Features reused from Phase 1 (deliverable 3)

- The status model (`unconfigured`, `connecting`, `connected`, `reconnecting`, `error`, `disconnected`, `host_reachable`) and its meanings. Nothing was added to the enum.
- `StreamConnection` as the single owner of the stream; the injected clock and transport; the attempt-id guard against late events; the retry policy, quick first retry, backoff, `_rc` retry parameter, manual-reconnect debounce.
- The `useSyncExternalStore` binding and the health snapshot.
- The reachability probe and the recovery summary (states `none`, `in_progress`, `succeeded`, `failed`).
- The Phase 1 verbose event log (kept, collapsed).
- Existing storage conventions: `localStorage`, `rc_surveillance_*` key names, try/catch around every access.
- The existing Diagnostics probes, power advisory and console log; the design system (same card, chip and button styles); the Frame monitor and its CORS requirement; the mock camera and the dependency-free test runner.

---

## 4. Tests executed and actual results (deliverable 4)

### 4.1 Commands and results (Linux sandbox, Node 22, project TypeScript 5.9.3)

| Command | Result |
| --- | --- |
| `npm run lint` (app type-check plus test type-check) | Ran, **exit code 0** |
| `npm test` | Ran: **291 tests, 57 suites, 291 passed, 0 failed, 0 cancelled, 0 skipped**. About 2 seconds. |
| `npm run build` | **Could not run** (Section 4.3) |

All unit tests are **mocked**: fake clock, fake stream transport, fake reachability probe, fake `localStorage`, fake clipboard. They test logic, not a camera.

Phase 1 had 118 tests. All 118 are still present (checked by test title) and pass; the 173 others are new. Full listing: `docs/phase2-evidence/unit-tests-spec-output.txt`.

### 4.2 What the new tests cover (your list from the brief)

| Requirement | Tests |
| --- | --- |
| Connection-event recording | `phase2Monitoring` (recording, severities, ordering), `connectionHistory` |
| Duplicate-event prevention | folding by cause within one failure, host events only on a change, a bounded history through a very long outage, periodic failures reported once |
| Reconnection history | lost -> reconnecting -> recovered order, retry numbering, give-up, manual reconnect resetting the budget, recovery summary, interrupted recovery |
| Diagnostic request success / failure / timeout | `connectionProbes`, `phase2Monitoring` (answer, refusal, timeout, throwing probe, cancelled) |
| Overlapping requests | one at a time from Measure now, automatic and failure triggers; periodic tick skipped while running |
| Stale asynchronous results | answer and failure after a settings change; old failure after the stream recovered; cancelled request; shutdown |
| Report generation | `diagnosticReport` (sections, redaction, bounds, limitations, missing data) |
| Clipboard success and failure | `clipboard` (API, fallback, denied, unavailable, empty, cleanup and focus restore) |
| Missing or unavailable measurements | `diagnosticsSummary` (not measured, unavailable, blocked, plain vs monitor, always-unavailable Wi-Fi and packet loss) |
| History clearing and storage | `connectionHistory`, `phase2Monitoring` (clear, reload, StrictMode, blocked storage, quota, corrupt data, bounds) |
| Secrets | `redact` and report tests (credentials, tokens, query strings, Bearer text) |

### 4.3 What I could not run, and why

- **Production build (`vite build`): could not run.** The supplied `node_modules` contains Windows binaries; Vite's bundler (rolldown) has no Linux native binding, and I cannot install packages here (the npm registry is blocked). `npm run build` printed "vite: Permission denied"; running Vite directly ended with "Cannot find native binding". Output: `docs/phase2-evidence/vite-build-attempt.txt`. As a partial substitute I bundled the real source with bun (succeeded) and the type-checks pass. **That is not a `vite build`.** Please run `npm run build` locally.
- **`npm install`:** not run (registry blocked); `package.json` and the lock file are unchanged.
- **Physical ESP32-CAM, real Wi-Fi, motors/power:** not tested.
- **Browsers other than Chromium 141, and a real phone:** not tested. "Mobile" means a 390 px wide Chromium viewport.

### 4.4 Browser runs of the real application against the MOCK camera

Method: the real source was bundled with bun, Tailwind CSS was compiled from the real class names, and the page was driven with Playwright Chromium against `tools/mock-esp32-cam` (which can stall, reset, reboot, serve one client, add or omit CORS headers). Raw output: `docs/phase2-evidence/browser-phase2-scenarios-P1-P14.json`.

| Scenario | Result |
| --- | --- |
| P1 healthy start, layout | Summary, response-time and history cards render; no horizontal overflow at 1280 px and 390 px |
| P2 Measure now | One click produced exactly one request to the camera |
| P3 periodic measurement | 0 requests while off (default); 4 in 13 s at 5 s; 0 after switching off; 0 after leaving the tab |
| P4 camera reboot (connections refused) | Header Connected after recovery; exactly one "Host unreachable" entry; retries and repeats folded; the old "no answer" shown as **outdated** after the recovery |
| P5 Frame monitor, stall | Header showed Reconnecting during the stall, Connected after; exactly one "Stream stalled" entry; recovery summary correct |
| P5b leaving the Live Feed mid-recovery | "Did reconnection succeed?" read **Unknown - recovery was interrupted** |
| P6 plain mode, stalled camera | Header stayed Connected (plain mode cannot see it); **zero** stall entries; label says "first frame of the last connection" |
| P7 reload and clear | History survived a reload ("earlier session" marker); cancel kept it; confirm removed it and the stored key |
| P8 clipboard allowed | Report copied (about 5.7 kB) with success message |
| P9 secrets | `admin:hunter2@`, `?token=SECRETTOKEN&auth=abc` in the configured address and stream path: **no leak** in the report or in storage |
| P10 plain HTTP page (no Clipboard API) | Fallback copy succeeded |
| P11 every copy method failing | Message shown, report text box shown, text focused and fully selected, button usable again |
| P12 storage blocked | "Not saved" note; history kept in memory |
| P13 no stream path | State "Camera host reachable (no stream configured)", never "Connected" |
| P14 slow and refused camera (requests held by the browser test) | Six clicks produced **one** request, never two at once; timeout shown as "no answer within 2.50 s"; refused shown as a network failure; the header stayed "Disconnected"; one "Host unreachable" entry |

Result: all 15 scenarios completed with no page errors.

**Phase 1 regression.** The 11 Phase 1 scenarios (N1 to N11: healthy start, reset, stall plus manual reconnect, Frame-monitor recovery, missing CORS header, single-client firmware, rapid reconnect clicks, camera reboot with refused and with black-holed connections, tab switching and probe leaks, Settings toggle) were re-run unchanged against the Phase 2 code. No errors; same single-connection counts, same status sequences. Time stamps differed by a few hundred milliseconds between runs. Raw output: `browser-phase1-scenarios-rerun-on-phase2.json`.

**Mutation checks.** I put 20 deliberate bugs into the Phase 2 code one at a time (for example: no folding of repeats, overlapping requests allowed, stale results accepted, credentials kept in the report, no clipboard fallback). 18 were caught at once; 2 slipped through, I added tests for them, and then all 20 were caught (`docs/phase2-evidence/mutation-checks.txt`). This shows those particular bugs are noticed, not that none exist.

Screenshots (Diagnostics at both widths and the copy states): `docs/phase2-evidence/screenshots/`.

### 4.5 Mocked versus real

| Verified | How |
| --- | --- |
| Logic: event rules, folding, stale-result handling, report content, redaction, clipboard paths | Mocked unit tests |
| Real browser behaviour of the dashboard: requests made, clipboard, storage, layout | Chromium against a **mock** camera |
| Real ESP32-CAM behaviour, real Wi-Fi, request times on your network, your firmware's headers | **Not tested** |

---

## 5. Commands to run locally (deliverable 5)

From the `frontend` folder (Windows PowerShell or any shell):

```
npm install
npm run lint
npm test
npm run build
npm run dev          (opens on http://localhost:3000, use plain http)
```

Try it without hardware (Node 18.3 or newer):

```
node tools/mock-esp32-cam/mock-esp32-cam.mjs --cors
```

Settings: Base URL `http://localhost:8080`, Stream path `:8081/stream`, Snapshot `/capture`. Failure injection (open in a browser tab):

```
http://localhost:8082/__chaos?action=stall
http://localhost:8082/__chaos?action=resume
http://localhost:8082/__chaos?action=drop
http://localhost:8082/__chaos?action=reboot&ms=8000
http://localhost:8082/__chaos?action=reboot&ms=8000&mode=blackhole
http://localhost:8082/__stats
```

Useful options: `--single-client`, omit `--cors` to see the Frame-monitor error path.

---

## 6. Manual testing instructions (deliverable 6)

### 6.1 Against the mock camera (no hardware)

1. Start the mock camera with `--cors`, run `npm run dev`, enter the settings above.
2. **Summary and honesty.** Open Live Feed, wait 3 s, open Diagnostics. Expect "Disconnected - stream not open on this page" (by design), "First frame of the last connection", and "Cannot be measured" for Wi-Fi signal and packet loss under "What this page can and cannot measure".
3. **Response time.** Press Measure now: one value. Open `http://localhost:8082/__stats` and check that the control port's request count rose by exactly one. Tick "Measure periodically" with 5 s and watch the count rise about every 5 s; untick it and confirm it stops. Leave the Diagnostics tab and confirm it stops.
4. **Outage.** On Live Feed, open `http://localhost:8082/__chaos?action=reboot&ms=8000`. Expect Reconnecting, then Connected. In Diagnostics, History shows Stream lost, Host unreachable (once), Reconnecting, Reconnect failed with a repeat count, Recovered. The Host reachability row says the earlier check is outdated.
5. **Stall.** In Settings, Stream Recovery, tick Frame monitor, Save. Open `...__chaos?action=stall`. After about 5 s expect "Stream stalled" once, then recovery after `action=resume`. Untick Frame monitor and repeat: the header stays Connected and **no** stall is recorded (plain mode cannot see it). That is correct and is the limitation, not a bug.
6. **Interrupted recovery.** During a stall, switch to Diagnostics. "Did reconnection succeed?" should read "Unknown - recovery was interrupted".
7. **Timeout.** Stop the mock camera and press Measure now: "Failed" or "Timed out" with the 2.5 s limit, the header unchanged, one "Host unreachable" entry.
8. **Reload.** Reload the page: the history is still there with "earlier session" markers. Press Clear history, then confirm. Reload: empty.
9. **Copy Report.** Press Copy Report, paste into a text editor, read it. Check there is no password or token. Open the dashboard through a LAN address over plain HTTP (for example `http://<your PC's LAN IP>:3000`) and repeat: the fallback should still copy.
10. **Narrow screen.** Resize the window to about 390 px: nothing should scroll sideways.

### 6.2 With your real ESP32-CAM (not done by me)

Use the Phase 1 report, Section 6, for the freeze investigation, and add:

1. **Does the camera send the CORS header?** Chrome, F12, Network, click the `stream` request, look for `access-control-allow-origin`. With it, Frame monitor works and stalls are recorded. Without it, the summary says stall detection cannot be measured and why.
2. **Request time at rest.** Diagnostics, Measure now several times with the Live Feed closed. Note the typical value and whether a timeout ever occurs. This is an idle-camera figure.
3. **Request time while another viewer streams** (a second tab on the camera's stream URL). Compare. If the camera serves one request at a time on the probed port, the value can rise or time out; that is a camera limit, not proof the stream is down.
4. **Real outage.** Unplug the camera's power for 5 s while viewing, plug it back in. Expect Reconnecting then Recovered, with a plausible duration, and one Host unreachable entry.
5. **Report check.** Copy the report from a phone's browser and from a PC and compare the "Browser" and "Page" lines.
6. **Signal strength** can only come from the camera itself: print `WiFi.RSSI()` in the sketch's Serial Monitor and compare with the freeze times in the history.

---

## 7. Known limitations (deliverable 7)

1. **Plain video mode sees only the first frame of each connection.** A freeze that stays silent, or fixes itself, is invisible. "Connected" there means "a frame arrived on this connection".
2. **Frame monitor needs `Access-Control-Allow-Origin` from the camera.** Unchanged from Phase 1. Without it, the monitor cannot read the stream and the dashboard says so.
3. **No frame-content comparison.** The dashboard counts frames; a camera repeating one image would still look alive.
4. **Request time is not Wi-Fi latency.** It includes connection set-up and the camera's own processing. The browser hides the status code, so any HTTP answer counts as "host answers", including an error page.
5. **No Wi-Fi signal strength, no packet loss, no ping.** Web pages cannot read them. Nothing is estimated.
6. **Idle measurements.** The stream is open only on the Live Feed, so Measure now on the Diagnostics tab measures an idle camera. Probes triggered automatically when the stream fails run while the Live Feed is open, but their values are not shown as a latency trend.
7. **Same-port probes.** Many ESP32 firmwares serve one request at a time per port. When the probe goes to the same port as the video, it can be delayed or refused while a video is streaming. The card warns about this when it detects the same port. A failed measurement is never treated as proof that a working stream failed.
8. **Browser storage (`localStorage`).** The history is per browser profile and per web address (origin). It is not shared between browsers, devices or tabs (two open tabs overwrite each other's saved copy; the last write wins). It can be cleared by the user, by "clear site data", or by the browser; private windows may not keep it. It can be unavailable or full, in which case the history is kept in memory for the page's lifetime and the card says "Not saved". It holds at most 100 events (about 40 kB). Response-time samples are not saved across reloads. Event times come from the computer's clock; a wrong clock gives wrong times (request durations use a monotonic clock and are not affected).
9. **Background tabs are throttled by browsers**, so detection and retries can be late while the dashboard is hidden. Periodic measurement pauses while hidden.
10. **The report contains the camera address and the browser name.** Credentials, query strings and secret-looking text are removed; a secret hidden in a URL path cannot be recognised.
11. **The cause of the freezes you originally reported is still unproven.** Phase 2 helps you collect evidence (history, report); it cannot find a power, Wi-Fi or firmware cause from a web page.

---

## 8. Remaining issues (deliverable 8)

- `npm run build` has not been run by me (Section 4.3). It is the first thing to do after unzipping.
- Nothing was tested on real hardware, on Safari or Firefox, or on a real phone.
- Run-to-run timing in the browser scenarios varies by a few hundred milliseconds, so those results were read by hand for behaviour, not compared as numbers.
- The summary's "Cause" under "Did reconnection succeed?" reuses the Phase 1 wording ("connection lost" or "connect failed"). For a stall it is accurate but general; the specific message ("Stalled: no frame for 5.7 s") is in the error row and the history.
- The recent-requests bars draw a failure as a full-height red bar. The height of a failed bar means nothing (a failed request has no latency); it is marked in red and labelled "error" or "timeout".
- `tsconfig.test.json` (from Phase 1) uses an older module-resolution setting. A newer global TypeScript (6.x) reports a deprecation warning on it; the project's own TypeScript (5.x) does not. It is harmless today and unrelated to Phase 2.
- Phase 3 was not started and nothing for it was prepared.

---

## 9. Confirmation that existing functionality was preserved (deliverable 9)

Evidence: all 118 Phase 1 unit tests present and passing (three Phase 1 test files byte-identical); the 11 Phase 1 browser scenarios re-run with the same results; `package.json`, the lock file, the camera configuration code, the mock camera, and the files below are **unchanged** from Phase 1.

Unchanged: `CameraView`, `CameraToolbar`, `CameraStatus`, `ConnectionIndicator`, `Header`, `Sidebar`, `SettingsModal` (including Stream Recovery settings), `SnapshotGallery`, `NetworkGuideView`, `App`, `main`, `index.css`, `cameraConfig`, `cameraService`, `streamTransports`, `mjpegParser`, `index.html`, `vite.config.ts`.

Changed but behaviour-preserving for existing screens (listed so nothing is a surprise):
- Stream Health card: same rows and the same Reconnect button; rows stack on narrow screens; the verbose event log is now inside a collapsed section; the host row says "request took N ms" and marks an old failed check as outdated; the recovery row mentions an interrupted recovery.
- Diagnostics tab: three new cards and one explanatory paragraph added above the existing probe tests, power advisory and console log (kept).
- Live Feed: the one-line camera-reachability note shown under the status text (and in the failure panel) no longer warns "check power, Wi-Fi" when a video frame arrived after the failed check.
- The reachability probe now also reports the failure kind and uses a monotonic clock; its result shape is a superset of Phase 1's.

Not changed: camera IP, stream and snapshot paths, snapshot capture, fullscreen, the retry policy defaults, the Frame monitor.

---

## 10. Project ZIP (deliverable 10)

`rc-surveillance-robot-phase2.zip`: the complete project (same layout as the Phase 1 ZIP), without `node_modules`, `dist` and `.test-build`. Run `npm install` first.

---

## Appendix A. What each state means in the Diagnostics Summary

| You see | It means | It does not mean |
| --- | --- | --- |
| Camera host reachable (no stream configured) | The host answered a request and no stream path is set | That any video exists |
| Stream connected (first frame, plain mode) | A decodable frame arrived on this connection | That video is still advancing |
| Stream connected (Frame monitor) | Frames are arriving | That the picture is changing |
| Stalled - reconnecting | Frame monitor: no frame for 5 s while the connection stayed open | Why (power, Wi-Fi, another viewer) |
| Reconnecting | An automatic retry is waiting or running | That the camera is down |
| Disconnected - stream not open on this page | The Live Feed is not on screen, or snapshot mode | A fault |
| Error | Retries are used up or are off | A diagnosis of the cause |
| Cannot be measured | The browser cannot provide it (or the setup blocks it), with the reason | A good or a bad result |
| Not measured yet | It can be measured but nothing has measured it | A good or a bad result |

## Appendix B. Reachability request

`fetch(<camera base address>, { mode: 'no-cors', cache: 'no-store' })`, aborted as soon as the response headers arrive, limit 2.5 s, one at a time. Opaque response: the status code cannot be read. Result kinds: answered, timed out, network error (refused, unreachable or blocked), cancelled (not recorded). Timed with `performance.now()`.

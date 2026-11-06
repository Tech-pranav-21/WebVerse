# RC Surveillance Robot — Frontend Dashboard

A dedicated, lightweight surveillance dashboard engineered in React, TypeScript, Vite, and Tailwind CSS for monitoring an RC Robot equipped with an ESP32-CAM (OV2640) video unit.

> **Part of WebVerse.** This app lives in the WebVerse repository as the `RC Surveillance Robot` project. The two ways to run it (the hosted public demo, and Local Hardware Mode with a real ESP32-CAM), how to deploy the demo, and the complete environment-variable table are in the [project README](../README.md).

> **Surveillance-Only Project Scope:** This application is strictly dedicated to camera feed monitoring, single-frame snapshots, connection diagnostics, and network configuration. In accordance with strict project constraints, vehicle motor controls, remote steering, Bluetooth commands, Arduino hardware controls, backend services, databases, authentication, and cloud video recording are deliberately excluded.

---

## 1. Project Purpose

The purpose of this frontend dashboard is to provide an operator console for observing surveillance video feeds from an RC robot. It allows an operator on the same local network to:
- Monitor continuous video streams (e.g. MJPEG) once the physical camera endpoint route is confirmed.
- View single-frame capture snapshots and maintain a session still gallery.
- Run honest, browser-compatible connection diagnostics to test camera reachability.
- Modify camera base IP addresses and endpoint paths at runtime without code rebuilds.
- Troubleshoot local Wi-Fi, CORS, and HTTP/HTTPS mixed-content security restrictions.

---

## 2. Technology Stack

- **UI Framework:** React 19 (`react`, `react-dom`)
- **Language:** TypeScript 5.8
- **Build Tool & Dev Server:** Vite 8 (`vite`, `@vitejs/plugin-react`)
- **Styling:** Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`)
- **Icons:** Lucide React (`lucide-react`)
- **Architecture:** Client-side Single Page Application (SPA) with zero backend dependency.

---

## 3. Prerequisites

Before running or building the dashboard, verify the following:
- **Node.js:** Version 20.19.0 or higher (Node 22+ recommended).
- **Package Manager:** `npm` (v9+) or `pnpm` / `yarn`.
- **Web Browser:** Modern evergreen browser (Google Chrome, Microsoft Edge, Mozilla Firefox, or Safari).
- **Local Network:** The computer running the browser and the ESP32-CAM robot must be connected to the **same local Wi-Fi network** (or the computer must connect directly to the ESP32 SoftAP Wi-Fi).

---

## 4. Entering the Frontend Directory

All frontend application source files, configuration files, and build scripts are contained in the `frontend` folder.

Before running any installation or development commands, navigate into the `frontend` directory:

```bash
cd frontend
```

---

## 5. Installing Dependencies

From inside the `frontend` directory, install all required dependencies:

```bash
npm install
```

---

## 6. Configuring Camera Environment Variables

All camera configuration is centralized and can be customized via client environment variables or updated dynamically on the Settings page.

Inside the `frontend` directory, copy the example environment file:

```bash
# On Linux / macOS:
cp .env.example .env

# On Windows PowerShell:
Copy-Item .env.example .env
```

### Environment Variables Reference

```ini
# Base URL / IP address where your ESP32-CAM web server is accessible.
# Example: "http://192.168.1.100" or "http://192.168.4.1" (ESP32 AP mode)
VITE_CAMERA_BASE_URL="http://192.168.1.100"

# Confirmed continuous video stream endpoint path / port.
# Leave empty ("") by default until your physical robot's stream route is confirmed!
# Common ESP32-CAM routes once verified:
# - Standard Arduino CameraWebServer sketch: ":81/stream"
# - Single-port web server: "/stream"
# - Direct MJPEG route: "/mjpeg"
VITE_CAMERA_STREAM_PATH=""

# Confirmed single-frame snapshot endpoint path.
# Common ESP32-CAM default for OV2640 captures: "/capture"
VITE_CAMERA_SNAPSHOT_PATH="/capture"
```

> **Unconfirmed Endpoints Notice:** The live stream route is left empty (`""`) by default. The dashboard renders a clear placeholder until the actual route is confirmed on your robot's firmware and entered in Settings.

---

## 7. Running the Development Server

From inside the `frontend` directory, start the Vite development server:

```bash
npm run dev
```

The application will start on:
```
http://localhost:3000
```

> **CRITICAL BROWSER REQUIREMENT:** Always open the dashboard using **`http://localhost:3000`** (plain HTTP) and **NOT** HTTPS. See Section 10 for browser mixed-content restrictions.

---

## 8. Running the Production Build

To build the optimized client bundle for production:

```bash
npm run build
```

This compiles TypeScript, bundles assets, and outputs production files directly into `frontend/dist/`.

To run type checks (application and tests):

```bash
npm run lint
```

To run the automated tests (no extra packages needed; they use Node's built-in test runner):

```bash
npm test
```

See **Section 11** for what the tests do and do not prove.

---

## 9. Starting the Production Preview

To test the generated production build locally:

```bash
npm run preview
```

By default, Vite preview listens on:
```
http://localhost:4173
```

---

## 10. Camera Streaming Limitations & Hardware Guidelines

### A. Physical Camera Hardware Requirements
Before live video can be received from the ESP32-CAM:
1. **Dedicated Power Rail:** The ESP32-CAM with OV2640 sensor requires a steady **5V 2A** power supply. Powering from weak microcontroller pins or unshielded motor lines causes brownouts and Wi-Fi resets when the radio transmits.
2. **Ribbon Cable:** The OV2640 camera ribbon cable must be securely seated in the board's connector with the clamp locked.
3. **Firmware Model Definition:** In the Arduino sketch code, ensure `#define CAMERA_MODEL_AI_THINKER` is active.
4. **Serial Monitor Verification:** Confirm the assigned IP address and whether the video server is on port 80 or 81 via Arduino Serial Monitor (115200 baud).

### B. 2.4 GHz Local Wi-Fi Network
- The ESP32-CAM only supports **2.4 GHz Wi-Fi** networks (it cannot connect to 5 GHz Wi-Fi).
- The client computer and ESP32-CAM must be on the same subnet. Router "Client Isolation" or "Guest Mode" must be disabled so local IP packets can route between devices.

### C. Browser Mixed-Content Restriction (HTTPS vs HTTP)
- Modern web browsers enforce **Mixed Content Blocking**: If this dashboard is served via an `https://` URL (e.g. cloud hosting or remote tunneling), the browser strictly blocks unencrypted HTTP traffic to private local IPs like `http://192.168.1.100`.
- **Solution:** Always run the dashboard locally over plain **HTTP** (`http://localhost:3000` or `http://localhost:4173`).

### D. Cross-Origin Resource Sharing (CORS) & Canvas Export
- **Display needs no CORS.** An HTML `<img>` shows a cross-origin MJPEG stream whether or not the camera sends `Access-Control-Allow-Origin`.
- **Reading a frame does.** The browser refuses to export pixels from a cross-origin `<img>` unless it was requested with CORS *and* the camera answers with `Access-Control-Allow-Origin`. Without both, "Capture Still" cannot work and the dashboard says so; it never creates an empty or placeholder image. Details and the fix: section 14.
- Check your camera in browser DevTools (Network tab, response headers of the stream request).

---

## 11. Stream Status, Automatic Recovery and Diagnostics

**How the live feed works.** The Dashboard shows the camera's MJPEG stream (`multipart/x-mixed-replace`) in an `<img>` element. A browser raises exactly one `load` event for such an image (when the first frame arrives) and nothing afterwards, so a plain `<img>` cannot tell the page that the stream later stalled, was reset, or delivered a corrupt frame.

**One owner for the connection.** `src/services/streamConnectionService.ts` (`StreamConnection`) is the only code that opens, closes and retries the stream, and the only source of the connection status shown in the header, the status card, the live view and Diagnostics. The React hook `src/hooks/useStreamConnection.ts` binds it to the UI.

**Status meanings**

| Status | Meaning |
| --- | --- |
| Connecting | The stream was opened and no frame has arrived yet. |
| Connected | A frame arrived on the current connection. In plain video mode that is all that can be known; with *Frame monitor* it means frames are still arriving. |
| Reconnecting | The stream was lost or failed to start and an automatic retry is waiting or in progress. |
| Error | Automatic retries are used up (or turned off), or the camera host cannot be reached. Use *Reconnect*. |
| Disconnected | No connection is open on purpose (another tab is shown, snapshot mode, or the browser blocks it). |
| Host reachable | Only when no stream path is configured: the camera host answers. This is never shown as Connected. |

Camera reachability (does the host answer?) and stream health (are frames flowing?) are tracked separately and shown separately in Diagnostics.

**Automatic recovery (Settings, Stream Recovery).**
- *Reconnect automatically* (default on): up to 6 retries. After a working stream drops, the first retry is quick (at most 1 s); after that, and when the stream never connected, the delay starts at the *base retry delay* (default 5 s) and doubles each time, capped at 60 s. A connection must stay up for 10 s before the retry counter resets.
- *Reconnect* (header, toolbar, Diagnostics) is always available. It closes the current connection first and opens exactly one new one; rapid repeated clicks collapse into one attempt. Retries after the first use a unique `_rc` query parameter so the browser cannot re-attach to the old request.
- The connection is open only while the Dashboard or AI Detection page is on screen in stream mode. Leaving it closed on the Diagnostics tab keeps probes from competing with the stream for a camera that may serve only one viewer.
- *Frame monitor* (experimental, default off): reads the stream with `fetch()` so every frame is visible. This allows detecting a stream that stays open but stops sending frames (5 s without a frame), and it adds frame rate and "longest freeze" figures to the live view and Diagnostics. **It only works if the camera sends `Access-Control-Allow-Origin`.** Without that header the stream shows an error explaining this; turn the option off to go back to the plain video element.

**Diagnostics, Stream Health card.** Status, what evidence the status rests on, last confirmed frame time, reconnect attempts, recovery result, last error, camera-host reachability and an event log. Nothing there is estimated: no Wi-Fi signal or packet-loss figures are shown because a browser cannot measure them.

## 12. Tests and the Mock Camera

```bash
npm test             # compile the tests with tsc, run them with node --test
npm run lint         # tsc --noEmit for the app and for the tests
```

Most tests in `tests/` are **mocked**: they use a fake clock and fake stream/transport objects (no real network, camera or browser). They check the logic of reconnecting, status transitions, retry limits, duplicate prevention, stale results and cleanup. They cannot show how a real ESP32-CAM, your Wi-Fi or your power supply behave.

The pose and activity tests (`poseContract`, `poseClient`, `activityPresentation`, `poseComponents`) are different: the responses they feed in are **real recorded answers of the Python pose service** (`tests/fixtures/*.json`, produced by the real YOLOv8 model — see section 18), and the components are really rendered to HTML. Only the network itself is faked.

`tools/mock-esp32-cam/mock-esp32-cam.mjs` is a dependency-free **mock camera** that imitates the stock firmware's wire format and can stall, reset, reboot, corrupt frames, serve one client at a time, and send or omit CORS headers on demand (see the header of that file). Point the dashboard at it to see how the browser and dashboard react:

```bash
node tools/mock-esp32-cam/mock-esp32-cam.mjs --cors
# Settings: Base URL http://localhost:8080, Stream path :8081/stream, Snapshot /capture
# Failure injection (any browser tab): http://localhost:8082/__chaos?action=stall  (resume, drop, reboot&ms=8000, ...)
```

Real-camera verification steps are in `../docs/hardware-guide.md`.

## 13. Diagnostics Center (Phase 2)

The **Diagnostics** page opens with an overview (one line per check, *Run Full Test*, *View Detailed Logs*, *Copy Report*). *View Detailed Logs* shows, from the top: a **Diagnostics Summary**, the Phase 1 **Stream Health** card, a **Camera Response Time** card and a **Connection History** card. Full details, tests and limits: `../docs/architecture.md`.

**Diagnostics Summary.** Stream state, camera reachability, last confirmed frame, most recent error, reconnection attempts, whether reconnection succeeded and the last successful recovery. Every row is marked *Measured*, *Not measured yet* or *Cannot be measured*. A host that answers is never shown as "video is flowing", and a failed one-off check is never shown as "the stream failed". **Copy Report** copies a plain-text report for troubleshooting (camera address with credentials and query strings removed, state, reachability, events, attempts, last error, browser, limitations; no passwords, tokens or images). If the browser blocks the clipboard it falls back to a selected text box.

**Connection History.** Typed events (connecting, first frame, stream lost, stalled, reconnecting, recovered, reconnect failed, host unreachable / reachable, cause unknown). Repeats within one continuous failure are counted instead of listed again, and results that arrive after the situation changed are dropped or marked outdated. It is saved in `localStorage` (key `rc_surveillance_connection_history_v1`, newest 100 events, about 40 kB). **Limits of browser storage:** per browser and per web address; not shared between browsers, devices or tabs; clearable by the user or the browser; may be unavailable in private windows or when full (then it is kept in memory and the card says so). **Clear history** asks for a second click.

**Camera Response Time.** *Measure now* sends one small browser request to the camera's web server and times it until the response headers arrive (limit 2.5 s). It is **not Wi-Fi latency and not a ping**: it includes connection set-up and the camera's own processing time, and the browser hides the status code. *Measure periodically* is **off by default**, never overlaps requests, pauses while the tab is hidden and stops when you leave the tab. Wi-Fi signal strength and packet loss cannot be read by a web page and are not shown.

**What the page can and cannot see.** The stream is open only while the Dashboard or AI Detection page is on screen, so the Diagnostics page reads "Disconnected - stream not open on this page" by design. In plain video mode only the first frame of each connection is observable; stalls are detected only with *Frame monitor*, which needs the camera to send `Access-Control-Allow-Origin`. The dashboard does not compare picture content.

**Tests.** `npm test` runs mocked unit and integration tests; they do not involve a camera. `../docs/images/` holds the browser runs against the mock camera and the mutation checks.

---

## 14. Smart Snapshot (Phase 3A)

Capture Still, Snapshot mode and the Snapshot Gallery now work **without the camera's `/capture` endpoint** (many ESP32-CAM firmwares have only `/` and `/stream`). The dashboard never requests `/capture`; the Settings field "Single Snapshot Path" is only shown in the status card and used by the older diagnostics probe. Evidence, limits and what is still unverified on real hardware: `../docs/architecture.md`.

**Three different things.** *Captured*: a real frame was read from the video. *Saved*: it is in the gallery (and in this browser's IndexedDB). *Downloaded*: a `.jpg` file was handed to the browser. The dashboard reports each one separately; a gallery save is never described as a download. A web page cannot see whether you finished the browser's save dialog, so it only ever says the download *started*.

**How capture works.**
- *Live Stream mode:* Capture Still draws the frame the video is showing right now onto a canvas and encodes it as a JPEG (quality 0.92). No request is sent to the camera. It only runs while the stream is *Connected*, so an old frozen picture is not saved as "now".
- *Snapshot mode:* there is no live connection, so *Fetch Frame Now*, *Auto-Refresh* and *Capture Still* open the stream in a temporary image, take its **first frame** and close the connection again (a frame can take several seconds on a slow link; 15 s limit). Fetching only previews a frame; Capture Still also saves it. The next auto-refresh starts only after the previous frame finished, and the **first failure turns Auto-Refresh off**, so a camera that is not answering is not polled. Only one capture runs at a time, so a camera that serves one viewer is never asked for two connections.
- If the browser cannot produce a valid JPEG, nothing is created and an error explains why.

**Browser security (CORS).**
- A plain cross-origin `<img>` always "taints" the canvas: the browser throws `SecurityError` and the dashboard reports it. This **cannot be fixed by frontend code alone**.
- With **Settings > Snapshot Capture > Allow snapshot capture from the live stream** the video is requested with CORS (`<img crossorigin>`). The camera must then send `Access-Control-Allow-Origin` on its `/stream` response. Verified in Chromium 152 against the mock camera, and once on 2026-10-21 against the real camera in a standalone browser test (`Access-Control-Allow-Origin: *` was sufficient; the full dashboard has not yet been run against the real camera). The first failed Capture Still offers this setting as a button.
- **Trade-off:** a camera that does *not* send the header makes the browser refuse the stream outright, which is why the option is off by default. Turn it off again if the live picture disappears after enabling it.
- *Frame monitor* mode already allows capture (its frames are same-origin blobs) and needs the same header. Snapshot mode needs the header too, but only for the one frame it grabs.
- Other browsers (Firefox, Safari) were not tested.

**Where snapshots are stored.** In this browser's **IndexedDB** (database `rc_surveillance_snapshots`) as real JPEG data, on this computer only: no backend, no sync, not shared between browsers or profiles. They **survive a page refresh and a browser restart**. The newest 100 are kept; clearing the site's data (or the browser evicting it) removes them. In a private window, with blocked site data, or when storage is full, a captured image is kept for the session only, labelled **Session only**, and the message says to download it. Deleting a snapshot (or Clear Gallery, which asks twice) deletes the stored image data too. Snapshots saved by older versions lived in `sessionStorage` and are not migrated.

**Downloading.** *Download* in the gallery (or in the enlarged view) creates the file from the stored JPEG, named `esp32-cam-YYYY-MM-DD_HH-mm-ss.jpg` in your local time. Damaged or empty data is refused with an error. The temporary `blob:` link is released 10 s later.

**Troubleshooting a failed capture.**

| Message says | Meaning and next step |
| --- | --- |
| "will not let this page read the live picture" | The video is a plain cross-origin image. Click *Allow snapshot capture* (needs the camera's CORS header). |
| "still cannot be read although snapshot capture is on" | Press *Reconnect* so the stream reloads with CORS. If it persists, the camera does not send `Access-Control-Allow-Origin` on `/stream`: only the camera firmware (or serving the dashboard from the camera's own address) can fix that. |
| Stream disappears after enabling capture | The camera sends no CORS header. Turn *Allow snapshot capture* off. |
| "The live feed is not connected" | The picture may be old. Wait for *Connected* or press *Reconnect*. |
| "did not deliver a frame" / "No frame arrived" | Camera unreachable, busy with another viewer, no CORS header, or slower than 15 s. Check Diagnostics. |
| "could not be stored" | Browser storage is full or blocked. The image is still in the gallery for this session: download it. |

**Remaining camera limits.** The firmware has no `/capture`, `/status` or port 81, so there is no way to request a full-resolution or different-size still: a snapshot is exactly the size of the stream frame. Test Connection in Settings and the `/capture` row in Diagnostics still probe `/capture` and will show it failing on such cameras.

**Tests.** At the end of Phase 3A `npm test` ran 373 mocked tests (291 before, 82 new); the current total is in section 15. They use a fake canvas, fake image and fake IndexedDB, so they cannot show real browser or camera behaviour; the real-browser checks are listed in the Phase 3A report. Camera-free testing: run the mock camera with `--cors` (section 12).

## 15. Motion Detection (Phase 3B)

A **Motion Detection** card is on the AI Detection page, next to a small live picture. It compares consecutive frames of the stream that is already on screen, entirely in this browser: no extra connection to the camera, no `/capture`, nothing sent anywhere. Evidence, thresholds, limits and what is still unverified on real hardware: `../docs/architecture.md`.

**Start and stop.** The ON/OFF switch in the card header begins and ends detection. Switching it on while it runs does nothing. The switch reflects the state and cannot be turned on in Snapshot display mode (there is no live picture to read).

| Status | Meaning |
| --- | --- |
| Off | Not running. |
| Starting | Running, but two different frames have not been compared yet. **Never shown as Active before that.** |
| Active | Frames are being compared. |
| Motion detected | An alert fired in the last 4 s. |
| Paused | Suspended on purpose: the browser tab is hidden, or Snapshot mode is showing. It resumes by itself. |
| Camera disconnected | The stream is not connected. Nothing is compared meanwhile; it resumes by itself when the stream is back. |
| Frame access blocked | The browser will not let the page read the picture's pixels (see CORS below). No events are created. |
| Error | The picture could not be read 10 checks in a row, or the canvas is unavailable. Checking stops. |

**How it works.** Every check interval (default 1 s) the picture is shrunk to 64×48 grayscale (3,072 pixels). If it is the very same picture as last time it is skipped, not re-processed. Otherwise it is compared with the previous picture:
1. A uniform brightness change (auto exposure, a lamp) is removed by subtracting the *median* brightness shift.
2. A pixel counts as changed if it differs by **more than** the noise tolerance.
3. The changed share of the watched area must reach the minimum area, for the set number of consecutive comparisons (default 2), and the cooldown must be over. Then one alert is recorded.

**Sensitivity.** The defaults are conservative and were **not tuned on the real camera**.

| Level | Noise tolerance (of 255) | Alert needs at least | Roughly |
| --- | --- | --- | --- |
| Low | 40 | 8 % of the area changed | large, clear movement |
| Medium (default) | 28 | 4 % | a person-sized movement a few metres away |
| High | 18 | 1.5 % | small movement; more false alerts |

Other settings: *Cooldown between alerts* (default 15 s), and under *Advanced*: check interval (0.25 to 5 s), confirm over 1 to 3 frames, watched area (whole picture, centre, left, right, top or bottom half) and an explicit minimum changed area (empty = the preset; anything below 0.5 % is raised to 0.5 %, because smaller changes are indistinguishable from noise). Settings are saved in this browser.

**Lifecycle.**
- Detection runs **only while the AI Detection page is showing in Live Stream mode**, because that is the only time it has a stream picture to read. Leaving the AI Detection page stops it (timer, canvas and listeners are released) and you return to Off: it never restarts by itself.
- Stream drops, Snapshot mode, or a hidden tab: checking stops and the previous picture is thrown away. When the stream is connected / visible again it **resumes by itself with a fresh baseline**, so a picture from before the gap is never compared with one after it. The same applies if the camera freezes for 15 s and then sends frames again.
- Only one timer ever exists (a chained `setTimeout`, not an interval).

**Motion snapshots (optional).** "Capture snapshot when motion is detected" saves one real frame per alert through the Phase 3A Smart Snapshot service (same gallery and storage, no banner). Each event shows whether it was saved, captured but not stored, failed (with the reason) or skipped; never during the cooldown. Detection works without it. It needs the same pixel access as detection.

**Event history.** The newest 100 events (time, measured change, thresholds, sensitivity, watched area, confirmation, snapshot status) are kept in this browser's `localStorage` (key `rc_surveillance_motion_history_v1`, at most about 40 kB; pictures live in the gallery, not here). If storage is blocked or full the events stay in memory and the card says so. Per browser and web address, not synced, clearable by the browser. *Clear history* asks twice and the question expires after 6 s.

**Browser security (CORS).** A plain cross-origin `<img>` can be shown but its pixels can never be read, so detection reports Frame access blocked. Fix: Settings > *Allow snapshot capture* (the card offers a button). Frame monitor should also work, because it shows same-origin frames, but that combination was not tried. The camera must send `Access-Control-Allow-Origin` on `/stream`; if it does not, only its firmware can fix that. After you enable it the stream reconnects and detection resumes by itself. Chromium only was tested.

**False alerts and misses.** Lighting changes, shadows, camera vibration or movement, the camera's automatic exposure, and a noisy picture can trigger alerts. Very slow movement is missed (only consecutive frames are compared), and with a slow camera an alert can take several seconds. This is not a security-grade detector.

**Troubleshooting.**

| You see | Do this |
| --- | --- |
| Frame access blocked | Click *Allow snapshot capture*; if already on, press Reconnect; if still blocked, the camera lacks the CORS header. |
| Stuck on Starting | Waiting for two different frames. A camera that sends one frame every few seconds takes a while; "repeated skipped" rising means the same picture keeps coming. |
| "No new camera picture for N s" | The camera is frozen, or the scene is perfectly still. Check Diagnostics. |
| Paused | Tab hidden or Snapshot mode: return to the Live Stream view. |
| Too many alerts | Lower the sensitivity, raise the minimum area or confirmation, lengthen the cooldown, or watch a smaller area. |
| Nothing is detected | Raise the sensitivity, or lower the minimum area. |
| Events do not survive a refresh | The card says when browser storage is blocked or full. |

**Verify on the real camera (not done yet).** (1) Open AI Detection, wait for *Connected*, switch Motion Detection on: expect Frame access blocked unless *Allow snapshot capture* is already on. (2) Click that button; after the stream reconnects it should go Starting, then Active. (3) Hold still for a minute: no alerts (watch "changed %" in the readout, it shows the noise floor of your camera). (4) Walk through the picture: Motion detected once, then nothing during the cooldown. (5) Turn on motion snapshots and repeat: the event shows "Snapshot saved" and the gallery has the picture. (6) Adjust the sensitivity from the noise floor you saw in step 3.

**Tests.** At the end of Phase 3B `npm test` ran 489 mocked tests (373 before, 116 new) with generated frames, a fake clock, a scripted frame sampler and a fake canvas. They cannot show how a real camera's picture behaves. The current total is in section 16.

## 16. Multi-provider AI Recognition

The **AI Recognition** card (under Motion Detection on the AI Detection page) sends one camera frame to the selected provider — **Groq**, **Google Gemini**, or **OpenAI** — to describe people, animals, vehicles and other objects. Evidence, limits, costs and what is still unverified: `../docs/architecture.md`.

> **Your camera image leaves this computer.** Each analysis sends one JPEG through this project's own backend to the selected external AI provider. Nothing is sent until you switch the feature on **and** press Analyze (or also enable automatic analysis after acknowledging the disclosure). Switching the feature off stops all uploads.

**What it is, and is not.** Groq is the inference platform, not a detector. The model is a *vision-language model*: it writes a description and a list of things it says it sees. There are **no bounding boxes, no class IDs and no confidence figures** (Groq's chat API returns none, and a number a language model writes about itself is not a measured probability), so none are shown. Each object carries a category (person, animal, vehicle, other or unknown) and a "not sure" flag that the model itself sets. It can be wrong. Its accuracy on your camera's small, low-resolution frames has **not been measured**.

**Model (verified in Groq's documentation on 2026-10-21).** `qwen/qwen3.8-27b`: text and image in, text out; 131,072-token context; 16,384 max output tokens; up to 3 images and 20 MB per request; each image counts as 2,048 input tokens; supports JSON Schema structured output (strict) and `reasoning_effort: none`. Groq labels it **Preview**: "for evaluation only", it "may be discontinued at short notice", so it can change or disappear. The Llama 4 Scout/Maverick vision models are shut down, so there is no other documented Groq vision model to fall back on (`meta-models/muse-spark-open` is a limited preview that requires contacting Groq). Set another model with `GROQ_MODEL` if Groq changes this. If no suitable vision model remains, the feature stops working; it does not switch to another provider.

**Architecture.** Browser, then `/api/ai/*` (the Vite dev/preview server proxies it, so the page and the API share an origin), then a small Node backend in `server/` (no new packages: Node's own `http` and `fetch`, compiled by the TypeScript already installed), then Groq. The **Groq API key exists only in the backend's environment**: it is never in the web page, never returned by any endpoint, never logged and never stored in the browser. Only variables starting with `VITE_` reach the browser, and the key's variable deliberately does not.

**Setup.**
1. Create a Groq API key at https://console.groq.com/keys.
2. Copy `.env.example` to `.env` (git-ignored), set the selected provider's key (`GROQ_API_KEY`, `GEMINI_API_KEY`, or `OPENAI_API_KEY`), and optionally set `ACTIVE_AI_PROVIDER`. Never commit a key or rename it with a `VITE_` prefix.
3. Run the backend and the dashboard in two terminals:

```bash
npm run server     # builds server/ and starts the AI backend on http://127.0.0.1:8787
npm run dev        # the dashboard (proxies /api to the backend)
```

For the production build use `npm run build`, then `npm run preview` (it proxies `/api` too) with `npm run server` running. Without a key the backend runs but answers "not configured", and the card says so.

| Variable (server side only) | Default | Meaning |
| --- | --- | --- |
| `GROQ_API_KEY` | empty | Your key. Empty = AI recognition unavailable. |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Vision model id. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | empty / `gemini-2.5-flash` | Google Gemini credential and vision model. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | empty / `gpt-4o-mini` | OpenAI credential and vision model. |
| `ACTIVE_AI_PROVIDER` | `groq` | Default active provider: `groq`, `gemini`, or `openai`. |
| `AI_SERVER_PORT` / `AI_SERVER_HOST` | `8787` / `127.0.0.1` | Where the backend listens. Keep it on this machine. |
| `AI_RATE_PER_MINUTE` / `AI_MAX_PER_DAY` | `6` / `100` | Cap on requests forwarded to Groq (rolling windows, all clients together). |
| `AI_MAX_IMAGE_BYTES` | `1500000` | Largest JPEG accepted (frames are 20 to 60 kB). |
| `AI_REQUEST_TIMEOUT_MS` / `AI_MAX_RETRIES` | `20000` / `1` | Timeout, and retries for transient errors only. |
| `AI_ALLOWED_ORIGINS` | empty | Extra page origins allowed. Pages on localhost / 127.0.0.1 / [::1] always are. If you open the dashboard by its LAN address, add that origin here. |

**Manual recognition.** Tick *Enable external AI processing (Groq)*, wait for Ready, show the live picture in Live Stream mode, and press **Analyze Current Frame**. One frame is read from the picture on screen (no extra camera connection), sent, and the result appears: a summary, each object with its category, whether it matches your filters, the time, model, duration and tokens used. The card also lists the last 50 analyses.

**Automatic recognition on motion.** Start Motion Detection (section 15), then in the AI card tick the acknowledgement ("I understand that... a still image from my camera is sent to Groq...") and *Analyze automatically when motion is detected*. Each Motion Detection alert may then trigger one analysis: never more than one at a time, never inside the *cooldown* (10 s to 10 min, default 60 s), never twice for the same alert, and not at all while paused (backend down, picture unreadable, rate-limited). Motion Detection's own algorithm is untouched; the AI card only listens to its alerts. If Motion Detection is not running there is nothing to trigger automatic analysis, but manual analysis still works.

**Filters and snapshots.** *Which results count as an event*: People, Animals, Vehicles (on by default) and Other objects (off). An event needs a **confirmed** object in a selected category; objects the model marks unsure, or whose category is unknown, are shown but never count. Changing the filters applies to the next result without a restart. *Keep a snapshot when a result matches* (off by default) saves the analysed frame to the Snapshot Gallery through Smart Snapshot (no banner). If Motion Detection is already saving a snapshot for the same alert, no second one is taken.

**Limits and cost (from Groq's documentation, plan unknown; check your account's limits page).** The table below is what Groq lists for this model; yours may differ.

| | Listed value | Consequence |
| --- | --- | --- |
| Requests | 30 per minute, 1,000 per day | rarely the limit |
| Tokens | **8,000 per minute, 200,000 per day** | the real limit |
| One picture | about 2,400 tokens in (2,048 for the image plus the instructions), about 120 out | **about 2 to 3 analyses per minute and roughly 70 per day** (my estimate from these figures; real token counts depend on Groq) |
| Price | $0.80 / $4.00 per million input / output tokens | about $0.0025 per analysis (an estimate from these figures, about $0.25 per 100) |

That is why automatic mode is off by default, the cooldown starts at 60 s, only one frame is ever sent per trigger, and a rate-limit or quota answer pauses the card for the time Groq names (or 30 s / 10 min if it names none). The backend retries only a short rate limit (5 s or less), a 5xx or a network error, once; a timeout is never retried.

**Privacy.** Groq's documentation says it does not retain inference data by default, but may temporarily log inputs and outputs (up to 30 days) to troubleshoot reliability or investigate abuse unless Zero Data Retention is enabled in your Groq account's Data Controls; it does not specifically address images. This project adds no analytics and sends images nowhere else. The browser stores only settings and the model's text (never the picture, never a secret); pictures you keep live in the Snapshot Gallery. The backend logs one line per request (method, path, status, time), never a body, an image or a key.

**Security notes.** The backend listens on 127.0.0.1, accepts only JPEGs within the size limit, only browser pages from this machine (or `AI_ALLOWED_ORIGINS`), and forwards at most `AI_RATE_PER_MINUTE` / `AI_MAX_PER_DAY` requests to Groq. `npm run dev` listens on all network interfaces, so anyone on your network who can reach port 3000 can use the proxy from a non-browser client until those caps are hit; run it on a network you trust. There is no login: this project has none, and none was added.

**Troubleshooting.**

| You see | Do this |
| --- | --- |
| Backend problem, "not reachable" | Start the backend: `npm run server`, then press *Check again*. |
| "has no Groq key configured" | Set `GROQ_API_KEY` in `.env` and restart the backend. |
| "Groq rejected the API key" | The key is wrong or revoked. |
| "Groq does not know this model" | The preview model was renamed or withdrawn: set `GROQ_MODEL`. |
| "rate limiting" or "daily quota" | Wait (the card counts down) or reduce automatic analysis (longer cooldown). |
| "answer could not be understood" | The model's reply was not valid. Try again. |
| "will not let this page read the live picture" | Same CORS requirement as Smart Snapshot: use *Allow snapshot capture*. |
| 403 "origin not allowed" | You opened the dashboard by a LAN address: add it to `AI_ALLOWED_ORIGINS`. |

**Tests.** `npm test` runs 674 tests (489 before, 185 new). **All of them use mocks**: a fake Groq `fetch`, a scripted backend client, fake storage and a fake clock; **no test contacts Groq or a camera**. The end-to-end browser checks used `tools/mock-groq/mock-groq.mjs`, a mock Groq that returns canned answers and never looks at the picture. **No real Groq inference has been run**, so real recognition quality is unverified.

**Verify with your real camera and key (not done yet).** (1) Put your key in `.env`, run `npm run server` and `npm run dev`, open the dashboard. (2) The card should show Ready and `qwen/qwen3.8-27b`. (3) Open the live feed (with *Allow snapshot capture* on), switch the AI on, point the camera at a person and press **Analyze Current Frame**: read the result and compare it with the picture. (4) Try an animal, a vehicle and an empty scene. Note wrong or missing objects: the frames are small. (5) Turn on Motion Detection, then automatic analysis, walk through the picture, and check one analysis per cooldown and that your Groq console usage matches. (6) Open https://console.groq.com to check your token usage against the limits above.

---

## 17. Dashboard Layout, Event History and Settings (UI redesign)

A presentation-first redesign that follows a reference mock-up (dark navy console, blue and cyan accents). The camera, motion, snapshot, diagnostics and Groq logic (`src/hooks`, `server/` and the services) was not changed, and `npm test` still runs the same 674 tests. The only edits outside components are the text colour of one line in `src/services/snapshotLinkText.ts` and a new `describeSpan()` helper in `src/services/streamStatusText.ts`.

**Pages (sidebar).** *Dashboard*, *AI Detection*, *Snapshots*, *Event History*, *Diagnostics*, *Settings*. The *Network & CORS guide* is reached from Settings > General, Diagnostics and the mixed-content warnings.

| Page | What it shows |
| --- | --- |
| Dashboard | "Live Camera Feed" with a LIVE badge, the picture, the buttons *Capture Still*, *AI Analyze*, *Snapshot Mode* (or *Live Stream*) and *Fullscreen*, a *Camera Information* card, and four cards: Connection, Stream Status, Stream opened / Last frame, Snapshots. |
| AI Detection | The Motion Detection card (ON/OFF switch, sensitivity, cooldown, snapshot on motion, advanced settings, recent events), the Groq AI Recognition card (privacy notice, Analyze Current Frame, latest result, settings, recent results) and a small live picture, because both read it. |
| Snapshots | The gallery with All / Today / This Week tabs, *Capture Still* (takes one frame from the stream, like Snapshot mode), download, delete and the enlarged view. |
| Event History | One timeline of motion alerts, AI recognitions, snapshots and connection problems. |
| Diagnostics | One line per check (reachability, stream, snapshot endpoint, CORS request, connection history) with *Run Full Test*, *View Detailed Logs* and *Copy Report*. |
| Settings | Tabs *Camera*, *AI & Recognition*, *Motion Detection*, *General*. |

**What the reference shows that is not copied.** A model drop-down (the model is set on the server with `GROQ_MODEL`; the AI card shows it read-only), fixed values such as "116 ms", "30 FPS", "Uptime 2h 15m" and "v1.4.2", and an editable camera name. Every number on the Dashboard comes from the live connection, the camera-host measurements or the gallery. When the page cannot know something it says so: the frame rate needs *Frame monitor* (Settings), and "Response time not measured yet" is shown until a measurement exists (Diagnostics > *Measure now*). *Last frame* is only called that with Frame monitor on; otherwise the card reads *Stream opened*.

**AI Analyze.** On the Dashboard it opens AI Detection and runs one analysis as soon as that page has a picture, but only if external AI processing is already switched on (this is the same as pressing *Analyze Current Frame*). If it is off, nothing is sent and the card says so.

**Where detection runs.** Motion Detection and AI Recognition only run while AI Detection is open in Live Stream mode (they read its live picture). Leaving that page stops them, as before; the Dashboard has no detector running. Motion and AI settings are shared: the same options appear on the cards and in Settings, and Settings writes them to the same saved settings the detectors read when AI Detection opens.

**Event History.** Built only from records that already exist:

| Shown | Source | Kept |
| --- | --- | --- |
| Motion alerts (time, % changed, sensitivity, snapshot result) | the Motion Detection history in this browser (`rc_surveillance_motion_history_v1`) | newest 100 |
| AI recognitions (result, category, trigger, failures) | the Groq recognition history in this browser (`rc_surveillance_ai_history_v1`), text only | newest 50 |
| Snapshots (thumbnail, size, saved or session only) | the Snapshot Gallery (IndexedDB) | newest 100 |
| Connection problems and recoveries | the Phase 2 connection history | newest 100, routine steps (connecting, first frame, settings changed) left out |

Nothing is generated and the page never writes to storage. New events appear after you come back from AI Detection; the page also re-reads storage when the browser window regains focus or another tab changes it. *View All* on the motion and AI cards opens it filtered. Where a source could not be saved by the browser (private window, full storage) the page says so.

**Interface changes worth knowing.**
- Status badges are sentence case ("Motion detected", "Frame access blocked", "Ready") instead of ALL CAPS; their meanings are unchanged. The Motion Detection *Start/Stop* buttons became one ON/OFF switch.
- The header shows the camera connection status as the stream manager reports it. On pages without a picture (Snapshots, Event History, Diagnostics, Settings) the stream is closed on purpose and it reads "Disconnected"; that is by design (section 11), not a fault.
- The crosshair reticle and the fit toggle are small buttons on the picture; the reticle is **off by default**.
- Explanations and advanced options sit behind disclosures. The Groq privacy notice stays visible: its first sentences are always shown, only Groq's retention wording is one click away.
- While a message replaces the picture (not configured, connecting, unavailable) its box grows to fit it, so no button is cut off on a phone.
- Keyboard focus is always visible, and decorative animation is switched off for people who ask their system for reduced motion.
- An AI result or history entry shows a thumbnail only when its frame was really kept in the Snapshot Gallery ("Keep a snapshot when a result matches").
- A few messages generated by services (for example in Diagnostics Summary) still say "Live Feed"; they mean the Dashboard. They were left alone because tests assert on their wording.

---

## 18. Pose Estimation and Human Activity Recognition

The **Pose Estimation** page (sidebar) talks to the local Python service in `activity-recognition/`, which
runs YOLOv8-Pose on this computer. Nothing is sent to a cloud API. Start it alongside the dashboard:

```bash
python activity-recognition/run_service.py
```

The page reads frames from the **same shared camera element** the rest of the dashboard uses, through an
off-screen canvas: no second connection is opened to the ESP32-CAM (its firmware serves one stream client).
Reading pixels needs *Allow snapshot capture* in Settings, exactly as Smart Snapshot does.

**What it shows.** The live picture and *Analyze Current Frame* / *Test Sample Frame*; the skeleton overlay
with detected-people, latency and CPU/GPU cards; the 17-point keypoint table; and the
**Human Activity Recognition** section: per person the activity (and whether it is *Confirmed* or
*Provisional*), confidence, body visibility, detection quality, duration, previous activity and tracking
status, plus people who have just left the view.

**Inference frequency.** *Manual*, *0.5 FPS*, *1 FPS* and *2 FPS*. One analysis never overlaps another, and
the camera keeps streaming independently of it.

| Mode | What can be recognised |
| --- | --- |
| Manual (one frame) | Posture only: Standing, Sitting, Bending, Lying Down. A still frame cannot show movement, so the page says so instead of guessing. |
| 0.5 / 1 FPS | Walking and running from the distance covered between frames; the leg-alternation cue is not usable at these rates. |
| 2 FPS | As above, and close to the rate at which steps become observable. |

An activity is shown as *Provisional* until the same one has held for several frames and at least 1.5 s;
it then becomes *Confirmed*, and the one before it appears as "Previous Activity". Walking, running,
inactivity and "Possible Sleeping" are judged per tracked person across frames.

**What it refuses to claim.** When the legs are not visible, only upper-body activities are offered. When
an important part of the body is missing, the label is *Partial Body Detected*; when too little is visible,
*Insufficient Visibility*; when the pose is ambiguous, *Unknown Activity*. In all of those the confidence
reads "—", never a number. *Possible Sleeping* means "lying still for a long time", not "asleep".
The full rules, thresholds and limitations are in [`activity-recognition/README.md`](../activity-recognition/README.md).

**If the service is not running** the panel says so and offers *Retry Connection*; the activity section
reports the reason (unreachable, timeout, model not loaded) and hides the previous result rather than
leaving a stale activity on screen. The camera feed is unaffected.

**Types and tests.** `src/types/pose.ts` mirrors the service's response, and
`tests/fixtures/*.json` are **real recorded service responses** (regenerate with
`python activity-recognition/export_contract_fixtures.py`). The dashboard's tests parse them with the same
validator used for live responses, so a backend change that is not mirrored here fails a test on both sides.

---

## Project Structure

```
RC Surveillance Robot/
│
└── frontend/
    ├── public/
    │   └── .gitkeep
    │
    ├── server/                     (Phase 3C: the AI backend, Node + TypeScript, no packages)
    │   ├── app.ts                  HTTP handler: routes, origin check, limits, error mapping
    │   ├── config.ts               environment settings (reads GROQ_API_KEY, never exposes it)
    │   ├── groqClient.ts           the call to Groq: timeout, bounded retries, error mapping
    │   ├── image.ts                JPEG validation
    │   ├── index.ts                starts the server (npm run server)
    │   ├── limits.ts               request and concurrency limits
    │   ├── normalize.ts            turns the model's text into a structured result
    │   ├── prompt.ts               the request sent to Groq, and its JSON schema
    │   ├── protocol.ts             types shared with the browser
    │   └── redact.ts               removes keys from anything logged or returned
    │
    ├── src/
    │   ├── components/
    │   │   ├── CameraSettingsForm.tsx         (UI redesign: the Camera tab of Settings)
    │   │   ├── CameraStatus.tsx               (the Camera Information card)
    │   │   ├── CameraView.tsx
    │   │   ├── ConnectionHistoryCard.tsx      (Phase 2)
    │   │   ├── ConnectionIndicator.tsx
    │   │   ├── AiRecognitionPanel.tsx         (Phase 3C)
    │   │   ├── ActivityRecognitionSection.tsx (HAR: the Human Activity Recognition section)
    │   │   ├── MotionDetectionPanel.tsx       (Phase 3B)
    │   │   ├── PoseEstimationPanel.tsx        (the Pose Estimation page)
    │   │   ├── PoseKeypointInspector.tsx      (the 17-point keypoint table)
    │   │   ├── DiagnosticsOverview.tsx        (UI redesign)
    │   │   ├── DiagnosticsPanel.tsx
    │   │   ├── DiagnosticsSummaryCard.tsx     (Phase 2)
    │   │   ├── EventHistoryView.tsx           (UI redesign)
    │   │   ├── Header.tsx
    │   │   ├── NetworkGuideView.tsx
    │   │   ├── ResponseTimeCard.tsx           (Phase 2)
    │   │   ├── SettingsPage.tsx               (UI redesign)
    │   │   ├── settingsFields.tsx             (UI redesign: motion and AI settings fields shared by the cards and Settings)
    │   │   ├── Sidebar.tsx
    │   │   ├── SnapshotGallery.tsx
    │   │   ├── SnapshotImage.tsx              (UI redesign)
    │   │   ├── SnapshotNoticeBanner.tsx       (Phase 3A)
    │   │   ├── StreamHealthCard.tsx
    │   │   ├── StreamStatCards.tsx            (UI redesign: the four Dashboard cards)
    │   │   └── ui.tsx                         (UI redesign: shared panel, badge, button and field styles)
    │   │
    │   ├── config/
    │   │   └── cameraConfig.ts
    │   │
    │   ├── hooks/
    │   │   ├── useAiRecognition.ts            (Phase 3C)
    │   │   ├── useMotionDetection.ts          (Phase 3B)
    │   │   ├── useNow.ts
    │   │   ├── useObjectUrl.ts                (Phase 3A)
    │   │   ├── useSmartSnapshot.ts            (Phase 3A)
    │   │   └── useStreamConnection.ts
    │   │
    │   ├── pages/
    │   │   └── Dashboard.tsx
    │   │
    │   ├── services/
    │   │   ├── cameraService.ts
    │   │   ├── aiClient.ts                    (Phase 3C)
    │   │   ├── aiHistory.ts                   (Phase 3C)
    │   │   ├── aiRecognizer.ts                (Phase 3C)
    │   │   ├── aiSettings.ts                  (Phase 3C)
    │   │   ├── clipboard.ts                   (Phase 2)
    │   │   ├── confirmGate.ts                 (Phase 3B)
    │   │   ├── connectionHistory.ts           (Phase 2)
    │   │   ├── connectionService.ts
    │   │   ├── diagnosticReport.ts            (Phase 2)
    │   │   ├── diagnosticsSummary.ts          (Phase 2)
    │   │   ├── frameCapture.ts                (Phase 3A)
    │   │   ├── frameSampler.ts                (Phase 3B)
    │   │   ├── mjpegParser.ts
    │   │   ├── motionDetector.ts              (Phase 3B)
    │   │   ├── motionEventBus.ts              (Phase 3C)
    │   │   ├── motionHistory.ts               (Phase 3B)
    │   │   ├── motionMonitor.ts               (Phase 3B)
    │   │   ├── motionSettings.ts              (Phase 3B)
    │   │   ├── activityPresentation.ts        (HAR: how an activity is shown; pure formatting)
    │   │   ├── poseClient.ts                  (the local pose service: requests, timeouts, errors)
    │   │   ├── poseErrors.ts                  (HAR: typed client errors)
    │   │   ├── poseResponse.ts                (HAR: validation of the service's JSON)
    │   │   ├── poseSettings.ts                (HAR: inference rates and the session id)
    │   │   ├── redact.ts                      (Phase 2)
    │   │   ├── snapshotActions.ts             (Phase 3A)
    │   │   ├── snapshotDownload.ts            (Phase 3A)
    │   │   ├── snapshotLibrary.ts             (Phase 3A)
    │   │   ├── snapshotLinkText.ts            (Phase 3C)
    │   │   ├── snapshotStorage.ts             (Phase 3A)
    │   │   ├── streamConnectionService.ts
    │   │   ├── streamStatusText.ts
    │   │   └── streamTransports.ts
    │   │
    │   ├── types/
    │   │   ├── ai.ts                          (Phase 3C)
    │   │   ├── camera.ts
    │   │   ├── motion.ts                      (Phase 3B)
    │   │   └── pose.ts                        (pose + activity; mirrors activity_types.py)
    │   │
    │   ├── App.tsx
    │   ├── index.css
    │   └── main.tsx
    │
    ├── docs/
    │   ├── phase1-evidence/        (raw evidence behind ../docs/hardware-guide.md)
    │   └── phase2-evidence/        (raw evidence behind ../docs/architecture.md)
    │
    ├── tests/                      (unit tests, run with `npm test`)
    │   └── fixtures/               (REAL recorded responses of the Python pose service)
    ├── tools/
    │   ├── mock-esp32-cam/         (mock camera for manual testing)
    │   ├── mock-groq/              (mock Groq API: canned answers, for testing without a key)
    │   └── run-tests.mjs           (dependency-free test runner)
    │
    ├── .env.example
    ├── .gitignore
    ├── index.html
    ├── metadata.json
    ├── package.json
    ├── package-lock.json
    ├── tsconfig.json
    ├── tsconfig.test.json
    ├── vite.config.ts
    ├── ../docs/hardware-guide.md
    ├── ../docs/architecture.md
    ├── ../docs/architecture.md
    ├── ../docs/architecture.md
    ├── ../docs/architecture.md
    ├── tsconfig.server.json
    └── README.md
```

---

## License

Apache-2.0

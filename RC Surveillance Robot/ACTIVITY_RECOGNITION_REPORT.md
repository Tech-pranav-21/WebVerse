# Human Activity Recognition — Implementation Report

Adds visibility-aware Human Activity Recognition on top of the existing YOLOv8 Pose Estimation service and
Pose Estimation page, and removes the "Hide Raw Detection JSON" toggle. The existing architecture, the
camera streaming design and the pose-estimation output format are unchanged.

**No physical ESP32-CAM was used.** Every live check in section 13 ran against the project's own mock
camera (`tools/mock-esp32-cam`) serving frames derived from the project's photograph.

---

## 1. Existing architecture discovered

| Layer | What is there |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8 + Tailwind 4, no test framework: tests compile with `tsc` to CommonJS and run on `node --test` (`tools/run-tests.mjs`). Non-strict `tsconfig.json` for the app, strict for tests. |
| Dashboard shell | `pages/Dashboard.tsx` owns one **persistent camera DOM node** that is re-parented into the active page's slot (`feed` / `ai` / `pose`), so navigating never drops the MJPEG stream. `useStreamConnection` owns the single connection. |
| Frame capture | `services/frameCapture.ts` reads the live `<img>` through an off-screen canvas (`captureFrameFromImage`). No extra request to the camera; needs `captureCors` ("Allow snapshot capture"). |
| Pose page | `components/PoseEstimationPanel.tsx` → `services/poseClient.ts` → `types/pose.ts`. Two requests per analysis: `/detect` for JSON and `/detect/visualize` for the overlay. |
| Python service | FastAPI (`service.py`), singleton `ModelManager` (`model_loader.py`) loading `yolov8n-pose.pt` once with CUDA→CPU fallback and warm-up, `pose_estimator.py` (decode → predict → 17 COCO keypoints → PIL overlay), `config.py` (env-var thresholds), `test_service.py` (a script, not a framework). |
| Endpoints | `GET /`, `GET /health`, `POST /detect`, `POST /detect/file`, `POST /detect/visualize`, `POST /detect/visualize/file`. |
| Proxy | `vite.config.ts` maps `/api/pose/*` → `127.0.0.1:8000`, `/api/*` → the Groq backend on 8787. |

**Baseline before any change:** 674 frontend tests pass, `npm run lint` clean, `test_service.py` passes,
`.venv` has Python 3.11.9 / torch 2.14.1 (CPU build — **no CUDA on this machine**) / ultralytics 8.4.184.

Key constraint found by probing the real model: on a cropped body YOLO **clamps unseen joints to the image
border and still reports high confidence** (e.g. a wrist at `y = height` with conf 0.52). Trusting those
would have produced confident nonsense, so border-pinned keypoints are rejected (section 6).

## 2. Files inspected

`frontend/src/components/PoseEstimationPanel.tsx`, `services/poseClient.ts`, `types/pose.ts`,
`pages/Dashboard.tsx`, `components/ui.tsx`, `services/frameCapture.ts`, `services/aiClient.ts`,
`hooks/useStreamConnection.ts`, `config/cameraConfig.ts`, `services/cameraService.ts`, `vite.config.ts`,
`package.json`, `tsconfig*.json`, `tools/run-tests.mjs`, `tools/mock-esp32-cam/*`, `tests/*` (style),
`frontend/README.md`; `activity-recognition/{run_service,service,pose_estimator,model_loader,config,test_service}.py`,
`requirements.txt`, `README.md`, `test_person.jpg`; root `README.md`, `.claude/launch.json`.

## 3. Files created

**Backend** (`activity-recognition/`)

| File | Purpose |
|---|---|
| `activity_types.py` | Labels, visibility modes, quality levels, tracking statuses, the `activity` field list, and `ActivityConfig` (every tunable). |
| `visibility.py` | Keypoint reliability, weighted body visibility, full/upper/partial/insufficient mode, detection quality. |
| `posture.py` | Fuzzy static posture (upright / sitting / bending / lying + upper-body) with an ambiguity margin. |
| `person_tracker.py` | Greedy multi-person tracker: stable `track_id`, motion-gated matching, bounded lifetime and count. |
| `motion.py` | Theil–Sen speed, approach rate, gait alternation, pose change, arm motion, over a bounded history. |
| `activity_engine.py` | Per-session state, candidate selection, hold-and-switch confirmation, lying/sleeping evidence, response building. |
| `pose_fixtures.py` | Synthetic skeletons from anatomical proportions + the `Scene` driver for timed sequences. |
| `photo_fixtures.py` | Images derived from `test_person.jpg` for real-model tests. |
| `export_contract_fixtures.py` | Records real service responses into `frontend/tests/fixtures/` (`--check` detects drift). |
| `test_activity_visibility.py`, `test_activity_posture.py`, `test_activity_tracker.py`, `test_activity_temporal.py`, `test_activity_api.py`, `test_pose_estimation.py`, `test_activity_realmodel.py`, `test_contract_fixtures.py` | The test suites (section 12). |

**Frontend** (`frontend/`)

`src/services/poseErrors.ts` (typed client errors), `src/services/poseResponse.ts` (response validation),
`src/services/poseSettings.ts` (inference rates, session id), `src/services/activityPresentation.ts`
(pure display formatting), `src/components/ActivityRecognitionSection.tsx`,
`src/components/PoseKeypointInspector.tsx`, `tests/poseFixtures.ts`, `tests/poseContract.test.ts`,
`tests/poseClient.test.ts`, `tests/activityPresentation.test.ts`, `tests/poseSettings.test.ts`,
`tests/poseComponents.test.ts`, `tests/fixtures/*.json` (10 recorded responses).

## 4. Files modified

| File | Change |
|---|---|
| `activity-recognition/config.py` | Added the `HAR_*` settings block (env-var driven, with safe fallbacks). Nothing existing changed. |
| `activity-recognition/service.py` | `/detect` and `/detect/file` extended with optional `sessionId` / `trackActivity` / `resetTracking` / `includeAnnotated`; `_attach_activity()` isolates activity failures; 503 for a model that failed to load; `/health` reports HAR state. `/detect/visualize` left stateless. |
| `activity-recognition/pose_estimator.py` | New `ModelNotLoadedError`; the overlay banner shows the activity when one is attached. `estimate_pose()` output format untouched. |
| `activity-recognition/README.md` | New sections: HAR pipeline, adaptive visibility, temporal recognition, sleeping limits, configuration, limitations; API reference updated. |
| `frontend/src/types/pose.ts` | Added the activity types; existing interfaces kept. |
| `frontend/src/services/poseClient.ts` | Rewritten as `createPoseClient()` (injectable fetch) with timeouts, cancellation, typed errors, validation, session options. Same exported `poseClient`, same method names. |
| `frontend/src/components/PoseEstimationPanel.tsx` | One request per analysis (`includeAnnotated`), session id, in-flight guard, sample frames untracked, keypoint card extracted, activity section added, **JSON toggle removed**. |
| `frontend/tsconfig.test.json` | `jsx: react-jsx` and the new modules added so components are type-checked and tested. |
| `frontend/README.md` | New section 18 (Pose Estimation + HAR), test and structure sections updated. |

## 5. Activity recognition approach

Per person, per frame: **visibility → posture → identity → movement → decision**.

* **Posture (one frame)** is fuzzy: each posture scores 0–1 as the minimum over its conditions, using
  ratios and angles (torso angle from vertical, knee/ankle drop relative to torso length, leg angle,
  torso/leg ratio, box aspect). The winner must reach `posture_min_score` **and** beat the runner-up by
  `posture_min_margin`; otherwise the posture is unknown and the activity is `Unknown Activity`. This is
  what makes a crouch, a lean or an inverted body refuse to be classified instead of being forced into a label.
* **Movement (several frames)** decides Standing vs Walking vs Running — never a single image.
* **Confidence** = posture clarity × mean keypoint confidence × agreement across recent frames, and is
  `null` whenever nothing is claimed. It is a heuristic score, not a probability, and is labelled as such
  in the UI.
* Labels: Standing, Sitting, Walking, Running, Bending, Lying Down, Prolonged Inactivity, Possible
  Sleeping, Raising Hands, Arm Movement, Upper Body Bending, Upper Body Inactivity, Partial Body Detected,
  Insufficient Visibility, Unknown Activity.

## 6. Adaptive visibility implementation

A keypoint counts only if `confidence ≥ HAR_KEYPOINT_MIN_CONF` (0.50), it is inside the image, and it is
**not pinned to the image border** — the clamping behaviour found while probing the real model. Keypoints
are weighted (hips/shoulders/legs 2.0, arms 1.5, nose 1.0, eyes/ears 0.5), so "Body Visibility" reflects
what matters for posture, not a raw count.

| Mode | Condition | Allowed |
|---|---|---|
| `full_body` | torso + ≥1 complete leg (hip, knee, ankle) | Standing, Sitting, Walking, Running, Bending, Lying Down, Prolonged Inactivity, Possible Sleeping |
| `upper_body` | both shoulders, no usable legs | Raising Hands, Arm Movement, Upper Body Bending, Upper Body Inactivity |
| `partial` | something important missing | `Partial Body Detected` + the reason (and a hint when the frame edge is the cause) |
| `insufficient` | too small / too few / too unsure | `Insufficient Visibility` |

Distance independence: everything is ratios, so 60 px and 420 px people are judged identically; below
`HAR_MIN_PERSON_SIZE_PX` (40 px on the **largest** box side, so a lying person is not rejected for being
short) nothing is classified. Detection quality = `0.5·visibility + 0.3·mean keypoint conf + 0.2·box conf`,
mapped to Good / Medium / Poor / Insufficient, and capped at Poor for a partial body.

## 7. Temporal tracking implementation

* **Identity:** cost = centre distance (in body heights) + (1 − IoU) + |log size ratio|, greedy assignment,
  gated by what a person could physically cover in the elapsed time (`0.6 + 3.0·Δt` body heights). Size uses
  √area so a standing→lying change keeps the same id, while distance uses the largest side so a fast
  runner is not judged too far away. Unmatched tracks survive `HAR_TRACK_MAX_AGE_S` (5 s) then are dropped
  **with their history**; counts are capped per session and per process.
* **History:** a `deque` bounded by both frames (40) and seconds (20). Frames closer than 50 ms replace
  the previous observation; out-of-order timestamps are treated as the same instant.
* **Speed:** torso lengths per second via the **Theil–Sen** slope (median of pairwise slopes), so one bad
  frame cannot create motion. Bands: standing < 0.5, walking ≥ 0.9, running ≥ 4.6 TL/s.
* **Approach:** |d ln(size)/dt| supports Walking only — depth speed is unknowable monocularly.
* **Gait:** ankle-crossing rate, used **only** at ≥ 4 FPS; below that it is reported as
  `unavailable (frame rate too low to see steps)` rather than guessed.
* **Smoothing:** a new activity needs `HAR_CONFIRM_FRAMES` (3) consecutive candidates **and**
  `HAR_MIN_CONFIRM_S` (1.5 s). `label` vs `candidate_label` exposes a change in progress without flicker.
  A confirmed activity is dropped after `HAR_STALE_ACTIVITY_S` (6 s) without evidence.
* **Isolation:** state is keyed by `sessionId` (one per browser tab), LRU-capped at 8 with a 300 s TTL.
  Multi-person tracking works; the honest limitation is re-identification (section 14).

## 8. Possible Sleeping — and its limitations

Progression: `Lying Down` → `Prolonged Inactivity` (15 s) → `Possible Sleeping` (60 s), and only when at
least 70 % of the frames in that period were good-quality **full-body** lying evidence. Movement beyond the
thresholds, a contradicting posture, or losing the person past the track lifetime resets the clock. The
response note says *"This is an estimate only: sleep cannot be confirmed from video."*

**It cannot detect sleep.** A person lying still while awake is indistinguishable; sleeping sitting up is
not detected; a blanket or furniture gives `partial` instead; eyes, breathing and micro-movement are not
observable at this resolution.

## 9. API changes

No endpoint added or removed; all previously returned fields are unchanged, and an old request body still
works. `/detect` and `/detect/file` gained optional `sessionId`, `trackActivity`, `resetTracking`,
`includeAnnotated`; each person gained `track_id` and `activity` (17 fields: label, confidence, confirmed,
candidate_label, previous_label, duration_s, body_visibility, visibility_mode, detection_quality,
quality_score, tracking_status, observations, inactive_s, note, missing_regions, evidence, track_id); the
response gained `activity_recognition` (enabled, tracking, session_id, persons_analyzed, persons_skipped,
lost_tracks, error). `/health` reports HAR state. Status codes: 400 bad frame, 413 too large, 422 invalid
session/threshold, 500 inference failure, **503 model not loaded** (new).

Handled on the client: timeout (20 s, one deadline across proxy and direct port), cancellation, unreachable
service, invalid response, no person, partial body, model unavailable, processing failure. A frame the
service itself answered with an error is **not** retried on the direct port (it would be analysed twice).
A malformed `activity` drops only the activity and keeps the skeleton. An activity-layer exception on the
server never costs the pose result.

## 10. UI changes

The existing layout, styling and controls are unchanged. Added below them: **HUMAN ACTIVITY RECOGNITION**,
a card per person showing Detected Person, Current Activity (+ Confirmed / Provisional / Not classified),
Activity Confidence (with a meter), Body Visibility (meter), Detection Quality, Activity Duration, Previous
Activity and Tracking Status, plus the explanation note, missing regions, inactivity time, people who left
the view, and a standing disclaimer that activities are estimates. A **2 FPS** inference option was added
beside the existing Manual / 0.5 / 1 FPS. The keypoint card moved unchanged into `PoseKeypointInspector`
(person numbering now follows the tracking id, matching the activity cards).

**"Hide Raw Detection JSON" is removed**: the button, its `showJson` state, the `<pre>` dump and the
now-unused `ChevronUp`/`ChevronDown` imports are gone, and the space it occupied with it. The raw data is
still held in state (`lastResult`) and drives both the keypoint table and the activity section.

After a failed request the section reports the reason and **hides the previous result** instead of leaving
a stale activity on screen that looks current.

## 11. Dependencies

**None added, none changed, none removed** — frontend and backend. No new Python package (the tracker,
smoothing and statistics are standard library), no new npm package (components are rendered in tests with
the already-present `react-dom/server`). `requirements.txt` and `package.json` are untouched.

## 12. Tests executed and results

All figures below are measured from the final run after every change (2026-10-31).

| Suite | Command | Result |
|---|---|---|
| Python (all) | `cd activity-recognition && python -m unittest discover -p "test_*.py"` | **194 passed, 0 failed** (17.7 s) |
| Legacy script | `python activity-recognition/test_service.py` | **passed** — all 5 suites, 13 `[PASS]` checks |
| Frontend | `npm test` | **833 passed, 0 failed**, 167 suites (1.0 s) — 674 pre-existing + **159 new** |
| Lint / types | `npm run lint` (app + server + tests, `tsc --noEmit`) | **clean**, exit 0 |
| Production build | `npm run build` | **succeeded** in 401 ms — `index-Dst85gL0.js` 510.89 kB (gzip 151.60 kB), CSS 53.85 kB |

Python suites in detail:

| Suite | Tests | Covers |
|---|---:|---|
| `test_activity_visibility` | 29 | keypoint reliability, the four modes, quality bands, distances, malformed input |
| `test_activity_posture` | 26 | upright / sitting / bending / lying, front and side, jitter, ambiguity, upper body |
| `test_activity_tracker` | 14 | stable ids, two people crossing, disappearance, expiry, bounded state |
| `test_activity_temporal` | 62 | standing↔walking↔running, stability, sessions, bounded memory, gait, sleeping |
| `test_activity_api` | 28 | the HTTP contract, sessions, stateless visualize, every error path |
| `test_pose_estimation` | 17 | **real model**: person detected / none / missing / low-confidence keypoints, overlay |
| `test_activity_realmodel` | 16 | **real model**: activities, upper body, lying, real sideways movement |
| `test_contract_fixtures` | 2 | the recorded fixtures and `pose.ts` still match the service |
| **Total** | **194** | |

Coverage against the request: pose estimation (person detected / none / missing keypoints / low-confidence
keypoints); activity (standing, sitting, walking, running, bending, lying, unknown); adaptive visibility
(full, upper, missing legs, missing arms, low confidence, distances 60–420 px, person too close);
temporal (standing→walking, walking→running, running→standing, disappearing and returning, stability);
frontend (panel renders, confidence display, insufficient visibility, API failures, JSON toggle removed,
existing pose functionality intact).

**The tests are not mocked-success theatre.** The Python suites run the **real YOLOv8 model** on the
project's photograph and on images derived from it; the dashboard's fixtures are **real recorded service
responses**; components are really rendered to HTML.

**Mutation check: 24/24 defects detected.** Each defect was introduced into the source, the relevant suite
run, and the file restored byte-for-byte (verified by SHA-256 after every restore, and by a final sweep of
all 13 touched files). Round 1 caught 19 of 21; the two survivors were **genuine gaps in my tests**, now
closed and re-verified in round 2 together with the three mutations that round 1 never reached:

| Survivor | Why it survived | Fix |
|---|---|---|
| `HAR_MIN_CONFIRM_S = 0` | every confirmation test overrode the value, so the shipped default was untested | added a test that uses the default config and proves 1 s of evidence is never confirmed |
| `/detect/visualize` records frames | the test called it without advancing the clock, so the extra frames merged into one observation | the clock now advances between calls, and the test also asserts the activity stays unconfirmed |

Defects detected include: confirmation without the frame count or the duration, trusting border-pinned
keypoints, ignoring the confidence threshold, measuring person size by height only, guessing a partial
body as full, calling an inverted body "lying", sleeping without the inactivity period or evidence
quality, movement not resetting the sleep clock, sample frames joining the live history,
`/detect/visualize` counting frames, an activity-layer failure taking the pose result with it, a stale
result staying on screen, the JSON toggle returning, showing a number where there is no confidence,
accepting a malformed response, retrying a frame the service already answered, dropping an inference
mode, and the panel opening its own camera stream.

**Bugs this process caught and fixed:** a lying person rejected as "too small" (box height vs largest
side), a fast runner losing their tracking id (distance normalised by √area), an upside-down body read as
"Lying Down", a stale activity staying on screen after a failed request, and — found by the mutation run
itself — **three client tests that hung for ever instead of failing** when the request timeout was
removed. They now race against a deadline, so that regression is reported in 19 s with exit code 1 rather
than stalling a CI run indefinitely (this was verified by re-applying the mutation after the fix).

## 13. Live verification (mock camera, no ESP32-CAM)

Dashboard on `localhost:3000`, service on `127.0.0.1:8000`, mock camera serving frames built from
`test_person.jpg`. Verified in the browser: the service reachable through the Vite proxy with
`activity_recognition` in `/health`; the camera feed connected with **one** stream connection
(`activeStreams: 1`, `totalRequests: 1` on the mock's stats, and `control.totalRequests: 0` — the
`/capture` endpoint is never touched — unchanged while inference ran);
*Analyze Current Frame* → provisional **Standing** with the "single frame" note; **1 FPS** → confirmed
**Standing 97 %**; a moving person → confirmed **Walking 93 %** with the overlay banner reading
`#1 Walking 78 %`; *Test Sample Frame* leaving the live history intact; the service stopped mid-run →
"Cannot reach the local pose service…" with the stale result hidden and the camera still connected;
service restarted → recovery without a page reload. No raw-JSON control anywhere
(`document.querySelectorAll('pre').length === 0`). Checked at 1360×1000 and at 375 px phone width
(no horizontal scroll: `scrollWidth === innerWidth === 375`).

**Re-verified after the final code change** (the overlay is now a `data:` URL, so only `blob:` URLs are
revoked): live MJPEG `<img>` at 640×360 still streaming, overlay image loaded at 640×360 from a
`data:image/jpeg;base64` source, **Walking 63 %** with full-body visibility, still a single stream
connection, 0 `<pre>` elements and no "raw detection json" text in the page. Steady-state network check:
6 requests in 6 s, **all HTTP 200, zero failures**. (Connection-refused entries earlier in the console
came from the boot window before the service and mock camera had started; they stop once both are up.)

**Not verified:** any physical ESP32-CAM, and GPU/CUDA behaviour — this machine's torch is a CPU build, so
every measurement here is CPU (≈ 43–99 ms per inference at these frame sizes). The CUDA path is exercised
only by the pre-existing fallback logic and by tests that simulate it.

## 14. Known limitations

1. **No re-identification.** Matching is position/overlap/size only: people crossing at a low frame rate,
   or someone returning within 5 s, can swap or share an id. Single-person-in-view is the reliable case.
2. **A stationary camera is assumed.** While the robot drives, scene motion is indistinguishable from the
   person's own, and speeds become meaningless.
3. **Gait is invisible at 0.5–1 FPS**, so walking on the spot reads as Standing at those rates.
4. **Monocular geometry:** depth movement is seen only through size change; steep camera angles distort
   the posture ratios.
5. **Possible Sleeping is an estimate** (section 8).
6. **Confidence is heuristic**, not calibrated; it should not be read as a probability.
7. Only the largest `HAR_MAX_TRACKED_PERSONS` (5) people per frame are analysed; others get no activity
   and the page says how many.
8. Thresholds were tuned against one photograph, synthetic skeletons and the mock camera — real-world
   footage may need `HAR_*` adjustment. No GPU and no real camera were tested.
9. `Sitting` is inferred from leg geometry, so a chair hidden behind a desk (legs occluded) gives
   `partial` or an upper-body label instead.

## 15. Commands

```bash
# 1. Backend: the local pose + activity service (port 8000)
python activity-recognition/run_service.py
```

```bash
# 2. Frontend: the dashboard (port 3000, proxies /api/pose to 8000)
cd frontend && npm install && npm run dev
```

```bash
# Optional: the Groq AI backend used by the AI Detection page
cd frontend && npm run server
```

```bash
# Tests, checks and build
cd activity-recognition && python -m unittest discover -p "test_*.py"
python activity-recognition/test_service.py
cd frontend && npm test
cd frontend && npm run lint
cd frontend && npm run build
```

```bash
# Re-record the real backend responses used by the dashboard's tests (after any API change)
python activity-recognition/export_contract_fixtures.py
```

```bash
# Test without hardware: mock camera (Settings → Base URL http://localhost:8080, Stream :8081/stream)
node frontend/tools/mock-esp32-cam/mock-esp32-cam.mjs --cors
```

## 16. Final checks

| # | Check | Result |
|---|---|---|
| 1 | Blob-URL cleanup finished | `URL.revokeObjectURL` now only for `blob:` URLs (the overlay is a `data:` URL) |
| 2 | Mutation testing completed | 24 mutations, **24 caught** (19 in round 1, 2 survivors fixed, 3 unreached, all re-run) |
| 3 | Every mutation restored | SHA-256 checked after each restore, plus a final sweep of all 13 files: **all original** |
| 4 | Python suite | `194 passed, 0 failed`; legacy `test_service.py` passes |
| 5 | Frontend tests | `833 passed, 0 failed`, 167 suites |
| 6 | Lint, type check, build | all exit 0; production build succeeds |
| 7 | Report counts | measured values, no placeholders |
| 8 | "Hide Raw Detection JSON" removed | absent from source, from `PoseEstimationPanel.tsx` state/imports, **and from the production bundle** |
| 9 | Camera streaming and pose estimation unaffected | every camera/stream file untouched (timestamps predate this session); one stream connection; `estimate_pose()` output unchanged; live re-check passed |

### Complete list of files

**Modified (10):** `activity-recognition/config.py`, `service.py`, `pose_estimator.py`, `README.md`;
`frontend/src/types/pose.ts`, `src/services/poseClient.ts`, `src/components/PoseEstimationPanel.tsx`,
`tsconfig.test.json`, `README.md`; `frontend/tests/` additions are listed below.

**Created — backend (14):** `activity_types.py`, `visibility.py`, `posture.py`, `person_tracker.py`,
`motion.py`, `activity_engine.py`, `pose_fixtures.py`, `photo_fixtures.py`, `export_contract_fixtures.py`,
`test_activity_visibility.py`, `test_activity_posture.py`, `test_activity_tracker.py`,
`test_activity_temporal.py`, `test_activity_api.py`, `test_pose_estimation.py`,
`test_activity_realmodel.py`, `test_contract_fixtures.py`.

**Created — frontend (12 + fixtures):** `src/services/poseErrors.ts`, `poseResponse.ts`, `poseSettings.ts`,
`activityPresentation.ts`; `src/components/ActivityRecognitionSection.tsx`, `PoseKeypointInspector.tsx`;
`tests/poseFixtures.ts`, `poseContract.test.ts`, `poseClient.test.ts`, `activityPresentation.test.ts`,
`poseSettings.test.ts`, `poseComponents.test.ts`; `tests/fixtures/*.json` (10 recorded responses).

**Untouched (verified):** every camera, streaming, motion, snapshot, Groq AI, diagnostics and settings
file; `requirements.txt`; `package.json`.

## Completeness

Every requested item is implemented and verified. Two gaps cannot be closed on this machine and are stated
wherever they could be mistaken for verified behaviour: **no physical ESP32-CAM was tested** (a mock camera
was used) and **no GPU was tested** (this machine's PyTorch is a CPU-only build, so all timings are CPU and
the CUDA path is exercised only by the pre-existing fallback logic and simulated tests).

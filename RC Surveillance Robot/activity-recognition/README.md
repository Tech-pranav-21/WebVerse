# Local Human Pose Detection Service

Lightweight, real-time, on-device human pose estimation service for the **RC Surveillance Robot** project.

---

## 1. Overview & Architecture

This service adds local Human Activity Recognition (HAR) and body keypoint detection capabilities to the RC Surveillance Robot without relying on external cloud APIs or putting extra strain on the ESP32-CAM.

### Key Architectural Safeguards
* **Zero Extra Camera Connections**: The service receives single JPEG frames captured by the browser frontend from the already-running stream (`<img crossorigin>`) via an off-screen HTML5 Canvas. The ESP32-CAM's single-client MJPEG limit is never violated.
* **100% Local Inference**: Zero frames are sent to cloud APIs (such as Groq) for pose estimation.
* **Low-Frequency Controlled Inference**: Inference can be triggered on demand or throttled (e.g. 0.5 to 2 FPS) to conserve GPU/CPU power.
* **Automatic Hardware Detection with CPU Fallback**: Automatically selects CUDA GPU (`cuda:0`) when supported, or seamlessly falls back to CPU if GPU inference or CUDA wheels are unavailable.
* **Single Model In-Memory Cache**: The model is loaded once at server startup and kept in memory/VRAM. It is never reloaded per frame.

---

## 2. Model Selection & Licensing

### Model Selected: `yolov8n-pose.pt` (YOLOv8 Nano Pose)
* **Architecture**: Ultralytics YOLOv8 Nano Pose Estimation
* **Parameter Count**: ~3.2 Million parameters
* **Weights Size**: ~6.5 MB (`yolov8n-pose.pt`)
* **Computational Cost**: ~8.9 GFLOPs at 640x640 resolution
* **VRAM Footprint**: Under 800 MB on NVIDIA RTX 2050 (4 GB VRAM)
* **Keypoint Topology**: COCO 17 body keypoints:
  ```
  0: Nose           1: Left Eye       2: Right Eye
  3: Left Ear       4: Right Ear      5: Left Shoulder
  6: Right Shoulder 7: Left Elbow     8: Right Elbow
  9: Left Wrist    10: Right Wrist   11: Left Hip
 12: Right Hip     13: Left Knee     14: Right Knee
 15: Left Ankle    16: Right Ankle
  ```

### Licensing Information
* **License**: **AGPL-3.0 (GNU Affero General Public License v3.0)**
* **Copyright**: Ultralytics Inc.
* **Source**: [https://github.com/ultralytics/ultralytics](https://github.com/ultralytics/ultralytics)
* **Permissions**: Permitted for open-source, educational, research, and local internal use. Source modifications must remain under AGPL-3.0. Enterprise/commercial non-copyleft licenses are available directly from Ultralytics.

---

## 3. Installation & Setup

### Prerequisites
* Python 3.10+ (tested on Python 3.11.9 64-bit)
* Windows 10/11 with optional NVIDIA GPU (RTX 2050 with 4 GB VRAM supported)

### Install Dependencies
Run from the repository root:

```bash
pip install -r activity-recognition/requirements.txt
```

*(Optional) For CUDA acceleration on NVIDIA RTX 2050:*
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

---

## 4. Starting the Service

### Quick Start
```bash
python activity-recognition/run_service.py
```

Or using `uvicorn` directly:
```bash
uvicorn service:app --app-dir activity-recognition --host 127.0.0.1 --port 8000
```

The service will output:
```
[pose_model_loader] Loading pose estimation model 'yolov8n-pose.pt'...
[pose_model_loader] Model loaded successfully on device 'cpu' (or 'cuda:0').
Starting Local Human Pose Detection Service on http://127.0.0.1:8000
```

* Interactive Swagger API documentation is available at: **`http://127.0.0.1:8000/docs`**

---

## 5. Running Automated Verification Tests

The unit and integration suites (visibility, posture, tracking, temporal recognition, the HTTP API, and
pose estimation with the real model) run with `unittest` from inside this folder:

```bash
cd activity-recognition && python -m unittest discover -p "test_*.py"
```

The original end-to-end script is still there and still passes:

```bash
python activity-recognition/test_service.py
```

The tests that need keypoints use one of two sources, never hand-written detections:

* `pose_fixtures.py` builds **synthetic skeletons** from anatomical proportions, so a posture can be
  created exactly at any distance, view and visibility (fast, no model).
* `photo_fixtures.py` derives images from `test_person.jpg` (crops, rotations, a scaled person pasted on a
  canvas, a person pasted at moving positions) and runs the **real YOLOv8 model** on them.

---

## 6. Human Activity Recognition

The service adds a `track_id` and an `activity` object to every detected person. Pose estimation itself is
unchanged: `estimate_pose()` still returns exactly what it did before, and the activity layer runs on its
output. If activity recognition is switched off or fails, the pose result is still returned.

### 6.1 Pipeline (per person, per frame)

| Step | Module | What it decides |
|------|--------|-----------------|
| 1. Keypoint quality & visibility | `visibility.py` | Which keypoints may be trusted; `full_body` / `upper_body` / `partial` / `insufficient`; body visibility (0–1) and detection quality |
| 2. Static posture | `posture.py` | upright / sitting / bending / lying (or the upper-body postures) from ONE frame |
| 3. Identity | `person_tracker.py` | A stable `track_id`, so one person's history is never mixed with another's |
| 4. Movement | `motion.py` | Speed, movement along the camera axis, leg alternation, inactivity, arm movement |
| 5. Decision & smoothing | `activity_engine.py` | The candidate activity for this frame, and whether it has held long enough to be shown |

**Nothing is guessed.** With partial or insufficient visibility the label is `Partial Body Detected` or
`Insufficient Visibility` and the confidence is `null`; an ambiguous pose is `Unknown Activity`.
`confidence` is a heuristic score (posture clarity × keypoint confidence × agreement over recent frames),
**not a calibrated probability**.

### 6.2 Adaptive body visibility

A keypoint counts as evidence only if its confidence reaches `HAR_KEYPOINT_MIN_CONF`, it is inside the
image, and it is **not pinned to the image border** — YOLO clamps joints it cannot see to the edge and
often gives them a high confidence, which is the single biggest source of wrong activities. Keypoints are
weighted (hips and legs decide posture, ears barely matter), so "body visibility" is not a plain count.

| Mode | Condition | Activities allowed |
|------|-----------|--------------------|
| `full_body` | torso + at least one complete leg (hip, knee, ankle) | Standing, Sitting, Walking, Running, Bending, Lying Down, Prolonged Inactivity, Possible Sleeping |
| `upper_body` | both shoulders, no usable legs | Raising Hands, Arm Movement, Upper Body Bending, Upper Body Inactivity |
| `partial` | something important missing | `Partial Body Detected` only — and the reason, e.g. the frame cutting off the legs |
| `insufficient` | too small, too few or too unsure keypoints | `Insufficient Visibility` only |

Distance is handled by using ratios and angles everywhere, never pixels: a person 60 px or 420 px tall is
judged identically. A person smaller than `HAR_MIN_PERSON_SIZE_PX` (largest box side, so a lying person is
not rejected for being short) is `insufficient`.

### 6.3 Temporal recognition

Walking and running cannot be seen in a still image, so Standing / Walking / Running is decided from a
**bounded** history (`HAR_HISTORY_MAX_FRAMES` frames **and** `HAR_HISTORY_MAX_S` seconds, whichever is hit
first — nothing grows without limit).

* **Speed** is measured in **torso lengths per second** (distance-independent) from timestamps
  (frame-rate independent), using a Theil–Sen slope (the median of pairwise slopes), so one jittery
  keypoint or one bad frame cannot turn a standing person into a runner. Reference: standing < 0.5,
  walking ≈ 1.5–3, running > 4.6 TL/s.
* **Movement along the camera axis** is picked up from the person's changing size, and only supports
  "Walking": the actual speed cannot be known without the distance.
* **Leg alternation** is used **only** when frames arrive at `HAR_GAIT_MIN_FPS` or faster. A step cycle
  lasts about a second, so at 0.5 or 1 FPS it simply cannot be observed, and the cue is reported as
  `unavailable` instead of being guessed at.
* **Smoothing:** a new activity must be the candidate for `HAR_CONFIRM_FRAMES` consecutive frames **and**
  `HAR_MIN_CONFIRM_S` seconds before it replaces the shown one. The response carries both `label` (what is
  shown) and `candidate_label` (what this frame suggests), so a change in progress is visible but does not
  make the display flicker.
* **Disappearing:** an unmatched track stays alive for `HAR_TRACK_MAX_AGE_S` (a short occlusion or a missed
  detection keeps the id and the history) and is then dropped with its history; the person is reported in
  `activity_recognition.lost_tracks` meanwhile. A confirmed activity is forgotten after
  `HAR_STALE_ACTIVITY_S` without usable evidence rather than being shown as though it were current.

### 6.4 Possible Sleeping — and what it does not mean

**This service cannot detect sleep.** It can only observe that someone has been lying still, which is why
the label is `Possible Sleeping` and the note says so.

The progression is `Lying Down` → `Prolonged Inactivity` (after `HAR_PROLONGED_INACTIVITY_S`) →
`Possible Sleeping` (after `HAR_SLEEP_MIN_INACTIVITY_S`, 60 s by default). It additionally requires that at
least `HAR_SLEEP_MIN_EVIDENCE_RATIO` of the frames in that period were good-quality **full-body** lying
evidence. Any movement beyond the inactivity thresholds, any contradicting posture, or losing the person
for longer than the track lifetime resets the clock.

Known limits: a person lying still while awake (reading, watching television) is indistinguishable from a
sleeping one; a person sleeping sitting up is not detected; blankets or furniture that hide the body give
`partial` instead; the system cannot see eyes, breathing or micro-movement at this resolution.

### 6.5 Configuration

Every threshold is an environment variable read in `config.py` (defaults in brackets); an unparsable value
falls back to the default instead of stopping the service:

| Variable | Meaning |
|----------|---------|
| `HAR_ENABLED` [true] | Switch activity recognition off entirely (pose estimation still works) |
| `HAR_KEYPOINT_MIN_CONF` [0.50] | Minimum keypoint confidence to count as evidence |
| `HAR_MIN_PERSON_SIZE_PX` [40] | Smaller people are `insufficient` |
| `HAR_MIN_VISIBILITY` [0.25] / `HAR_MIN_RELIABLE_KEYPOINTS` [5] | Floors below which nothing is classified |
| `HAR_QUALITY_GOOD` [0.80] / `HAR_QUALITY_MEDIUM` [0.60] / `HAR_QUALITY_POOR` [0.40] | Detection-quality cut-offs |
| `HAR_TRACK_MAX_AGE_S` [5] / `HAR_MAX_TRACKED_PERSONS` [5] | Tracking lifetime and how many people are analysed |
| `HAR_HISTORY_MAX_FRAMES` [40] / `HAR_HISTORY_MAX_S` [20] | Bounded pose history |
| `HAR_SPEED_STATIONARY_MAX` [0.5] / `HAR_SPEED_WALK_MIN` [0.9] / `HAR_SPEED_RUN_MIN` [4.6] | Speed bands (torso lengths/s) |
| `HAR_GAIT_MIN_FPS` [4] | Frame rate below which the leg-alternation cue is not used |
| `HAR_CONFIRM_FRAMES` [3] / `HAR_MIN_CONFIRM_S` [1.5] / `HAR_STALE_ACTIVITY_S` [6] | Smoothing and confirmation |
| `HAR_PROLONGED_INACTIVITY_S` [15] / `HAR_SLEEP_MIN_INACTIVITY_S` [60] / `HAR_SLEEP_MIN_EVIDENCE_RATIO` [0.70] | Inactivity and possible sleeping |
| `HAR_MAX_SESSIONS` [8] / `HAR_SESSION_TTL_S` [300] | Independent tracking sessions (one per browser tab) |

### 6.6 Limitations

1. **No re-identification.** Matching uses position, box overlap and size only. Two people who cross paths
   at a low frame rate, or someone who leaves and returns within `HAR_TRACK_MAX_AGE_S`, can swap or share
   an id. Multi-person tracking is supported, but a single person in view is the reliable case.
2. **A stationary camera is assumed.** While the robot drives, the whole scene moves and that movement is
   indistinguishable from the person's own.
3. **Gait is invisible at 0.5–1 FPS.** Walking is then recognised from the distance covered, so walking on
   the spot reads as Standing at those rates.
4. **Monocular geometry.** Movement straight towards the camera is only visible through size change, and
   unusual camera angles (looking steeply down) distort the posture ratios.
5. **Activities are estimates, not facts** — see `Possible Sleeping` above in particular.

---

## 7. API Reference

No endpoint was added or removed: the existing ones were extended, and every field they returned before is
still there, unchanged. A client that sends the old request body still works.

### `GET /health`
Returns service status, active device, VRAM statistics, and activity-recognition state.

**Example Response:**
```json
{
  "ok": true,
  "status": "ready",
  "uptime_seconds": 12.4,
  "service": "activity-recognition",
  "hardware": {
    "device": "cpu",
    "cuda_available": false,
    "gpu_name": null,
    "vram_allocated_mb": null,
    "vram_total_mb": null
  },
  "model": {
    "name": "yolov8n-pose.pt",
    "loaded": true,
    "load_duration_ms": 520.1,
    "warmup_duration_ms": 85.3
  },
  "activity_recognition": { "enabled": true, "active_sessions": 1, "tracked_people": 1 }
}
```

### `POST /detect`
Accepts a JSON payload containing base64 JPEG image bytes, and returns the pose result with a `track_id`
and an `activity` for every person.

**Example Request** (everything but `imageBase64` is optional):
```json
{
  "imageBase64": "/9j/4AAQSkZJRg...",
  "mimeType": "image/jpeg",
  "confThreshold": 0.35,
  "keypointThreshold": 0.40,
  "sessionId": "pose-6f1c…",
  "trackActivity": true,
  "resetTracking": false,
  "includeAnnotated": false
}
```

| Field | Meaning |
|-------|---------|
| `sessionId` | Frames sharing an id are **one video**: people are tracked and movement judged across them. `[A-Za-z0-9_.:-]{1,64}`; a different id (or none) keeps a separate history. Send consecutive frames of one camera with one id. |
| `trackActivity` | `false` analyses this frame **alone** — no tracking, no history (used for the dashboard's synthetic test frame, so a one-off image never pollutes the live camera's history). |
| `resetTracking` | `true` forgets this session's tracks and history before analysing. |
| `includeAnnotated` | `true` also returns `annotated_image_base64` (the skeleton overlay) in the same response, so one request = one inference instead of two. |

**Example Response:**
```json
{
  "ok": true,
  "person_count": 1,
  "persons": [
    {
      "person_id": 0,
      "track_id": 1,
      "bbox": { "x1": 210.0, "y1": 80.0, "x2": 430.0, "y2": 450.0, "width": 220.0, "height": 370.0 },
      "bbox_confidence": 0.912,
      "visible_keypoints": 16,
      "total_keypoints": 17,
      "keypoints": [
        { "id": 0, "name": "nose", "x": 320.5, "y": 110.2, "confidence": 0.94, "visible": true },
        { "id": 5, "name": "left_shoulder", "x": 270.0, "y": 160.0, "confidence": 0.91, "visible": true },
        { "id": 6, "name": "right_shoulder", "x": 370.0, "y": 160.0, "confidence": 0.90, "visible": true }
      ],
      "activity": {
        "track_id": 1,
        "label": "Walking",
        "confidence": 0.954,
        "confirmed": true,
        "candidate_label": "Walking",
        "previous_label": "Standing",
        "duration_s": 4.0,
        "body_visibility": 1.0,
        "visibility_mode": "full_body",
        "detection_quality": "good",
        "quality_score": 0.967,
        "tracking_status": "tracking",
        "observations": 12,
        "inactive_s": null,
        "note": null,
        "missing_regions": [],
        "evidence": { "posture": "upright", "speed_tl_s": 1.42, "gait_cue": "unavailable (frame rate too low to see steps)" }
      }
    }
  ],
  "image_width": 640,
  "image_height": 480,
  "inference_time_ms": 26.4,
  "total_time_ms": 31.8,
  "device": "cpu",
  "model": "yolov8n-pose.pt",
  "activity_recognition": {
    "enabled": true, "tracking": true, "session_id": "pose-6f1c…",
    "persons_analyzed": 1, "persons_skipped": 0, "lost_tracks": []
  }
}
```

`activity` fields: `label` is what is shown, `candidate_label` what this frame alone suggests;
`confidence` is a heuristic score in 0–1 and is **`null`** whenever nothing is claimed
(`Partial Body Detected`, `Insufficient Visibility`, `Unknown Activity`); `tracking_status` is
`untracked` / `initializing` / `tracking` / `reacquired`; `inactive_s` is non-null only while lying;
`evidence` is free-form diagnostics and no client should depend on its keys.

`activity` is `null` and `activity_recognition.error` is set if the activity layer fails — the pose result
is still returned. `activity_recognition` is `{"enabled": false}` when `HAR_ENABLED=false`.

**Status codes:** `400` unreadable frame · `413` larger than 10 MB · `422` invalid `sessionId` or threshold ·
`500` inference failure · `503` the model failed to load.

### `POST /detect/file`
Multipart upload version of `/detect`; takes `session_id` and `track_activity` as query parameters.

### `POST /detect/visualize`
Accepts a JSON base64 image or multipart file and returns the annotated JPEG image with rendered bounding boxes, skeleton bones, and keypoint dots (`image/jpeg`). The banner shows the activity when one is attached.

**This endpoint is stateless**: it never updates tracking, so calling it does not count a frame twice.
To get the overlay *and* the activity from a single inference, use `/detect` with `includeAnnotated: true`.

---

## 8. Frontend Integration

In the Surveillance Dashboard:
1. Open the sidebar and click **Pose Estimation** (tab id: `pose`).
2. The persistent live camera feed appears in the left panel.
3. Click **Analyze Current Frame** to capture a still from the live video element and detect body keypoints.
4. Or click **Test Sample Frame** to test detection using a synthetic human test image even if the physical camera is offline.
5. The right panel displays the rendered skeleton overlay and an interactive 17-point keypoint coordinate table.
6. The **Human Activity Recognition** section below shows, per person: the activity and whether it is
   confirmed, its confidence, body visibility, detection quality, how long it has lasted, the previous
   activity, and the tracking status.

The page captures frames from the **existing shared camera element** with an off-screen canvas and opens no
second stream to the ESP32-CAM. Each page visit gets its own `sessionId`, and **Test Sample Frame** is sent
with `trackActivity: false` so it never joins the live camera's history.

**Walking and running need several frames.** In `Manual` mode a single frame can only show posture, so a
still person reads as a provisional `Standing` with the note saying movement was not assessed. Use
`1 FPS` or `2 FPS` to let the service judge movement; `2 FPS` is the only rate at which the leg-alternation
cue is close to usable.

### Keeping the contract honest

`frontend/tests/fixtures/*.json` are **real recorded responses of this service**. Regenerate them whenever
the response format changes:

```bash
python activity-recognition/export_contract_fixtures.py
```

The dashboard's tests parse those files with the same validator that parses live responses, and
`test_contract_fixtures.py` fails if the stored files (or `frontend/src/types/pose.ts`) drift from what the
service actually produces.

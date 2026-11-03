# RC Surveillance Robot

A surveillance dashboard for an RC robot with an ESP32-CAM: live MJPEG video, snapshots, browser-side motion detection, AI scene description (Groq), pose estimation and activity recognition (YOLOv8 pose), event history, diagnostics and settings.

> **This is a surveillance application, not a driving application.** Motor control, steering, firmware and remote driving are not implemented.

This project is part of the [WebVerse](../README.md) repository. Like the other WebVerse projects it is independent: it has its own dependencies, its own build and its own deployment.

## What is in this folder

| Folder | What it is |
| --- | --- |
| [`frontend/`](./frontend/) | The dashboard (React 19, TypeScript, Vite, Tailwind CSS) and, in `frontend/server/`, the small Node backend that holds the Groq key and calls Groq. |
| [`activity-recognition/`](./activity-recognition/) | The Python FastAPI service for pose estimation and activity recognition. Runs the YOLOv8-pose model (`yolov8n-pose.pt`, included) on your own computer. |
| [`ACTIVITY_RECOGNITION_REPORT.md`](./ACTIVITY_RECOGNITION_REPORT.md) | Report on the activity-recognition work. |

The detailed guides are [`frontend/README.md`](./frontend/README.md) (camera setup, diagnostics, motion detection, Groq, hardware guidelines) and [`activity-recognition/README.md`](./activity-recognition/README.md) (the pose service).

## Two ways to run it

The camera is on your private network, so a website on the internet cannot see it. The project therefore has two clearly separate modes.

| | Mode A: Public demo | Mode B: Local Hardware Mode |
| --- | --- | --- |
| Where | Hosted on the web (`npm run build:demo`) | On your computer, on the same network as the ESP32-CAM |
| Robot / camera | None. The page says **"Public demo: no robot is connected"** | Your real ESP32-CAM (or the included mock camera for testing) |
| AI description (Groq) | Not available | Node backend on `127.0.0.1:8787`, with your key in a local `.env` |
| Pose / activity | Not available | Python service on `127.0.0.1:8000` |
| Secrets | None. The demo is static files only | `GROQ_API_KEY`, server side only |

The hosted demo does not claim a live connection and has no backend. It cannot reach a camera at an address like `http://192.168.1.100`: a page served over HTTPS may not load unencrypted HTTP content (mixed content), and the camera is not reachable from the internet. Nothing in this repository makes the physical robot remotely accessible.

## Mode B: run it locally with the robot

Prerequisites: Node.js 20.19 or newer (22 recommended), Python 3.10 or newer, a Groq API key only if you want AI descriptions.

```bash
cd frontend
npm install
```

Copy the example settings and add your key. `.env` is git-ignored; never commit it.

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Edit `.env`: set `GROQ_API_KEY` and the camera address (`VITE_CAMERA_BASE_URL`, for example `http://192.168.1.100`). Keep `AI_SERVER_PORT=8787`: port 3000 is the dashboard itself.

Start the three parts, each in its own terminal:

```bash
# 1. AI backend (Groq) on 127.0.0.1:8787, from the frontend folder
npm run server
```

```bash
# 2. Dashboard on http://localhost:3000, from the frontend folder
npm run dev
```

```bash
# 3. Pose and activity service on 127.0.0.1:8000, from this project folder
pip install -r activity-recognition/requirements.txt
python activity-recognition/run_service.py
```

Then open http://localhost:3000 and set the camera stream path in Settings (it stays empty until you confirm your firmware's route; see [`frontend/README.md`](./frontend/README.md), section 6). Open the dashboard from `http://localhost:3000`, not from an HTTPS address.

To try everything without hardware or a Groq key, the project ships mocks: `frontend/tools/mock-esp32-cam` (a fake camera) and `frontend/tools/mock-groq` (a fake Groq that returns canned answers). See `frontend/README.md`, sections 12 and 16.

## Mode A: deploy the public demo

The demo is the dashboard built with `npm run build:demo` (`vite build --mode demo`). It is a static site: no server, no secrets. In this build the camera address starts empty, `VITE_CAMERA_BASE_URL` is ignored, and the dashboard shows the demo notice.

Deploy it as its own project (on Vercel, for example):

1. Import the `Tech-pranav-21/WebVerse` repository as a new project.
2. Set **Root Directory** to `RC Surveillance Robot/frontend`.
3. Leave the build settings to [`frontend/vercel.json`](./frontend/vercel.json): install `npm ci`, build `npm run build:demo`, output `dist`.
4. Use Node.js 20.19 or newer (22.x) in the project settings.
5. Add **no** environment variables. In particular never add `GROQ_API_KEY` or a camera address here.
6. Deploy, then open the URL. You should see "Public demo: no robot is connected" above a camera that says "Not configured".

To check the demo locally first: `cd frontend && npm run build:demo && npm run preview`.

## Environment variables

| Variable | Read by | Meaning | Default |
| --- | --- | --- | --- |
| `VITE_CAMERA_BASE_URL` | dashboard (build time) | Camera address. Written into the page, so never set it for a public build (the demo build ignores it). | `http://192.168.1.100` |
| `VITE_CAMERA_STREAM_PATH` | dashboard (build time) | Stream route, e.g. `:81/stream`. | empty (unconfirmed) |
| `VITE_CAMERA_SNAPSHOT_PATH` | dashboard (build time) | Snapshot route. | `/capture` |
| `GROQ_API_KEY` | Node backend only | Groq key. Never exposed to the browser. Empty keeps AI off. | empty |
| `GROQ_MODEL` | Node backend | Groq vision model. | `qwen/qwen3.8-27b` |
| `GROQ_API_BASE_URL` | Node backend | For testing with the mock only. | `https://api.groq.com/openai/v1` |
| `AI_SERVER_HOST` / `AI_SERVER_PORT` | Node backend; the port also by the Vite proxy | Where the backend listens. Keep the host on loopback. | `127.0.0.1` / `8787` |
| `AI_RATE_PER_MINUTE`, `AI_MAX_PER_DAY`, `AI_MAX_CONCURRENT` | Node backend | Limits that protect your Groq quota. | `6`, `100`, `1` |
| `AI_MAX_IMAGE_BYTES`, `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES` | Node backend | Size, timeout and retry limits. | `1500000`, `20000`, `1` |
| `AI_ALLOWED_ORIGINS` | Node backend | Extra browser origins allowed to call it. Pages on localhost are always allowed. | empty |
| `POSE_SERVICE_HOST` / `POSE_SERVICE_PORT` | Python service; the port also by the Vite proxy | Where the pose service listens. | `127.0.0.1` / `8000` |
| `POSE_ALLOWED_ORIGINS` | Python service | Extra browser origins allowed to call it. Pages on localhost are always allowed; `*` is ignored. | empty |
| `POSE_DEVICE`, `POSE_MODEL_NAME`, `POSE_*_THRESHOLD`, `HAR_*` | Python service | Device, model and tuning values. See [`activity-recognition/config.py`](./activity-recognition/config.py). | see file |

The Node backend reads a `.env` file in the folder it is started from. The Python service reads only real environment variables. [`frontend/.env.example`](./frontend/.env.example) documents all of them.

## Security notes

- `GROQ_API_KEY` lives only in the Node backend. It has no `VITE_` prefix, so Vite never puts it into the web page. Never rename it.
- `.env` files are git-ignored. Only `.env.example` files are committed.
- Both backends accept browser requests only from pages served from your own machine (plus origins you list explicitly). Neither answers with a wildcard origin.
- Both backends listen on `127.0.0.1` by default. `npm run dev` listens on all interfaces (the dashboard can then be opened from another device), and its `/api` proxy forwards to the loopback backends, so anyone on your network who can reach port 3000 can use them. On a network you do not trust, run `npx vite --port 3000 --host 127.0.0.1` instead.
- Do not put the Node backend or the pose service on a public address. They have no login, and the Groq backend spends your quota.

## Tests

```bash
cd frontend && npm run lint && npm test                          # type checks and 842 unit tests
cd activity-recognition && python -m unittest discover -p "test_*.py"   # 200 Python tests (they run the real model)
```

All of these use mocks or local files; no test contacts Groq or a camera. Real Groq inference and a physical ESP32-CAM have not been tested in this repository.

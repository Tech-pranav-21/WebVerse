# Setup guide

## Prerequisites

- Node.js `>=20.19.0` and npm (the version required by `frontend/package.json`)
- Python 3.10 or newer
- Optional: an ESP32-CAM on the same 2.4 GHz network for live camera use

## Install dependencies

From the repository root:

```powershell
cd "RC Surveillance Robot/frontend"
npm install

cd ../activity-recognition
python -m pip install -r requirements.txt
```

## Configure the environment

Create `frontend/.env` from the tracked example:

```powershell
cd "../frontend"
Copy-Item .env.example .env
```

Set the following values only as needed:

| Variable | Purpose |
| --- | --- |
| `VITE_CAMERA_BASE_URL` | Camera base URL, such as `http://192.168.1.100` |
| `VITE_CAMERA_STREAM_PATH` | Confirmed stream path; leave blank until confirmed |
| `VITE_CAMERA_SNAPSHOT_PATH` | Still-image path, commonly `/capture` |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | Optional provider credentials for the local Node gateway |
| `ACTIVE_AI_PROVIDER` | `groq`, `gemini`, or `openai` when its key is configured |
| `AI_SERVER_PORT` | Node gateway port (default `8787`) |
| `POSE_SERVICE_PORT` | FastAPI port (default `8000`) |

Do not prefix provider keys with `VITE_`: Vite exposes those values to browser code. `.env` is ignored by Git.

## Start the services

Use three terminals:

```powershell
# Terminal 1: frontend/
npm run server

# Terminal 2: frontend/
npm run dev

# Terminal 3: activity-recognition/
python run_service.py
```

Open `http://localhost:3000`. The dashboard can run without the Node or Python service, but AI recognition and pose estimation respectively remain unavailable until their service starts.

## Public demo build

To create the key-free public-demo build:

```powershell
cd "RC Surveillance Robot/frontend"
npm run build:demo
```

Demo mode intentionally starts without a local camera and does not need provider keys. Do not add a private camera address or API key to a published demo build.

## Troubleshooting

- **No stream:** confirm the ESP32-CAM address and its actual stream path in Settings. Common firmware uses `:81/stream`, but verify it for the installed sketch.
- **Stream visible but no snapshots, motion, pose, or AI:** the browser cannot read cross-origin pixels. Configure CORS in the camera firmware, or use the normal view-only stream.
- **AI backend offline:** start `npm run server`, then confirm a key exists for the selected provider in `frontend/.env`.
- **Pose service offline:** start `python run_service.py`; verify that port `8000` is unused, or set `POSE_SERVICE_PORT` consistently for both the service and frontend.
- **Dashboard cannot reach camera from a hosted site:** browsers block an `http://` camera stream on an `https://` page. Use the local `http://localhost:3000` workflow.

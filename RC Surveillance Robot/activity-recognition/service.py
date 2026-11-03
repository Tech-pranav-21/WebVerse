"""
FastAPI HTTP Service for Local Human Pose Detection.
Exposes endpoints for health checks, structured keypoint estimation,
and visual skeleton overlay generation.
"""

import base64
import logging
import re
import time
from typing import Any, Dict, Optional

from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from activity_engine import get_activity_engine
from config import (
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_IOU_THRESHOLD,
    HAR_ENABLED,
    KEYPOINT_CONF_THRESHOLD,
    MAX_IMAGE_BYTES,
    SERVICE_HOST,
    SERVICE_PORT,
)
from model_loader import get_model_manager
from pose_estimator import (
    InvalidImageError,
    ModelNotLoadedError,
    PoseEstimationError,
    annotate_image_bytes,
    estimate_pose,
)

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] %(message)s")
logger = logging.getLogger("pose_service")

# Server startup timestamp
SERVICE_START_TIME = time.time()

# Create FastAPI app
app = FastAPI(
    title="RC Surveillance Robot - Local Human Pose Detection Service",
    description="Local lightweight YOLO human pose-estimation service running on GPU / CPU fallback, "
    "with visibility-aware human activity recognition.",
    version="1.1.0",
)

# Enable CORS for local React/Vite development and dashboard access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Person-Count", "X-Inference-Time-Ms", "X-Device"],
)


class Base64DetectRequest(BaseModel):
    """Payload format matching the existing frontend frame capture."""
    imageBase64: str = Field(..., description="Base64 encoded JPEG or PNG image bytes")
    mimeType: Optional[str] = Field("image/jpeg", description="MIME type of the image")
    confThreshold: Optional[float] = Field(DEFAULT_CONF_THRESHOLD, ge=0.05, le=1.0)
    keypointThreshold: Optional[float] = Field(KEYPOINT_CONF_THRESHOLD, ge=0.05, le=1.0)
    # --- Human activity recognition (all optional: a client that sends none of these still works) ---
    # Pose history is kept per session, so one browser tab (or one test) never mixes with another.
    sessionId: Optional[str] = Field(None, max_length=64, pattern=r"^[A-Za-z0-9_.:\-]+$")
    # False analyses this single frame only: no tracking, no history (used for the synthetic sample frame).
    trackActivity: Optional[bool] = True
    # True forgets this session's tracks and history before analysing the frame.
    resetTracking: Optional[bool] = False
    # True also returns the skeleton overlay as base64 JPEG, so one request (one inference) does both jobs.
    includeAnnotated: Optional[bool] = False


@app.on_event("startup")
async def startup_event() -> None:
    """Preloads the model on startup so requests incur no cold-start delay."""
    logger.info("Initializing Pose Estimation Service...")
    manager = get_model_manager()
    status_dict = manager.get_status()
    logger.info(
        "Service started. Model: %s | Device: %s | CUDA Available: %s | Loaded: %s",
        status_dict["model_name"],
        status_dict["device"],
        status_dict["cuda_available"],
        status_dict["loaded"],
    )


@app.get("/", summary="Service Index")
async def root() -> Dict[str, Any]:
    return {
        "service": "rc-surveillance-pose-detection",
        "version": "1.0.0",
        "status": "online",
        "docs_url": "/docs",
        "health_url": "/health",
    }


@app.get("/health", summary="Health Check and Diagnostics")
async def health() -> Dict[str, Any]:
    """Returns runtime health, model state, hardware device, and VRAM utilization."""
    manager = get_model_manager()
    status_info = manager.get_status()
    uptime_sec = round(time.time() - SERVICE_START_TIME, 1)

    return {
        "ok": status_info["loaded"],
        "status": "ready" if status_info["loaded"] else "model_not_loaded",
        "uptime_seconds": uptime_sec,
        "service": "activity-recognition",
        "hardware": {
            "device": status_info["device"],
            "cuda_available": status_info["cuda_available"],
            "gpu_name": status_info["gpu_name"],
            "vram_allocated_mb": status_info.get("vram_allocated_mb"),
            "vram_total_mb": status_info.get("vram_total_mb"),
        },
        "model": {
            "name": status_info["model_name"],
            "loaded": status_info["loaded"],
            "load_duration_ms": status_info["load_duration_ms"],
            "warmup_duration_ms": status_info["warmup_duration_ms"],
        },
        "activity_recognition": {
            "enabled": HAR_ENABLED,
            **(get_activity_engine().stats() if HAR_ENABLED else {}),
        },
    }


def _extract_image_bytes(request: Request, body: Optional[Base64DetectRequest] = None) -> bytes:
    """Helper to extract raw bytes from a base64 request."""
    if not body or not body.imageBase64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing 'imageBase64' field in request body.",
        )

    clean_b64 = body.imageBase64.strip()
    # Strip data URL prefix if sent (e.g. data:image/jpeg;base64,...)
    if "," in clean_b64:
        clean_b64 = clean_b64.split(",", 1)[1]

    try:
        raw_bytes = base64.b64decode(clean_b64)
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Malformed base64 image data: {str(err)}",
        )

    if len(raw_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image size ({len(raw_bytes)} bytes) exceeds limit of {MAX_IMAGE_BYTES} bytes.",
        )

    return raw_bytes


def _attach_activity(results: Dict[str, Any], session_id: Optional[str], track: bool, reset: bool) -> None:
    """
    Add tracking ids and activities to a pose result. Activity recognition is an add-on: if it is switched
    off or fails, the pose result is still returned and says so in ``activity_recognition``.
    """
    if not HAR_ENABLED:
        results["activity_recognition"] = {"enabled": False}
        return
    try:
        get_activity_engine().attach(results, session_id or "default", track=track, reset=reset)
    except Exception as err:  # noqa: BLE001 - the pose result must survive any activity-layer bug
        logger.error("Activity recognition failed: %s", err, exc_info=True)
        for person in results.get("persons", []):
            person.setdefault("track_id", None)
            person.setdefault("activity", None)
        results["activity_recognition"] = {"enabled": True, "error": f"Activity recognition failed: {err}"}


@app.post("/detect", summary="Detect People & Body Keypoints (JSON Base64)")
async def detect_base64(payload: Base64DetectRequest) -> Dict[str, Any]:
    """
    Accepts a base64 image and returns structured human pose detection results, plus (per person) a
    stable tracking id and the recognised activity. Send the same ``sessionId`` with consecutive frames of
    one camera so walking / running / inactivity can be judged over time.
    """
    image_bytes = _extract_image_bytes(None, payload)
    try:
        results = estimate_pose(
            image_bytes,
            conf_threshold=payload.confThreshold or DEFAULT_CONF_THRESHOLD,
            keypoint_conf_threshold=payload.keypointThreshold or KEYPOINT_CONF_THRESHOLD,
        )
        _attach_activity(results, payload.sessionId, payload.trackActivity is not False, bool(payload.resetTracking))
        if payload.includeAnnotated:
            annotated = annotate_image_bytes(image_bytes, results)
            results["annotated_image_base64"] = base64.b64encode(annotated).decode("ascii")
        return results
    except InvalidImageError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except ModelNotLoadedError as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err))
    except PoseEstimationError as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err))


@app.post("/detect/file", summary="Detect People & Body Keypoints (Multipart File)")
async def detect_file(
    file: UploadFile = File(..., description="JPEG or PNG image file"),
    conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    keypoint_threshold: float = KEYPOINT_CONF_THRESHOLD,
    session_id: Optional[str] = None,
    track_activity: bool = True,
) -> Dict[str, Any]:
    """
    Accepts a multipart file upload and returns structured human pose detection results (with activity,
    like ``/detect``).
    """
    image_bytes = await file.read()
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Uploaded file exceeds 10 MB limit.",
        )
    if session_id is not None and not re.fullmatch(r"[A-Za-z0-9_.:\-]{1,64}", session_id):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid session_id.")

    try:
        results = estimate_pose(
            image_bytes,
            conf_threshold=conf_threshold,
            keypoint_conf_threshold=keypoint_threshold,
        )
        _attach_activity(results, session_id, track_activity, False)
        return results
    except InvalidImageError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except ModelNotLoadedError as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err))
    except PoseEstimationError as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err))


@app.post("/detect/visualize", summary="Render Annotated Pose Image (JSON Base64)")
async def detect_visualize_base64(payload: Base64DetectRequest) -> Response:
    """
    Detects human pose and returns the annotated JPEG image with skeleton overlay.
    Stateless: it never updates activity tracking (a frame must not be counted twice).
    """
    image_bytes = _extract_image_bytes(None, payload)
    try:
        results = estimate_pose(
            image_bytes,
            conf_threshold=payload.confThreshold or DEFAULT_CONF_THRESHOLD,
            keypoint_conf_threshold=payload.keypointThreshold or KEYPOINT_CONF_THRESHOLD,
        )
        annotated_jpeg = annotate_image_bytes(image_bytes, results)
        return Response(
            content=annotated_jpeg,
            media_type="image/jpeg",
            headers={
                "X-Person-Count": str(results.get("person_count", 0)),
                "X-Inference-Time-Ms": str(results.get("inference_time_ms", 0)),
                "X-Device": str(results.get("device", "unknown")),
            },
        )
    except InvalidImageError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except ModelNotLoadedError as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err))
    except PoseEstimationError as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err))


@app.post("/detect/visualize/file", summary="Render Annotated Pose Image (Multipart File)")
async def detect_visualize_file(
    file: UploadFile = File(..., description="JPEG or PNG image file"),
    conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    keypoint_threshold: float = KEYPOINT_CONF_THRESHOLD,
) -> Response:
    """
    Multipart upload version of visual skeleton rendering.
    """
    image_bytes = await file.read()
    try:
        results = estimate_pose(
            image_bytes,
            conf_threshold=conf_threshold,
            keypoint_conf_threshold=keypoint_threshold,
        )
        annotated_jpeg = annotate_image_bytes(image_bytes, results)
        return Response(
            content=annotated_jpeg,
            media_type="image/jpeg",
            headers={
                "X-Person-Count": str(results.get("person_count", 0)),
                "X-Inference-Time-Ms": str(results.get("inference_time_ms", 0)),
                "X-Device": str(results.get("device", "unknown")),
            },
        )
    except InvalidImageError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except ModelNotLoadedError as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err))
    except PoseEstimationError as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(err))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("service:app", host=SERVICE_HOST, port=SERVICE_PORT, reload=False, access_log=True)

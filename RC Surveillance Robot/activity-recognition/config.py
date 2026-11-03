"""
Configuration for Local Human Pose Detection Service.
Defines model parameters, thresholds, device settings, and server options.
"""

import os
os.environ["YOLO_AUTOINSTALL"] = "0"
os.environ["YOLO_VERBOSE"] = "False"

from typing import Dict, List, Tuple

# Service server configuration
SERVICE_HOST: str = os.getenv("POSE_SERVICE_HOST", "127.0.0.1")
SERVICE_PORT: int = int(os.getenv("POSE_SERVICE_PORT", "8000"))

# Model configuration
# yolov8n-pose: ~6.5 MB, 3.2M params, 8.9 GFLOPs (COCO Keypoints 17)
# License: AGPL-3.0 (Ultralytics)
# Optimized for edge devices and GPUs with <= 4 GB VRAM (RTX 2050 consumes < 800 MB VRAM)
_MODEL_FILENAME = os.getenv("POSE_MODEL_NAME", "yolov8n-pose.pt")
DEFAULT_MODEL_NAME: str = (
    _MODEL_FILENAME
    if os.path.isabs(_MODEL_FILENAME)
    else os.path.join(os.path.dirname(os.path.abspath(__file__)), _MODEL_FILENAME)
)

# Detection and keypoint thresholds
DEFAULT_CONF_THRESHOLD: float = float(os.getenv("POSE_CONF_THRESHOLD", "0.35"))
DEFAULT_IOU_THRESHOLD: float = float(os.getenv("POSE_IOU_THRESHOLD", "0.45"))
KEYPOINT_CONF_THRESHOLD: float = float(os.getenv("POSE_KEYPOINT_CONF_THRESHOLD", "0.40"))

# Hardware / Device configuration
# Options: 'auto' (cuda if available, else cpu), 'cuda', 'cpu'
FORCE_DEVICE: str = os.getenv("POSE_DEVICE", "auto").lower()

# Maximum payload size in bytes (10 MB)
MAX_IMAGE_BYTES: int = 10 * 1024 * 1024


# ---------------------------------------------------------------------------
# Human Activity Recognition (HAR)
# Every value can be overridden with an environment variable of the same name. An unparsable value
# falls back to the default instead of stopping the service from starting.
# ---------------------------------------------------------------------------

def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(float(os.getenv(name, default)))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


HAR_ENABLED: bool = _env_bool("HAR_ENABLED", True)

# --- Keypoint quality / body visibility ---
# A keypoint only counts as evidence when its confidence reaches this value (stricter than the
# display threshold above, because a wrong skeleton joint here becomes a wrong activity).
HAR_KEYPOINT_MIN_CONF: float = _env_float("HAR_KEYPOINT_MIN_CONF", 0.50)
# A person whose bounding box is smaller than this (pixels, largest side) is too small / far to classify.
HAR_MIN_PERSON_SIZE_PX: float = _env_float("HAR_MIN_PERSON_SIZE_PX", 40.0)
# Share of the (weighted) body that must be visible before anything is classified.
HAR_MIN_VISIBILITY: float = _env_float("HAR_MIN_VISIBILITY", 0.25)
HAR_MIN_RELIABLE_KEYPOINTS: int = _env_int("HAR_MIN_RELIABLE_KEYPOINTS", 5)
# Detection-quality score cut-offs (0..1): Good >= GOOD, Medium >= MEDIUM, Poor >= POOR, else Insufficient.
HAR_QUALITY_GOOD: float = _env_float("HAR_QUALITY_GOOD", 0.80)
HAR_QUALITY_MEDIUM: float = _env_float("HAR_QUALITY_MEDIUM", 0.60)
HAR_QUALITY_POOR: float = _env_float("HAR_QUALITY_POOR", 0.40)

# --- Person tracking ---
# A track that is not matched for this long (seconds) is dropped and its history discarded.
HAR_TRACK_MAX_AGE_S: float = _env_float("HAR_TRACK_MAX_AGE_S", 5.0)
HAR_MAX_TRACKED_PERSONS: int = _env_int("HAR_MAX_TRACKED_PERSONS", 5)
# Independent tracker state per client session; idle sessions expire.
HAR_MAX_SESSIONS: int = _env_int("HAR_MAX_SESSIONS", 8)
HAR_SESSION_TTL_S: float = _env_float("HAR_SESSION_TTL_S", 300.0)
# Bounded pose history per person (frames AND seconds, whichever is hit first).
HAR_HISTORY_MAX_FRAMES: int = _env_int("HAR_HISTORY_MAX_FRAMES", 40)
HAR_HISTORY_MAX_S: float = _env_float("HAR_HISTORY_MAX_S", 20.0)

# --- Motion (speeds are in torso lengths per second, so they do not depend on how far away the person is) ---
HAR_MOTION_WINDOW_S: float = _env_float("HAR_MOTION_WINDOW_S", 4.0)
HAR_MIN_MOTION_SPAN_S: float = _env_float("HAR_MIN_MOTION_SPAN_S", 1.0)
HAR_SPEED_STATIONARY_MAX: float = _env_float("HAR_SPEED_STATIONARY_MAX", 0.5)
HAR_SPEED_WALK_MIN: float = _env_float("HAR_SPEED_WALK_MIN", 0.9)
HAR_SPEED_RUN_MIN: float = _env_float("HAR_SPEED_RUN_MIN", 4.6)
# Leg alternation is only trustworthy when frames arrive fast enough to sample a step cycle.
HAR_GAIT_MIN_FPS: float = _env_float("HAR_GAIT_MIN_FPS", 4.0)

# --- Confirmation / smoothing ---
# A new activity must be the candidate in this many consecutive observations AND for this many seconds.
HAR_CONFIRM_FRAMES: int = _env_int("HAR_CONFIRM_FRAMES", 3)
HAR_MIN_CONFIRM_S: float = _env_float("HAR_MIN_CONFIRM_S", 1.5)
# A confirmed activity is forgotten after this long without usable evidence.
HAR_STALE_ACTIVITY_S: float = _env_float("HAR_STALE_ACTIVITY_S", 6.0)

# --- Inactivity / possible sleeping ---
HAR_INACTIVE_MOTION_MAX: float = _env_float("HAR_INACTIVE_MOTION_MAX", 0.35)
HAR_PROLONGED_INACTIVITY_S: float = _env_float("HAR_PROLONGED_INACTIVITY_S", 15.0)
HAR_SLEEP_MIN_INACTIVITY_S: float = _env_float("HAR_SLEEP_MIN_INACTIVITY_S", 60.0)
# Share of the lying period that must be backed by good-quality full-body evidence.
HAR_SLEEP_MIN_EVIDENCE_RATIO: float = _env_float("HAR_SLEEP_MIN_EVIDENCE_RATIO", 0.70)

# COCO 17 keypoint definitions
KEYPOINT_NAMES: List[str] = [
    "nose",            # 0
    "left_eye",        # 1
    "right_eye",       # 2
    "left_ear",        # 3
    "right_ear",       # 4
    "left_shoulder",   # 5
    "right_shoulder",  # 6
    "left_elbow",      # 7
    "right_elbow",     # 8
    "left_wrist",      # 9
    "right_wrist",     # 10
    "left_hip",        # 11
    "right_hip",       # 12
    "left_knee",       # 13
    "right_knee",      # 14
    "left_ankle",      # 15
    "right_ankle",     # 16
]

# Skeleton connections (pairs of keypoint indices) for rendering human pose
SKELETON_PAIRS: List[Tuple[int, int]] = [
    (0, 1), (0, 2), (1, 3), (2, 4),      # Facial keypoints
    (5, 6),                              # Shoulders
    (5, 7), (7, 9),                      # Left arm
    (6, 8), (8, 10),                     # Right arm
    (5, 11), (6, 12),                    # Torso sides
    (11, 12),                            # Hips
    (11, 13), (13, 15),                  # Left leg
    (12, 14), (14, 16),                  # Right leg
]

# Color map for visualization (BGR format for OpenCV / Pillow RGB)
KEYPOINT_COLORS: Dict[str, Tuple[int, int, int]] = {
    "facial": (255, 128, 0),    # Orange
    "left_limb": (0, 255, 128), # Mint green
    "right_limb": (0, 128, 255),# Blue-cyan
    "torso": (255, 0, 128),     # Pink/Magenta
    "default": (0, 255, 255),   # Yellow
}

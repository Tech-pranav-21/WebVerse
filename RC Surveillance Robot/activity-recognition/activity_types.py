"""
Shared vocabulary for Human Activity Recognition (HAR).

The label strings, visibility modes, quality levels and the field list of the per-person
``activity`` object are the API contract with the dashboard. ``frontend/src/types/pose.ts`` mirrors
them, and a contract test compares the two, so change both together.
"""

from dataclasses import dataclass
from typing import Tuple

import config as _cfg

# --- Activity labels -------------------------------------------------------
STANDING = "Standing"
SITTING = "Sitting"
WALKING = "Walking"
RUNNING = "Running"
BENDING = "Bending"
LYING_DOWN = "Lying Down"
PROLONGED_INACTIVITY = "Prolonged Inactivity"
POSSIBLE_SLEEPING = "Possible Sleeping"
# Upper-body mode (legs not visible)
RAISING_HANDS = "Raising Hands"
ARM_MOVEMENT = "Arm Movement"
UPPER_BODY_BENDING = "Upper Body Bending"
UPPER_BODY_INACTIVITY = "Upper Body Inactivity"
# States that are NOT activities: they say why no activity is claimed.
PARTIAL_BODY = "Partial Body Detected"
INSUFFICIENT_VISIBILITY = "Insufficient Visibility"
UNKNOWN = "Unknown Activity"

ACTIVITY_LABELS: Tuple[str, ...] = (
    STANDING, SITTING, WALKING, RUNNING, BENDING, LYING_DOWN,
    PROLONGED_INACTIVITY, POSSIBLE_SLEEPING,
    RAISING_HANDS, ARM_MOVEMENT, UPPER_BODY_BENDING, UPPER_BODY_INACTIVITY,
    PARTIAL_BODY, INSUFFICIENT_VISIBILITY, UNKNOWN,
)

# Labels that describe the person's visibility rather than what they are doing.
NO_EVIDENCE_LABELS: Tuple[str, ...] = (PARTIAL_BODY, INSUFFICIENT_VISIBILITY)

# --- Body-visibility modes -------------------------------------------------
MODE_FULL = "full_body"
MODE_UPPER = "upper_body"
MODE_PARTIAL = "partial"
MODE_INSUFFICIENT = "insufficient"
VISIBILITY_MODES: Tuple[str, ...] = (MODE_FULL, MODE_UPPER, MODE_PARTIAL, MODE_INSUFFICIENT)

# --- Detection quality -----------------------------------------------------
QUALITY_GOOD = "good"
QUALITY_MEDIUM = "medium"
QUALITY_POOR = "poor"
QUALITY_INSUFFICIENT = "insufficient"
QUALITY_LEVELS: Tuple[str, ...] = (QUALITY_GOOD, QUALITY_MEDIUM, QUALITY_POOR, QUALITY_INSUFFICIENT)

# --- Tracking status -------------------------------------------------------
TRACK_UNTRACKED = "untracked"          # tracking disabled for this request (single frame)
TRACK_INITIALIZING = "initializing"    # too few observations yet
TRACK_TRACKING = "tracking"
TRACK_REACQUIRED = "reacquired"        # matched again after the person was missing
TRACKING_STATUSES: Tuple[str, ...] = (TRACK_UNTRACKED, TRACK_INITIALIZING, TRACK_TRACKING, TRACK_REACQUIRED)

# Fields of the per-person ``activity`` object, in response order.
ACTIVITY_FIELDS: Tuple[str, ...] = (
    "track_id",
    "label",
    "confidence",
    "confirmed",
    "candidate_label",
    "previous_label",
    "duration_s",
    "body_visibility",
    "visibility_mode",
    "detection_quality",
    "quality_score",
    "tracking_status",
    "observations",
    "inactive_s",
    "note",
    "missing_regions",
    "evidence",
)


@dataclass(frozen=True)
class ActivityConfig:
    """Every tunable of the activity pipeline. Defaults come from ``config.py`` (environment variables)."""

    # Keypoint quality / visibility
    keypoint_min_conf: float = _cfg.HAR_KEYPOINT_MIN_CONF
    border_margin_px: float = 2.0
    min_person_size_px: float = _cfg.HAR_MIN_PERSON_SIZE_PX
    min_visibility: float = _cfg.HAR_MIN_VISIBILITY
    min_reliable_keypoints: int = _cfg.HAR_MIN_RELIABLE_KEYPOINTS
    quality_good: float = _cfg.HAR_QUALITY_GOOD
    quality_medium: float = _cfg.HAR_QUALITY_MEDIUM
    quality_poor: float = _cfg.HAR_QUALITY_POOR

    # Static posture
    posture_min_score: float = 0.45
    posture_min_margin: float = 0.15

    # Tracking
    track_max_age_s: float = _cfg.HAR_TRACK_MAX_AGE_S
    track_gate_base: float = 0.6        # body heights a person may jump regardless of time (box jitter)
    track_gate_per_s: float = 3.0       # extra allowance per second (a sprint covers ~3 body heights/s)
    track_max_size_ratio: float = 3.0
    max_tracked_persons: int = _cfg.HAR_MAX_TRACKED_PERSONS
    max_tracks: int = 20                # alive tracks per session, including recently lost ones
    max_sessions: int = _cfg.HAR_MAX_SESSIONS
    session_ttl_s: float = _cfg.HAR_SESSION_TTL_S
    history_max_frames: int = _cfg.HAR_HISTORY_MAX_FRAMES
    history_max_s: float = _cfg.HAR_HISTORY_MAX_S
    # Frames closer together than this replace the previous observation instead of adding one.
    min_dt_s: float = 0.05

    # Motion
    motion_window_s: float = _cfg.HAR_MOTION_WINDOW_S
    min_motion_span_s: float = _cfg.HAR_MIN_MOTION_SPAN_S
    speed_stationary_max: float = _cfg.HAR_SPEED_STATIONARY_MAX
    speed_walk_min: float = _cfg.HAR_SPEED_WALK_MIN
    speed_run_min: float = _cfg.HAR_SPEED_RUN_MIN
    approach_rate_min: float = 0.15     # relative size change per second that means "moving along the camera axis"
    gait_min_fps: float = _cfg.HAR_GAIT_MIN_FPS
    gait_min_alternations_per_s: float = 1.0
    arm_motion_min: float = 0.4         # shoulder-widths per second

    # Confirmation / smoothing
    confirm_frames: int = _cfg.HAR_CONFIRM_FRAMES
    min_confirm_s: float = _cfg.HAR_MIN_CONFIRM_S
    stale_activity_s: float = _cfg.HAR_STALE_ACTIVITY_S

    # Inactivity / possible sleeping
    inactive_motion_max: float = _cfg.HAR_INACTIVE_MOTION_MAX
    inactive_displacement_max: float = 0.30   # torso lengths of pose change between two frames
    prolonged_inactivity_s: float = _cfg.HAR_PROLONGED_INACTIVITY_S
    sleep_min_inactivity_s: float = _cfg.HAR_SLEEP_MIN_INACTIVITY_S
    sleep_min_evidence_ratio: float = _cfg.HAR_SLEEP_MIN_EVIDENCE_RATIO

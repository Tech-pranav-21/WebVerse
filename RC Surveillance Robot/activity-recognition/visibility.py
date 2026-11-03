"""
Adaptive body-visibility assessment.

Decides, per detected person, how much of the body can be trusted and therefore WHICH activities may
be classified at all:

  full_body     torso + at least one complete leg (hip, knee, ankle)  -> Standing, Sitting, Walking, ...
  upper_body    both shoulders, legs not visible                       -> Raising Hands, Arm Movement, ...
  partial       something important is missing                         -> "Partial Body Detected"
  insufficient  too little / too unreliable / too small                -> "Insufficient Visibility"

A keypoint is RELIABLE only if its confidence reaches ``keypoint_min_conf``, it lies inside the image
and it is not clamped to the image border (YOLO pins joints it cannot see to the border; they often
carry a deceptively high confidence). Unreliable keypoints are never used by any later stage.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple

from activity_types import (
    ActivityConfig,
    MODE_FULL,
    MODE_INSUFFICIENT,
    MODE_PARTIAL,
    MODE_UPPER,
    QUALITY_GOOD,
    QUALITY_INSUFFICIENT,
    QUALITY_MEDIUM,
    QUALITY_POOR,
)

# COCO-17 indices
NOSE, L_EYE, R_EYE, L_EAR, R_EAR = 0, 1, 2, 3, 4
L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST = 5, 6, 7, 8, 9, 10
L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE = 11, 12, 13, 14, 15, 16

HEAD_IDS = (NOSE, L_EYE, R_EYE, L_EAR, R_EAR)
SHOULDER_IDS = (L_SHOULDER, R_SHOULDER)
ARM_IDS = (L_ELBOW, R_ELBOW, L_WRIST, R_WRIST)
HIP_IDS = (L_HIP, R_HIP)
# (hip, knee, ankle) per side
LEG_CHAINS: Tuple[Tuple[int, int, int], ...] = ((L_HIP, L_KNEE, L_ANKLE), (R_HIP, R_KNEE, R_ANKLE))

# Not every keypoint is worth the same: the torso and legs decide posture, ears barely matter.
KEYPOINT_WEIGHTS: Dict[int, float] = {
    NOSE: 1.0, L_EYE: 0.5, R_EYE: 0.5, L_EAR: 0.5, R_EAR: 0.5,
    L_SHOULDER: 2.0, R_SHOULDER: 2.0,
    L_ELBOW: 1.5, R_ELBOW: 1.5, L_WRIST: 1.5, R_WRIST: 1.5,
    L_HIP: 2.0, R_HIP: 2.0, L_KNEE: 2.0, R_KNEE: 2.0, L_ANKLE: 2.0, R_ANKLE: 2.0,
}
_TOTAL_WEIGHT = sum(KEYPOINT_WEIGHTS.values())

_QUALITY_RANK = {QUALITY_INSUFFICIENT: 0, QUALITY_POOR: 1, QUALITY_MEDIUM: 2, QUALITY_GOOD: 3}
Point = Tuple[float, float]


@dataclass
class ReliableKeypoints:
    """The trustworthy subset of a person's keypoints: id -> (x, y, confidence)."""

    pts: Dict[int, Tuple[float, float, float]] = field(default_factory=dict)

    def __contains__(self, kp_id: int) -> bool:
        return kp_id in self.pts

    def __len__(self) -> int:
        return len(self.pts)

    def has_all(self, ids: Iterable[int]) -> bool:
        return all(i in self.pts for i in ids)

    def xy(self, kp_id: int) -> Optional[Point]:
        p = self.pts.get(kp_id)
        return (p[0], p[1]) if p else None

    def mid(self, a: int, b: int) -> Optional[Point]:
        """Midpoint of two keypoints, or the one that is reliable, or None."""
        pa, pb = self.xy(a), self.xy(b)
        if pa and pb:
            return ((pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0)
        return pa or pb

    def mean_confidence(self) -> float:
        if not self.pts:
            return 0.0
        return sum(p[2] for p in self.pts.values()) / len(self.pts)

    def complete_legs(self) -> List[Tuple[int, int, int]]:
        """Leg chains (hip, knee, ankle) whose three joints are all reliable."""
        return [chain for chain in LEG_CHAINS if self.has_all(chain)]


@dataclass
class Visibility:
    mode: str
    score: float                    # weighted share of reliable keypoints, 0..1 ("Body Visibility")
    quality: str
    quality_score: float            # 0..1
    mean_confidence: float
    reliable_count: int
    missing_regions: List[str]
    reason: Optional[str]
    keypoints: ReliableKeypoints

    @property
    def has_evidence(self) -> bool:
        """True when an activity may be classified (full or upper body)."""
        return self.mode in (MODE_FULL, MODE_UPPER)


def extract_reliable(person: Dict[str, Any], img_w: float, img_h: float, cfg: ActivityConfig) -> ReliableKeypoints:
    """Keep only keypoints that are confident, inside the image and not pinned to its border."""
    out = ReliableKeypoints()
    margin = cfg.border_margin_px
    for kp in person.get("keypoints") or []:
        try:
            kp_id = int(kp["id"])
            x, y, conf = float(kp["x"]), float(kp["y"]), float(kp["confidence"])
        except (KeyError, TypeError, ValueError):
            continue
        if kp_id not in KEYPOINT_WEIGHTS or conf < cfg.keypoint_min_conf:
            continue
        if x <= 0 and y <= 0:  # YOLO reports (0, 0) for a joint it has no estimate for
            continue
        if img_w > 0 and img_h > 0:
            if x <= margin or y <= margin or x >= img_w - margin or y >= img_h - margin:
                continue
        out.pts[kp_id] = (x, y, conf)
    return out


def _missing_regions(kp: ReliableKeypoints) -> List[str]:
    missing: List[str] = []
    if not any(i in kp for i in HEAD_IDS):
        missing.append("head")
    if not any(i in kp for i in SHOULDER_IDS):
        missing.append("shoulders")
    if not any(i in kp for i in ARM_IDS):
        missing.append("arms")
    if not any(i in kp for i in HIP_IDS):
        missing.append("hips")
    if not kp.complete_legs():
        missing.append("legs")
    return missing


def _edge_hint(bbox: Dict[str, Any], img_w: float, img_h: float, regions: List[str]) -> Optional[str]:
    """Explain missing parts that are most likely cut off by the frame (person very close to the camera)."""
    if img_w <= 0 or img_h <= 0 or not bbox:
        return None
    x1, x2, y2 = float(bbox.get("x1", 0)), float(bbox.get("x2", 0)), float(bbox.get("y2", 0))
    if "legs" in regions and y2 >= img_h - 0.02 * img_h:
        return "the bottom of the frame cuts off the legs, so the person may be very close to the camera"
    if x1 <= 0.02 * img_w or x2 >= img_w - 0.02 * img_w:
        return "the side of the frame cuts the person off"
    return None


def _quality_level(score: float, cfg: ActivityConfig) -> str:
    if score >= cfg.quality_good:
        return QUALITY_GOOD
    if score >= cfg.quality_medium:
        return QUALITY_MEDIUM
    if score >= cfg.quality_poor:
        return QUALITY_POOR
    return QUALITY_INSUFFICIENT


def assess_visibility(person: Dict[str, Any], img_w: float, img_h: float, cfg: ActivityConfig) -> Visibility:
    """Evaluate one detected person (a dict in the format produced by ``estimate_pose``)."""
    kp = extract_reliable(person, img_w, img_h, cfg)
    score = sum(KEYPOINT_WEIGHTS[i] for i in kp.pts) / _TOTAL_WEIGHT
    mean_conf = kp.mean_confidence()
    bbox = person.get("bbox") or {}
    # Size = the largest side of the box, not its height: a person lying down is wide and only ~40 px
    # tall, and a waist-up shot is wider than it is tall.
    extent = max(float(bbox.get("height", 0.0) or 0.0), float(bbox.get("width", 0.0) or 0.0))
    bbox_conf = float(person.get("bbox_confidence", 0.0) or 0.0)
    regions = _missing_regions(kp)

    # Detection quality blends how much is visible, how sure the model is about it and how sure it is
    # about the person at all.
    quality_score = max(0.0, min(1.0, 0.5 * score + 0.3 * mean_conf + 0.2 * bbox_conf))
    quality = _quality_level(quality_score, cfg)

    def result(mode: str, reason: Optional[str], q: str = quality) -> Visibility:
        return Visibility(
            mode=mode, score=score, quality=q, quality_score=quality_score, mean_confidence=mean_conf,
            reliable_count=len(kp), missing_regions=regions, reason=reason, keypoints=kp,
        )

    # 1. Hard floors: nothing sensible can be said about the pose.
    if extent < cfg.min_person_size_px:
        return result(MODE_INSUFFICIENT, "Person is too small or too far away to classify.", QUALITY_INSUFFICIENT)
    if len(kp) < cfg.min_reliable_keypoints:
        return result(MODE_INSUFFICIENT, "Too few reliable body keypoints.", QUALITY_INSUFFICIENT)
    if score < cfg.min_visibility:
        return result(MODE_INSUFFICIENT, "Too little of the body is visible.", QUALITY_INSUFFICIENT)
    if quality == QUALITY_INSUFFICIENT:
        return result(MODE_INSUFFICIENT, "Keypoint confidence is too low.", QUALITY_INSUFFICIENT)

    # 2. Which part of the body can be trusted?
    shoulders = [i for i in SHOULDER_IDS if i in kp]
    hips = [i for i in HIP_IDS if i in kp]
    torso_ok = bool(shoulders) and bool(hips)

    if torso_ok and kp.complete_legs():
        return result(MODE_FULL, None)

    both_shoulders = len(shoulders) == 2
    legs_absent = not any(kp.has_all((hip, knee)) for hip, knee, _ in LEG_CHAINS)
    if both_shoulders and legs_absent:
        reason = "Legs are not visible: only upper-body activities can be classified"
        hint = _edge_hint(bbox, img_w, img_h, regions)
        return result(MODE_UPPER, reason + (f"; {hint}." if hint else "."))

    # 3. Something important is missing: say so instead of guessing.
    parts = [r for r in regions if r in ("shoulders", "hips", "legs")] or regions
    reason = "Partial body: " + ", ".join(parts) + " not clearly visible"
    hint = _edge_hint(bbox, img_w, img_h, regions)
    reason += f"; {hint}." if hint else "."
    return result(MODE_PARTIAL, reason, quality if _QUALITY_RANK[quality] <= 1 else QUALITY_POOR)

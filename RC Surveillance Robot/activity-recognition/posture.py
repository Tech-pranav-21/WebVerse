"""
Static posture classification from the reliable keypoints of ONE frame.

Everything is expressed in ratios and angles, never raw pixels, so a person 80 px or 500 px tall is
judged the same way. Each posture gets a fuzzy membership score in 0..1 (the minimum over its
conditions); the winner must reach ``posture_min_score`` AND beat the runner-up by
``posture_min_margin``, otherwise the posture is "unknown" (an ambiguous pose is not guessed).

Full-body features (y grows downwards in image coordinates):
  torso_angle   angle of hip->shoulder from vertical (0 upright, 90 horizontal)
  leg_angle     angle of hip->ankle from straight down (0 legs vertical, 90 horizontal)
  knee_drop     (knee.y - hip.y) / torso_length   ~0.8 standing, ~0..0.45 sitting
  ankle_drop    (ankle.y - hip.y) / torso_length  ~1.5 standing, ~0.9 sitting, <0.5 squatting
  torso_ratio   torso_length / leg_length          ~0.65 standing; collapses when bending toward the camera

Walking, running and standing-vs-moving are NOT decided here: one still image cannot show movement.
This module only says whether the body is upright, seated, bent or lying.
"""

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from activity_types import ActivityConfig, MODE_FULL, MODE_UPPER
from visibility import (
    L_ANKLE,
    L_EAR,
    L_EYE,
    L_HIP,
    L_SHOULDER,
    L_WRIST,
    NOSE,
    R_ANKLE,
    R_EAR,
    R_EYE,
    R_HIP,
    R_SHOULDER,
    R_WRIST,
    ReliableKeypoints,
)

# Posture kinds
UPRIGHT = "upright"
SITTING = "sitting"
BENDING = "bending"
LYING = "lying"
UPPER_RAISING = "upper_raising"
UPPER_BENDING = "upper_bending"
UPPER_NEUTRAL = "upper_neutral"
POSTURE_UNKNOWN = "unknown"

Point = Tuple[float, float]


@dataclass
class PostureResult:
    kind: str
    score: float                  # membership of the winning posture, 0..1 (0 when unknown)
    margin: float                 # winner minus runner-up
    scores: Dict[str, float] = field(default_factory=dict)
    features: Dict[str, float] = field(default_factory=dict)
    # Geometry the temporal stage needs (all None when it cannot be measured)
    anchor: Optional[Point] = None      # hip midpoint (full) / shoulder midpoint (upper)
    scale: Optional[float] = None       # torso length (full) / shoulder width (upper)
    ankle_sep: Optional[float] = None   # (right ankle x - left ankle x) / torso length
    wrists_rel: Optional[Dict[int, Point]] = None   # upper mode: wrist offsets from the shoulder midpoint / scale


def ramp_up(x: float, a: float, b: float) -> float:
    """Membership that rises from 0 (x <= a) to 1 (x >= b)."""
    if b == a:
        return 1.0 if x >= b else 0.0
    return max(0.0, min(1.0, (x - a) / (b - a)))


def ramp_down(x: float, a: float, b: float) -> float:
    """Membership that falls from 1 (x <= a) to 0 (x >= b)."""
    return 1.0 - ramp_up(x, a, b)


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _angle_from_up(dx: float, dy: float) -> float:
    """Angle (deg) of a vector from straight up in image coordinates (y down). 0=up, 90=sideways, 180=down."""
    return math.degrees(math.atan2(abs(dx), -dy))


def _angle_from_down(dx: float, dy: float) -> float:
    return math.degrees(math.atan2(abs(dx), dy))


def _torso(kp: ReliableKeypoints) -> Optional[Tuple[Point, Point]]:
    """(hip midpoint, shoulder midpoint). A same-side pair is preferred when only one side is visible."""
    sh, hp = kp.mid(L_SHOULDER, R_SHOULDER), kp.mid(L_HIP, R_HIP)
    if sh is None or hp is None:
        return None
    return hp, sh


def pick_winner(scores: Dict[str, float], cfg: ActivityConfig) -> Tuple[str, float, float]:
    """Highest score, only if it is strong enough and clearly ahead of the runner-up."""
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    if not ranked:
        return POSTURE_UNKNOWN, 0.0, 0.0
    best_kind, best = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    margin = best - second
    if best < cfg.posture_min_score or margin < cfg.posture_min_margin:
        return POSTURE_UNKNOWN, 0.0, margin
    return best_kind, best, margin


def classify_full_body(kp: ReliableKeypoints, bbox: Dict[str, Any], cfg: ActivityConfig) -> PostureResult:
    torso = _torso(kp)
    legs = kp.complete_legs()
    if torso is None or not legs:
        return PostureResult(POSTURE_UNKNOWN, 0.0, 0.0)
    hip_mid, sh_mid = torso
    torso_len = _dist(hip_mid, sh_mid)
    if torso_len < 1e-6:
        return PostureResult(POSTURE_UNKNOWN, 0.0, 0.0)

    vx, vy = sh_mid[0] - hip_mid[0], sh_mid[1] - hip_mid[1]
    torso_angle = _angle_from_up(vx, vy)

    kd: List[float] = []
    ad: List[float] = []
    la: List[float] = []
    leg_len: List[float] = []
    for hip_id, knee_id, ankle_id in legs:
        h, k, a = kp.xy(hip_id), kp.xy(knee_id), kp.xy(ankle_id)
        kd.append((k[1] - h[1]) / torso_len)
        ad.append((a[1] - h[1]) / torso_len)
        la.append(_angle_from_down(a[0] - h[0], a[1] - h[1]))
        leg_len.append(_dist(h, k) + _dist(k, a))
    knee_drop = sum(kd) / len(kd)
    ankle_drop = sum(ad) / len(ad)
    leg_angle = sum(la) / len(la)
    torso_ratio = torso_len / max(sum(leg_len) / len(leg_len), 1e-6)

    bw, bh = float(bbox.get("width", 0.0) or 0.0), float(bbox.get("height", 0.0) or 0.0)
    aspect = bw / bh if bh > 0 else 1.0

    scores = {
        UPRIGHT: min(
            ramp_down(torso_angle, 18, 32),
            ramp_up(knee_drop, 0.50, 0.70),
            ramp_up(ankle_drop, 1.00, 1.30),
            ramp_down(leg_angle, 20, 35),
            ramp_up(torso_ratio, 0.38, 0.50),
        ),
        SITTING: min(
            ramp_down(knee_drop, 0.45, 0.62),
            ramp_down(torso_angle, 30, 48),
            ramp_up(ankle_drop, 0.40, 0.58),
        ),
        BENDING: min(
            max(ramp_up(torso_angle, 28, 45), ramp_down(torso_ratio, 0.30, 0.45)),
            ramp_up(knee_drop, 0.55, 0.72),
            ramp_up(ankle_drop, 0.90, 1.25),
            ramp_down(leg_angle, 25, 40),
        ),
        # Torso and legs both close to horizontal. An inverted body (angles towards 180: upside-down image,
        # hanging person) is not "lying down" and is left unclassified.
        LYING: min(
            ramp_up(torso_angle, 50, 70),
            ramp_up(leg_angle, 40, 60),
            ramp_down(torso_angle, 110, 130),
            ramp_down(leg_angle, 110, 130),
        ) * (0.7 + 0.3 * ramp_up(aspect, 0.6, 1.0)),
    }
    kind, score, margin = pick_winner(scores, cfg)

    # Ankle separation (for the leg-alternation gait cue): right minus left, in torso lengths.
    ankle_sep = None
    la_pt, ra_pt = kp.xy(L_ANKLE), kp.xy(R_ANKLE)
    if la_pt and ra_pt:
        ankle_sep = (ra_pt[0] - la_pt[0]) / torso_len

    return PostureResult(
        kind=kind,
        score=score,
        margin=margin,
        scores={k: round(v, 3) for k, v in scores.items()},
        features={
            "torso_angle_deg": round(torso_angle, 1),
            "leg_angle_deg": round(leg_angle, 1),
            "knee_drop": round(knee_drop, 2),
            "ankle_drop": round(ankle_drop, 2),
            "torso_ratio": round(torso_ratio, 2),
            "bbox_aspect": round(aspect, 2),
        },
        anchor=hip_mid,
        scale=torso_len,
        ankle_sep=ankle_sep,
    )


def classify_upper_body(kp: ReliableKeypoints, bbox: Dict[str, Any], cfg: ActivityConfig) -> PostureResult:
    ls, rs = kp.xy(L_SHOULDER), kp.xy(R_SHOULDER)
    if ls is None or rs is None:
        return PostureResult(POSTURE_UNKNOWN, 0.0, 0.0)
    sh_mid = ((ls[0] + rs[0]) / 2.0, (ls[1] + rs[1]) / 2.0)
    shoulder_w = _dist(ls, rs)
    bh = float(bbox.get("height", 0.0) or 0.0)
    # A person seen side-on has a very narrow shoulder line; fall back on the box height so ratios stay sane.
    scale = max(shoulder_w, 0.35 * bh, 1e-6)

    # Hands: a wrist clearly above the shoulder line.
    wrists_rel: Dict[int, Point] = {}
    rise = 0.0
    for wid in (L_WRIST, R_WRIST):
        w = kp.xy(wid)
        if w is None:
            continue
        wrists_rel[wid] = ((w[0] - sh_mid[0]) / scale, (w[1] - sh_mid[1]) / scale)
        rise = max(rise, (sh_mid[1] - w[1]) / scale)
    raising = ramp_up(rise, 0.25, 0.60) if wrists_rel else 0.0

    # Bending: head dropped to the shoulder line, or shoulders strongly tilted.
    head = kp.xy(NOSE) or kp.mid(L_EYE, R_EYE) or kp.mid(L_EAR, R_EAR)
    tilt = math.degrees(math.atan2(abs(ls[1] - rs[1]), max(abs(ls[0] - rs[0]), 1e-6)))
    head_drop = None
    bending = ramp_up(tilt, 15, 30)
    if head is not None:
        head_drop = (head[1] - sh_mid[1]) / scale          # ~ -0.5 upright, ~0 head on the shoulder line
        bending = max(bending, ramp_up(head_drop, -0.25, 0.0))
    # Neutral = hands down, head up. Without a head position it is less certain.
    neutral = (1.0 - max(raising, bending)) * (1.0 if head is not None else 0.6)

    scores = {UPPER_RAISING: raising, UPPER_BENDING: bending, UPPER_NEUTRAL: neutral}
    kind, score, margin = pick_winner(scores, cfg)

    feats = {"shoulder_tilt_deg": round(tilt, 1), "hand_rise": round(rise, 2)}
    if head_drop is not None:
        feats["head_drop"] = round(head_drop, 2)
    return PostureResult(
        kind=kind,
        score=score,
        margin=margin,
        scores={k: round(v, 3) for k, v in scores.items()},
        features=feats,
        anchor=sh_mid,
        scale=scale,
        wrists_rel=wrists_rel or None,
    )


def classify_posture(kp: ReliableKeypoints, bbox: Dict[str, Any], mode: str, cfg: ActivityConfig) -> PostureResult:
    """Dispatch on the visibility mode. Partial / insufficient bodies are never classified."""
    if mode == MODE_FULL:
        return classify_full_body(kp, bbox, cfg)
    if mode == MODE_UPPER:
        return classify_upper_body(kp, bbox, cfg)
    return PostureResult(POSTURE_UNKNOWN, 0.0, 0.0)

"""
Temporal motion estimators over a person's bounded pose history.

All speeds are in torso lengths per second (TL/s) so they do not depend on how far away the person
is, and they are computed from timestamps, so they do not depend on the frame rate either. Reference
values for an adult (torso ~0.5 m): standing still < 0.5, walking ~1.5-3, running ~5-9.

Estimates use the Theil-Sen slope (median of pairwise slopes) instead of a plain difference, so one
jittery keypoint or one bad frame does not turn a standing person into a runner.

Known limits (see README): the camera is assumed to be stationary, and movement straight towards or
away from the camera is only seen through the person's changing size.
"""

import math
import statistics
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from activity_types import ActivityConfig

Point = Tuple[float, float]


@dataclass
class Observation:
    """What one frame contributes to a person's history (kept small: the history is a bounded deque)."""

    t: float
    mode: str
    quality: str
    posture_kind: Optional[str]            # None when the frame gave no usable posture evidence
    posture_score: float = 0.0
    anchor: Optional[Point] = None
    scale: Optional[float] = None
    ankle_sep: Optional[float] = None
    wrists_rel: Optional[Dict[int, Point]] = None
    pts: Dict[int, Point] = field(default_factory=dict)   # reliable keypoint positions (for motion energy)


@dataclass
class MotionEstimate:
    speed: float            # TL/s of the anchor point
    approach_rate: float    # |d ln(size) / dt| per second, i.e. moving along the camera axis
    span_s: float
    samples: int


def theil_sen_slope(ts: Sequence[float], vs: Sequence[float]) -> Optional[float]:
    """Median of all pairwise slopes; robust against a single outlier. None for fewer than 2 distinct times."""
    slopes: List[float] = []
    n = len(ts)
    for i in range(n):
        for j in range(i + 1, n):
            dt = ts[j] - ts[i]
            if dt > 1e-9:
                slopes.append((vs[j] - vs[i]) / dt)
    return statistics.median(slopes) if slopes else None


def trailing_run(history: Sequence[Observation], now: float, window_s: float, kind_ok) -> List[Observation]:
    """The most recent consecutive observations (within ``window_s`` of ``now``) whose posture passes ``kind_ok``."""
    run: List[Observation] = []
    for obs in reversed(history):
        if now - obs.t > window_s:
            break
        if not kind_ok(obs):
            break
        run.append(obs)
    run.reverse()
    return run


def estimate_translation(run: Sequence[Observation], cfg: ActivityConfig) -> Optional[MotionEstimate]:
    """Anchor speed in torso lengths per second. None when there is not enough time span to tell."""
    pts = [o for o in run if o.anchor is not None and o.scale]
    if len(pts) < 2:
        return None
    span = pts[-1].t - pts[0].t
    if span < cfg.min_motion_span_s:
        return None
    ts = [o.t for o in pts]
    sx = theil_sen_slope(ts, [o.anchor[0] for o in pts])
    sy = theil_sen_slope(ts, [o.anchor[1] for o in pts])
    if sx is None or sy is None:
        return None
    scale = statistics.median(o.scale for o in pts)
    speed = math.hypot(sx, sy) / max(scale, 1e-6)
    ss = theil_sen_slope(ts, [math.log(max(o.scale, 1e-6)) for o in pts])
    return MotionEstimate(speed=speed, approach_rate=abs(ss or 0.0), span_s=span, samples=len(pts))


def gait_alternation(run: Sequence[Observation], cfg: ActivityConfig) -> Tuple[bool, float]:
    """
    Alternating leg movement: how many times per second the two ankles swap sides.

    Returns (available, alternations_per_second). ``available`` is False unless frames arrive at
    ``gait_min_fps`` or faster: a step cycle lasts about a second, so at the dashboard's 0.5 or 1 FPS
    it is simply not observable (aliasing) and this cue must not be used.
    """
    seps = [(o.t, o.ankle_sep) for o in run if o.ankle_sep is not None]
    if len(seps) < 6:
        return False, 0.0
    span = seps[-1][0] - seps[0][0]
    if span <= 0:
        return False, 0.0
    fps = (len(seps) - 1) / span
    if fps < cfg.gait_min_fps:
        return False, 0.0
    amplitude = 0.12  # torso lengths: smaller swings are keypoint jitter, not a step
    flips, last_sign = 0, 0
    for _, sep in seps:
        if abs(sep) < amplitude:
            continue
        sign = 1 if sep > 0 else -1
        if last_sign and sign != last_sign:
            flips += 1
        last_sign = sign
    return True, flips / span


def baseline_observation(history: Sequence[Observation], now: float, min_baseline_s: float) -> Optional[Observation]:
    """The latest earlier observation at least ``min_baseline_s`` older than ``now`` (None if there is none)."""
    for obs in reversed(history):
        if now - obs.t >= min_baseline_s:
            return obs
    return None


def pose_change(prev: Observation, cur: Observation) -> Optional[Tuple[float, float]]:
    """
    Whole-body movement between two frames: (displacement in torso lengths, rate in TL/s), using the
    median displacement of the keypoints both frames agree on (robust against one jittery joint).
    Used to decide whether a lying person is really motionless. Both numbers matter: at low frame rates a
    real movement is diluted in the per-second rate, at high frame rates jitter inflates it.
    """
    dt = cur.t - prev.t
    if dt <= 1e-6 or not prev.scale or not cur.scale:
        return None
    common = [i for i in cur.pts if i in prev.pts]
    if len(common) < 3:
        return None
    scale = (prev.scale + cur.scale) / 2.0
    disp = statistics.median(
        math.hypot(cur.pts[i][0] - prev.pts[i][0], cur.pts[i][1] - prev.pts[i][1]) for i in common
    ) / max(scale, 1e-6)
    return disp, disp / dt


def arm_motion(run: Sequence[Observation], min_baseline_s: float = 0.5) -> Optional[float]:
    """
    Largest wrist movement relative to the shoulders, in shoulder widths per second (upper-body mode).
    Each frame is compared with the latest frame at least ``min_baseline_s`` older, so that keypoint
    jitter at high frame rates is not mistaken for movement.
    """
    best: Optional[float] = None
    for i, b in enumerate(run):
        a = baseline_observation(run[:i], b.t, min_baseline_s)
        if a is None or not a.wrists_rel or not b.wrists_rel:
            continue
        dt = b.t - a.t
        for wid, (bx, by) in b.wrists_rel.items():
            if wid in a.wrists_rel:
                ax, ay = a.wrists_rel[wid]
                rate = math.hypot(bx - ax, by - ay) / dt
                best = rate if best is None else max(best, rate)
    return best

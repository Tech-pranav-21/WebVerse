"""
Synthetic skeleton generator for the activity-recognition tests.

Builds person dicts in exactly the format ``estimate_pose`` returns (bbox + 17 COCO keypoints with
confidences), from anatomical proportions, so the visibility / posture / temporal logic can be tested
at any distance, view and visibility without running the YOLO model. Tests that need the real model
use the photographs instead (see test_activity_realmodel.py).

Proportions (fractions of body height H): shoulder line 0.19H below the head top, hips 0.50H, knees
0.73H, ankles 0.95H; torso (shoulder->hip) 0.31H; thigh 0.23H; shin 0.22H.
"""

import math
import random
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from config import KEYPOINT_NAMES

GROUPS: Dict[str, Tuple[int, ...]] = {
    "head": (0, 1, 2, 3, 4),
    "arms": (7, 8, 9, 10),
    "hips": (11, 12),
    "knees": (13, 14),
    "ankles": (15, 16),
    "legs": (11, 12, 13, 14, 15, 16),
    "lower_legs": (13, 14, 15, 16),
    "left_leg": (11, 13, 15),
    "right_leg": (12, 14, 16),
}

Pt = Tuple[float, float]


def _rot(v: Pt, deg_from_up: float, facing: int) -> Pt:
    """A vector of length |v| pointing up, tilted ``deg_from_up`` towards ``facing`` (+1 right, -1 left)."""
    a = math.radians(deg_from_up)
    length = math.hypot(*v)
    return (facing * length * math.sin(a), -length * math.cos(a))


def build_keypoints(
    posture: str,
    H: float,
    view: str = "front",
    facing: int = 1,
    phase: float = 0.0,
    hands_up: bool = False,
    lean_deg: float = 75.0,
    arm_phase: Optional[float] = None,
) -> Tuple[Dict[int, Pt], float]:
    """
    Keypoint offsets (px) from the hip midpoint, plus the height of that hip midpoint above the ground.
    ``view``: "front" (facing the camera) or "side". ``phase``: walking cycle phase in radians.
    """
    if posture == "lying":
        standing, _ = build_keypoints("standing", H, view, facing, phase, hands_up, lean_deg, arm_phase)
        return _lie_down(standing, facing), 0.08 * H

    wf = 1.0 if view == "front" else 0.22          # lateral spread of paired joints
    T, TH, SH = 0.31 * H, 0.23 * H, 0.22 * H        # torso, thigh, shin
    L = +1                                          # the person's left is image-right when facing the camera
    kp: Dict[int, Pt] = {}

    # ---- torso and head
    if posture == "bending":
        if view == "front":
            # Bending towards the camera: the torso is foreshortened, the head drops to the shoulder line.
            sh = (0.0, -0.11 * H)
            head = (0.0, sh[1] - 0.045 * H)
        else:
            tv = _rot((0, T), lean_deg, facing)
            sh = tv
            head = (sh[0] + facing * 0.10 * H * math.sin(math.radians(lean_deg)), sh[1] - 0.10 * H * math.cos(math.radians(lean_deg)))
    else:
        sh = (0.0, -T)
        head = (0.0, sh[1] - 0.12 * H)
    hw, sw = 0.09 * H * wf, 0.13 * H * wf
    kp[11], kp[12] = (L * hw, 0.0), (-L * hw, 0.0)
    kp[5], kp[6] = (sh[0] + L * sw, sh[1]), (sh[0] - L * sw, sh[1])
    kp[0] = (head[0], head[1] + 0.02 * H)
    kp[1], kp[2] = (head[0] + L * 0.018 * H * wf, head[1]), (head[0] - L * 0.018 * H * wf, head[1])
    kp[3], kp[4] = (head[0] + L * 0.04 * H * wf, head[1] + 0.01 * H), (head[0] - L * 0.04 * H * wf, head[1] + 0.01 * H)

    # ---- arms: hanging, or raised above the head
    swing = 0.0 if arm_phase is None else 0.10 * H * math.sin(arm_phase)
    for side, e_id, w_id, s_id in ((L, 7, 9, 5), (-L, 8, 10, 6)):
        s = kp[s_id]
        if hands_up:
            elbow = (s[0] + side * 0.10 * H * wf, s[1] - 0.06 * H)
            wrist = (elbow[0] + side * 0.02 * H * wf, elbow[1] - 0.14 * H)
        else:
            elbow = (s[0] + side * 0.03 * H * wf, s[1] + 0.15 * H)
            wrist = (elbow[0] + side * 0.01 * H * wf, elbow[1] + 0.13 * H + swing * side)
        kp[e_id], kp[w_id] = elbow, wrist

    # ---- legs
    ground = 0.50 * H
    for side, hip_id, knee_id, ankle_id in ((L, 11, 13, 15), (-L, 12, 14, 16)):
        hip = kp[hip_id]
        if posture == "sitting":
            ground = 0.27 * H
            if view == "side":
                knee = (hip[0] + facing * TH, hip[1])
            else:
                knee = (hip[0], hip[1] + 0.06 * H)          # thigh points at the camera: foreshortened
            ankle = (knee[0], knee[1] + SH)
        else:
            swing_x = 0.0
            if posture == "walking":
                swing_x = 0.13 * H * math.sin(phase + (0.0 if side == L else math.pi))
            knee = (hip[0] + swing_x * 0.5, hip[1] + TH)
            ankle = (knee[0] + swing_x * 0.5, knee[1] + SH)
        kp[knee_id], kp[ankle_id] = knee, ankle

    return kp, ground


def _lie_down(standing: Dict[int, Pt], facing: int) -> Dict[int, Pt]:
    """Rotate a standing skeleton 90 degrees about the hips: head to the left (facing=+1) or right."""
    return {i: ((dy, -dx) if facing > 0 else (-dy, dx)) for i, (dx, dy) in standing.items()}


def make_person(
    posture: str = "standing",
    height: float = 300.0,
    cx: float = 320.0,
    ground_y: float = 450.0,
    view: str = "front",
    facing: int = 1,
    conf: float = 0.92,
    hide: Iterable[Any] = (),
    low_conf: float = 0.10,
    phase: float = 0.0,
    hands_up: bool = False,
    lean_deg: float = 75.0,
    arm_phase: Optional[float] = None,
    img_w: int = 640,
    img_h: int = 480,
    bbox_conf: float = 0.90,
    noise_px: float = 0.0,
    seed: Optional[int] = None,
    conf_overrides: Optional[Dict[int, float]] = None,
    person_id: int = 0,
) -> Dict[str, Any]:
    """
    One detected person. ``hide`` takes keypoint ids and/or group names ("legs", "arms", "head", ...):
    those keypoints keep plausible coordinates but get a low confidence, like an occluded joint does.
    """
    kp_off, ground = build_keypoints(posture, height, view, facing, phase, hands_up, lean_deg, arm_phase)
    hip_x, hip_y = cx, ground_y - ground
    rng = random.Random(seed)
    hidden = set()
    for item in hide:
        hidden.update(GROUPS[item] if isinstance(item, str) else (item,))

    keypoints: List[Dict[str, Any]] = []
    xs: List[float] = []
    ys: List[float] = []
    for i in range(17):
        dx, dy = kp_off[i]
        x = hip_x + dx + (rng.gauss(0, noise_px) if noise_px else 0.0)
        y = hip_y + dy + (rng.gauss(0, noise_px) if noise_px else 0.0)
        c = low_conf if i in hidden else conf
        if conf_overrides and i in conf_overrides:
            c = conf_overrides[i]
        keypoints.append({
            "id": i,
            "name": KEYPOINT_NAMES[i],
            "x": round(x, 1),
            "y": round(y, 1),
            "confidence": round(c, 3),
            "visible": c >= 0.4 and (x > 0 or y > 0),
        })
        xs.append(x)
        ys.append(y)

    # The detector's box covers what it can see: hidden joints do not stretch it.
    seen = [i for i in range(17) if i not in hidden] or list(range(17))
    pad = 0.04 * height
    x1, y1 = min(xs[i] for i in seen) - pad, min(ys[i] for i in seen) - pad
    x2, y2 = max(xs[i] for i in seen) + pad, max(ys[i] for i in seen) + pad
    x1, y1, x2, y2 = max(0.0, x1), max(0.0, y1), min(float(img_w), x2), min(float(img_h), y2)
    return {
        "person_id": person_id,
        "bbox": {
            "x1": round(x1, 1), "y1": round(y1, 1), "x2": round(x2, 1), "y2": round(y2, 1),
            "width": round(x2 - x1, 1), "height": round(y2 - y1, 1),
        },
        "bbox_confidence": bbox_conf,
        "keypoints": keypoints,
        "visible_keypoints": sum(1 for k in keypoints if k["visible"]),
        "total_keypoints": 17,
    }


def clamp_to_frame(person: Dict[str, Any], img_w: int, img_h: int) -> Dict[str, Any]:
    """Pin keypoints that fall outside the frame to its border, the way YOLO does (confidence is kept)."""
    for k in person["keypoints"]:
        k["x"] = round(min(max(k["x"], 0.0), float(img_w)), 1)
        k["y"] = round(min(max(k["y"], 0.0), float(img_h)), 1)
    return person


class Scene:
    """
    Drives an ActivityEngine with timed frames, like the dashboard does. Time only moves when ``step``
    is called, never by itself, so every sequence is deterministic.
    """

    def __init__(self, engine: Any, session: str = "scene", img_w: int = 4000, img_h: int = 1500) -> None:
        self.engine = engine
        self.session = session
        self.img_w, self.img_h = img_w, img_h
        self.t = 0.0
        self.log: List[Dict[str, Any]] = []

    def person(self, posture: str = "standing", cx: float = 500.0, height: float = 240.0, **kw: Any) -> Dict[str, Any]:
        kw.setdefault("view", "side")
        kw.setdefault("noise_px", 1.0)
        kw.setdefault("seed", int(self.t * 1000) + int(cx))
        kw.setdefault("ground_y", 1200)
        return make_person(posture, height, cx=cx, img_w=self.img_w, img_h=self.img_h, **kw)

    def step(self, persons: Sequence[Dict[str, Any]], dt: float = 1.0, track: bool = True) -> List[Optional[Dict[str, Any]]]:
        """Send one frame at the current time, then advance the clock by ``dt`` seconds."""
        out = self.engine.process(self.session, list(persons), self.img_w, self.img_h, timestamp=self.t, track=track)
        self.log.append({"t": self.t, "activities": out["activities"], "lost": out["lost_tracks"]})
        self.t += dt
        return out["activities"]

    def one(self, person: Dict[str, Any], dt: float = 1.0) -> Dict[str, Any]:
        return self.step([person], dt)[0]

    def labels(self, idx: int = 0) -> List[Optional[str]]:
        return [
            e["activities"][idx]["label"] if len(e["activities"]) > idx and e["activities"][idx] else None
            for e in self.log
        ]

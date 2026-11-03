"""
Lightweight multi-person tracker.

YOLO's ``person_id`` is just the index of a detection in one frame and changes from frame to frame,
so it cannot carry a history. This tracker gives each person a stable ``track_id`` so that one
person's pose history is never mixed with another's.

How it matches (no appearance model, no extra dependencies):
  * cost = centre distance (in body heights) + (1 - IoU) + size change (sqrt of box area, which stays
    similar when a person falls from standing to lying, so a fall keeps its identity);
  * a pair is only allowed if the person could plausibly have moved that far in the elapsed time
    (a sprint is about 3 body heights per second);
  * greedy assignment by lowest cost;
  * a track that is not matched stays alive for ``track_max_age_s`` seconds (so a missed detection or a
    short occlusion keeps the same id), then it is dropped together with its history.

Limitations (also in the README): there is no re-identification. At low frame rates two people who
cross paths or leave and re-enter within ``track_max_age_s`` can swap or share an id.
"""

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from activity_types import ActivityConfig

BBox = Tuple[float, float, float, float]  # x1, y1, x2, y2


@dataclass
class Detection:
    index: int
    bbox: BBox
    confidence: float = 0.0


@dataclass
class Track:
    track_id: int
    bbox: BBox
    first_seen_t: float
    last_seen_t: float
    hits: int = 1
    missed: int = 0                 # frames processed since the last match
    reacquired: bool = False        # matched again after having been missing
    payload: Any = None             # per-track temporal state owned by the activity engine


@dataclass
class TrackUpdate:
    matches: Dict[int, Track]       # detection index -> track
    lost: List[Track]               # alive tracks that were not matched in this frame
    expired: List[Track]            # tracks dropped in this update (too old)


def _size(b: BBox) -> float:
    """sqrt(area): about the same for a person standing (tall box) and lying (wide box)."""
    return math.sqrt(max(b[2] - b[0], 1e-3) * max(b[3] - b[1], 1e-3))


def _extent(b: BBox) -> float:
    """Largest side of the box: roughly the person's body height, whatever the posture."""
    return max(b[2] - b[0], b[3] - b[1], 1e-3)


def _center(b: BBox) -> Tuple[float, float]:
    return ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)


def iou(a: BBox, b: BBox) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


class PersonTracker:
    def __init__(self, cfg: ActivityConfig) -> None:
        self.cfg = cfg
        self.tracks: List[Track] = []
        self._next_id = 1

    def reset(self) -> None:
        """Forget every track (ids restart at 1)."""
        self.tracks = []
        self._next_id = 1

    def _cost(self, track: Track, det: Detection, dt: float) -> Optional[float]:
        cfg = self.cfg
        st, sd = _size(track.bbox), _size(det.bbox)
        size_ratio = max(st, sd) / max(min(st, sd), 1e-3)
        if size_ratio > cfg.track_max_size_ratio:
            return None
        (tx, ty), (dx, dy) = _center(track.bbox), _center(det.bbox)
        # Distance in body heights. (Not in sqrt(area): a tall narrow box would make a runner look too far away.)
        dist = math.hypot(tx - dx, ty - dy) / max(_extent(track.bbox), _extent(det.bbox))
        if dist > cfg.track_gate_base + cfg.track_gate_per_s * max(dt, 0.0):
            return None
        return dist + (1.0 - iou(track.bbox, det.bbox)) + abs(math.log(size_ratio))

    def update(self, detections: Sequence[Detection], t: float) -> TrackUpdate:
        cfg = self.cfg

        expired = [tr for tr in self.tracks if t - tr.last_seen_t > cfg.track_max_age_s]
        if expired:
            expired_ids = {tr.track_id for tr in expired}
            self.tracks = [tr for tr in self.tracks if tr.track_id not in expired_ids]

        pairs: List[Tuple[float, int, int]] = []
        for ti, tr in enumerate(self.tracks):
            dt = t - tr.last_seen_t
            for di, det in enumerate(detections):
                c = self._cost(tr, det, dt)
                if c is not None:
                    pairs.append((c, ti, di))
        pairs.sort(key=lambda p: p[0])

        used_tracks, used_dets = set(), set()
        matches: Dict[int, Track] = {}
        for _, ti, di in pairs:
            if ti in used_tracks or di in used_dets:
                continue
            used_tracks.add(ti)
            used_dets.add(di)
            tr, det = self.tracks[ti], detections[di]
            tr.reacquired = tr.missed > 0
            tr.missed = 0
            tr.bbox = det.bbox
            tr.last_seen_t = t
            tr.hits += 1
            matches[det.index] = tr

        for di, det in enumerate(detections):
            if di in used_dets:
                continue
            tr = Track(track_id=self._next_id, bbox=det.bbox, first_seen_t=t, last_seen_t=t)
            self._next_id += 1
            self.tracks.append(tr)
            matches[det.index] = tr

        lost: List[Track] = []
        for ti, tr in enumerate(self.tracks):
            if ti in used_tracks or tr.last_seen_t == t:
                continue
            tr.missed += 1
            lost.append(tr)

        # Hard cap: a flickering false detector must not grow the state without bound. The tracks of the
        # current frame are the most recent, so only the oldest lost ones are ever dropped.
        if len(self.tracks) > cfg.max_tracks:
            ranked = sorted(self.tracks, key=lambda tr: (tr.last_seen_t, tr.hits), reverse=True)
            keep_ids = {tr.track_id for tr in ranked[: cfg.max_tracks]}
            expired.extend(tr for tr in self.tracks if tr.track_id not in keep_ids)
            self.tracks = [tr for tr in self.tracks if tr.track_id in keep_ids]
            lost = [tr for tr in lost if tr.track_id in keep_ids]

        return TrackUpdate(matches=matches, lost=lost, expired=expired)

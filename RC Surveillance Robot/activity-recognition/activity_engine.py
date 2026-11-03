"""
Human Activity Recognition engine.

Turns the per-frame output of ``estimate_pose`` (people + YOLOv8 keypoints) into an activity for each
person, using body visibility, posture and a bounded history of the same person's recent frames.

Pipeline for every person in every frame
  1. visibility.assess_visibility   which part of the body can be trusted -> full / upper / partial / insufficient
  2. posture.classify_posture       upright / sitting / bending / lying (or upper-body posture) from ONE frame
  3. motion estimators              standing vs walking vs running, arm movement, inactivity: need several frames
  4. candidate label                what this frame suggests
  5. hold-and-switch confirmation   a new activity must be the candidate for ``confirm_frames`` consecutive
                                    frames AND ``min_confirm_s`` seconds before it replaces the shown one

Nothing is guessed: with partial or insufficient visibility the label is "Partial Body Detected" /
"Insufficient Visibility" and the confidence is ``None``. "Possible Sleeping" additionally needs a
lying posture with good full-body evidence and a configurable period without movement. See README for
the limits (stationary camera assumed, no re-identification, low frame rates cannot show gait).
"""

import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional, Tuple

from activity_types import (
    ARM_MOVEMENT,
    ActivityConfig,
    BENDING,
    INSUFFICIENT_VISIBILITY,
    LYING_DOWN,
    MODE_FULL,
    MODE_PARTIAL,
    MODE_UPPER,
    PARTIAL_BODY,
    POSSIBLE_SLEEPING,
    PROLONGED_INACTIVITY,
    QUALITY_GOOD,
    QUALITY_MEDIUM,
    RAISING_HANDS,
    RUNNING,
    SITTING,
    STANDING,
    TRACK_INITIALIZING,
    TRACK_REACQUIRED,
    TRACK_TRACKING,
    TRACK_UNTRACKED,
    UNKNOWN,
    UPPER_BODY_BENDING,
    UPPER_BODY_INACTIVITY,
    WALKING,
)
from motion import (
    Observation,
    arm_motion,
    baseline_observation,
    estimate_translation,
    gait_alternation,
    pose_change,
    trailing_run,
)
from person_tracker import Detection, PersonTracker, Track
from posture import (
    BENDING as P_BENDING,
    LYING as P_LYING,
    POSTURE_UNKNOWN,
    SITTING as P_SITTING,
    UPPER_BENDING as P_UPPER_BENDING,
    UPPER_NEUTRAL,
    UPPER_RAISING,
    UPRIGHT,
    PostureResult,
    ramp_down,
    ramp_up,
    classify_posture,
    pick_winner,
)
from visibility import Visibility, assess_visibility

# Typical torso length is ~1.8 shoulder widths; converts the torso-based speed limits to upper-body mode.
SHOULDER_WIDTHS_PER_TORSO = 1.8
# Confidence multiplier when the posture is clear but movement could not be assessed yet.
UNKNOWN_MOTION_FACTOR = 0.6
_UPRIGHT_ACTIVITIES = (STANDING, WALKING, RUNNING)


@dataclass
class Candidate:
    """What ONE frame suggests, before temporal confirmation."""
    label: str
    score: float                      # 0..1, includes the keypoint confidence
    note: Optional[str] = None
    evidence: Dict[str, Any] = field(default_factory=dict)


@dataclass
class _LyingRun:
    """Evidence that someone has been lying motionless, kept as counters so it survives the bounded history."""
    start: Optional[float] = None
    total: int = 0
    good: int = 0

    def reset(self) -> None:
        self.start, self.total, self.good = None, 0, 0

    def inactive_s(self, now: float) -> float:
        return max(0.0, now - self.start) if self.start is not None and self.good >= 2 else 0.0

    def ratio(self) -> float:
        return self.good / self.total if self.total else 0.0


class _TrackState:
    """Temporal state of one tracked person. Everything in it is bounded."""

    def __init__(self) -> None:
        self.history: Deque[Observation] = deque()
        self.obs_count = 0
        self.reacquired_left = 0
        self.confirmed_label: Optional[str] = None
        self.confirmed_since: float = 0.0
        self.previous_label: Optional[str] = None
        self.pending_label: Optional[str] = None
        self.pending_count = 0
        self.pending_since: float = 0.0
        self.votes: Deque[Tuple[str, float]] = deque(maxlen=5)
        self.last_evidence_t: Optional[float] = None
        self.no_evidence_since: Optional[float] = None
        self.lying = _LyingRun()

    def forget_activity(self) -> None:
        if self.confirmed_label is not None:
            self.previous_label = self.confirmed_label
        self.confirmed_label = None
        self.pending_label, self.pending_count = None, 0
        self.votes.clear()
        self.lying.reset()


class _Session:
    def __init__(self, cfg: ActivityConfig, now: float) -> None:
        self.tracker = PersonTracker(cfg)
        self.last_used = now
        self.last_t = float("-inf")    # time never runs backwards inside a session


class ActivityEngine:
    def __init__(self, cfg: Optional[ActivityConfig] = None, clock=time.monotonic) -> None:
        self.cfg = cfg or ActivityConfig()
        self._clock = clock
        self._sessions: "OrderedDict[str, _Session]" = OrderedDict()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ sessions

    def _session(self, session_id: str, now: float) -> _Session:
        for sid in [s for s, sess in self._sessions.items() if now - sess.last_used > self.cfg.session_ttl_s]:
            del self._sessions[sid]
        sess = self._sessions.get(session_id)
        if sess is None:
            sess = _Session(self.cfg, now)
            self._sessions[session_id] = sess
        sess.last_used = now
        self._sessions.move_to_end(session_id)
        while len(self._sessions) > self.cfg.max_sessions:
            self._sessions.popitem(last=False)
        return sess

    def reset(self, session_id: Optional[str] = None) -> None:
        """Forget one session's tracks and history (or every session)."""
        with self._lock:
            if session_id is None:
                self._sessions.clear()
            else:
                self._sessions.pop(session_id, None)

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "active_sessions": len(self._sessions),
                "tracked_people": sum(len(s.tracker.tracks) for s in self._sessions.values()),
            }

    # ------------------------------------------------------------------ public API

    def attach(
        self,
        result: Dict[str, Any],
        session_id: str = "default",
        track: bool = True,
        reset: bool = False,
        timestamp: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Add ``track_id`` and ``activity`` to every person of an ``estimate_pose`` result (in place)."""
        persons = result.get("persons") or []
        if reset:
            self.reset(session_id)
        out = self.process(
            session_id, persons, result.get("image_width", 0), result.get("image_height", 0),
            timestamp=timestamp, track=track,
        )
        for person, act in zip(persons, out["activities"]):
            person["track_id"] = act["track_id"] if act else None
            person["activity"] = act
        result["activity_recognition"] = {
            "enabled": True,
            "tracking": track,
            "session_id": session_id,
            "persons_analyzed": sum(1 for a in out["activities"] if a),
            "persons_skipped": sum(1 for a in out["activities"] if a is None),
            "lost_tracks": out["lost_tracks"],
        }
        return result

    def process(
        self,
        session_id: str,
        persons: List[Dict[str, Any]],
        img_w: float,
        img_h: float,
        timestamp: Optional[float] = None,
        track: bool = True,
    ) -> Dict[str, Any]:
        """Analyse one frame. ``timestamp`` is in seconds (monotonic); defaults to the engine clock."""
        t = self._clock() if timestamp is None else float(timestamp)
        cfg = self.cfg

        # Only the largest people are analysed; a crowd must not make a frame expensive.
        order = sorted(
            range(len(persons)),
            key=lambda i: -_bbox_area(persons[i].get("bbox") or {}),
        )[: cfg.max_tracked_persons]
        activities: List[Optional[Dict[str, Any]]] = [None] * len(persons)

        if not track:
            for i in order:
                activities[i] = self._step(_TrackState(), None, persons[i], img_w, img_h, t, tracked=False)
            return {"activities": activities, "lost_tracks": []}

        with self._lock:
            sess = self._session(session_id, t)
            t = sess.last_t = max(t, sess.last_t)   # an out-of-order timestamp is treated as "same instant"
            detections = [Detection(index=i, bbox=_bbox_tuple(persons[i]), confidence=_bbox_conf(persons[i])) for i in order]
            update = sess.tracker.update(detections, t)
            for i in order:
                tr = update.matches[i]
                if tr.payload is None:
                    tr.payload = _TrackState()
                activities[i] = self._step(tr.payload, tr, persons[i], img_w, img_h, t, tracked=True)
            lost = [_lost_info(tr, t) for tr in update.lost]
        return {"activities": activities, "lost_tracks": lost}

    # ------------------------------------------------------------------ one person, one frame

    def _step(
        self,
        state: _TrackState,
        track: Optional[Track],
        person: Dict[str, Any],
        img_w: float,
        img_h: float,
        t: float,
        tracked: bool,
    ) -> Dict[str, Any]:
        cfg = self.cfg
        vis = assess_visibility(person, img_w, img_h, cfg)
        posture = (
            classify_posture(vis.keypoints, person.get("bbox") or {}, vis.mode, cfg) if vis.has_evidence else None
        )
        obs = Observation(
            t=t,
            mode=vis.mode,
            quality=vis.quality,
            posture_kind=posture.kind if posture else None,
            posture_score=posture.score if posture else 0.0,
            anchor=posture.anchor if posture else None,
            scale=posture.scale if posture else None,
            ankle_sep=posture.ankle_sep if posture else None,
            wrists_rel=posture.wrists_rel if posture else None,
            pts={i: (p[0], p[1]) for i, p in vis.keypoints.pts.items()},
        )

        # Two frames closer together than min_dt_s are one observation (a zero time step would make speeds explode).
        duplicate = bool(state.history) and (t - state.history[-1].t) < cfg.min_dt_s
        if duplicate:
            state.history.pop()
        state.history.append(obs)
        while state.history and (
            len(state.history) > cfg.history_max_frames or t - state.history[0].t > cfg.history_max_s
        ):
            state.history.popleft()
        if not duplicate:
            state.obs_count += 1
            if track is not None and track.reacquired:
                state.reacquired_left = cfg.confirm_frames
            self._update_lying_run(state, obs, vis, posture)

        cand: Optional[Candidate] = None
        if vis.has_evidence and posture is not None:
            cand = self._candidate(state, vis, posture, obs, t)
            state.last_evidence_t = t
            state.no_evidence_since = None
            if not duplicate:
                self._confirm(state, cand, t)
        elif not duplicate:
            self._no_evidence(state, t)

        return self._render(state, track, vis, posture, cand, t, tracked)

    # ------------------------------------------------------------------ candidates

    def _candidate(self, state: _TrackState, vis: Visibility, posture: PostureResult, obs: Observation, t: float) -> Candidate:
        base = posture.score * vis.mean_confidence
        ev: Dict[str, Any] = {"posture": posture.kind, "posture_scores": posture.scores, **posture.features}
        if posture.kind == POSTURE_UNKNOWN:
            return Candidate(UNKNOWN, 0.0, "The pose is ambiguous (for example leaning or crouching), so it is not classified.", ev)

        if vis.mode == MODE_FULL:
            if posture.kind == P_SITTING:
                return Candidate(SITTING, base, None, ev)
            if posture.kind == P_BENDING:
                return Candidate(BENDING, base, None, ev)
            if posture.kind == P_LYING:
                return self._lying_candidate(state, base, t, ev)
            if posture.kind == UPRIGHT:
                return self._upright_candidate(state, base, t, ev)
            return Candidate(UNKNOWN, 0.0, None, ev)

        # Upper-body mode: the legs are not visible, so only upper-body activities exist.
        upper_note = "Legs are not visible: only upper-body activities are classified."
        if posture.kind == UPPER_RAISING:
            return Candidate(RAISING_HANDS, base, upper_note, ev)
        if posture.kind == P_UPPER_BENDING:
            return Candidate(UPPER_BODY_BENDING, base, upper_note, ev)
        if posture.kind == UPPER_NEUTRAL:
            return self._upper_neutral_candidate(state, base, t, ev, upper_note)
        return Candidate(UNKNOWN, 0.0, None, ev)

    def _upright_candidate(self, state: _TrackState, base: float, t: float, ev: Dict[str, Any]) -> Candidate:
        """Standing / walking / running: decided by how the person moved over the last few seconds."""
        cfg = self.cfg
        run = trailing_run(state.history, t, cfg.motion_window_s, lambda o: o.posture_kind == UPRIGHT)
        est = estimate_translation(run, cfg)
        gait_ok, alt_rate = gait_alternation(run, cfg)
        ev["gait_cue"] = "available" if gait_ok else "unavailable (frame rate too low to see steps)"

        if est is None:
            ev["motion"] = "not_yet_assessed"
            if state.confirmed_label in _UPRIGHT_ACTIVITIES:
                # Still upright, no new movement information: keep what is already confirmed.
                return Candidate(state.confirmed_label, base * UNKNOWN_MOTION_FACTOR, None, ev)
            return Candidate(
                STANDING, base * UNKNOWN_MOTION_FACTOR,
                "Movement is not assessed yet: standing and walking cannot be told apart from a single frame.", ev,
            )

        v = est.speed
        run_lo, run_hi = cfg.speed_run_min - 0.6, cfg.speed_run_min + 0.6
        scores = {
            STANDING: ramp_down(v, cfg.speed_stationary_max, cfg.speed_walk_min),
            WALKING: min(ramp_up(v, cfg.speed_stationary_max, cfg.speed_walk_min), ramp_down(v, run_lo, run_hi)),
            RUNNING: ramp_up(v, run_lo, run_hi),
        }
        # Movement along the camera axis shows up as a changing size rather than a sideways shift.
        # Its speed cannot be read without knowing the distance, so it only supports "Walking".
        if est.approach_rate >= cfg.approach_rate_min:
            approach = ramp_up(est.approach_rate, cfg.approach_rate_min, 2 * cfg.approach_rate_min)
            scores[WALKING] = max(scores[WALKING], 0.7 * approach)
            scores[STANDING] = min(scores[STANDING], 1.0 - approach)
        # Alternating legs, only when frames are fast enough to see steps.
        if gait_ok and alt_rate >= cfg.gait_min_alternations_per_s:
            gait = ramp_up(alt_rate, cfg.gait_min_alternations_per_s, 2 * cfg.gait_min_alternations_per_s)
            if v < run_lo:  # alternating legs below running speed: walking, even when little ground is covered
                scores[WALKING] = max(scores[WALKING], 0.6 + 0.4 * gait)
                scores[STANDING] = min(scores[STANDING], 1.0 - gait)
        ev.update(
            motion="measured",
            speed_tl_s=round(v, 2),
            approach_rate=round(est.approach_rate, 3),
            leg_alternations_per_s=round(alt_rate, 2) if gait_ok else None,
            motion_span_s=round(est.span_s, 1),
        )
        label, score, _ = pick_winner(scores, cfg)
        if label == POSTURE_UNKNOWN:
            return Candidate(UNKNOWN, 0.0, "Movement is between standing, walking and running: not classified.", ev)
        return Candidate(label, score * base, None, ev)

    def _upper_neutral_candidate(self, state: _TrackState, base: float, t: float, ev: Dict[str, Any], note: str) -> Candidate:
        cfg = self.cfg
        run = trailing_run(state.history, t, cfg.motion_window_s, lambda o: o.mode == MODE_UPPER)
        arm = arm_motion(run)
        est = estimate_translation(run, cfg)
        if arm is not None:
            ev["arm_motion_widths_s"] = round(arm, 2)
        if est is not None:
            ev["body_speed_widths_s"] = round(est.speed, 2)
        if arm is not None and arm >= cfg.arm_motion_min:
            strength = ramp_up(arm, cfg.arm_motion_min, 2 * cfg.arm_motion_min)
            return Candidate(ARM_MOVEMENT, base * (0.5 + 0.5 * strength), note, ev)
        if est is not None and est.speed > cfg.speed_stationary_max * SHOULDER_WIDTHS_PER_TORSO:
            return Candidate(UNKNOWN, 0.0, "The upper body is moving but the legs are not visible, so walking or running is not classified.", ev)
        if est is None:
            return Candidate(UPPER_BODY_INACTIVITY, base * UNKNOWN_MOTION_FACTOR, "Upper-body movement is not assessed yet. " + note, ev)
        return Candidate(UPPER_BODY_INACTIVITY, base, note, ev)

    def _lying_candidate(self, state: _TrackState, base: float, t: float, ev: Dict[str, Any]) -> Candidate:
        """Lying Down -> Prolonged Inactivity -> Possible Sleeping, depending on how long it has been motionless."""
        cfg = self.cfg
        lying = state.lying
        inactive = lying.inactive_s(t)
        ratio = lying.ratio()
        ev["lying_inactive_s"] = round(inactive, 1)
        ev["lying_evidence_ratio"] = round(ratio, 2)
        enough_evidence = ratio >= cfg.sleep_min_evidence_ratio
        if enough_evidence and inactive >= cfg.sleep_min_inactivity_s:
            return Candidate(
                POSSIBLE_SLEEPING, base * ratio,
                f"Lying without movement for {int(inactive)} s with consistent full-body evidence. "
                "This is an estimate only: sleep cannot be confirmed from video.", ev,
            )
        if enough_evidence and inactive >= cfg.prolonged_inactivity_s:
            return Candidate(PROLONGED_INACTIVITY, base * ratio, f"Lying without movement for {int(inactive)} s.", ev)
        return Candidate(LYING_DOWN, base, None, ev)

    # ------------------------------------------------------------------ lying / inactivity bookkeeping

    def _update_lying_run(self, state: _TrackState, obs: Observation, vis: Visibility, posture: Optional[PostureResult]) -> None:
        """
        Called once per real observation. Frames that support lying with good evidence extend the run;
        a clearly different posture, or movement, ends it; frames with no usable evidence neither
        extend nor end it, but they count against the evidence ratio.
        """
        cfg = self.cfg
        lying = state.lying
        kind = posture.kind if posture else None
        good = kind == P_LYING and vis.mode == MODE_FULL and vis.quality in (QUALITY_GOOD, QUALITY_MEDIUM)

        contradicts = kind in (UPRIGHT, P_SITTING, P_BENDING)
        moved = False
        if good:
            prev = baseline_observation(list(state.history)[:-1], obs.t, 0.5)
            if prev is not None and prev.posture_kind == P_LYING:
                change = pose_change(prev, obs)
                if change is not None:
                    disp, rate = change
                    moved = disp > cfg.inactive_displacement_max or rate > cfg.inactive_motion_max
        if contradicts:
            lying.reset()
            return
        if moved:
            lying.reset()
        if good:
            if lying.start is None:
                lying.start = obs.t
            lying.total += 1
            lying.good += 1
        elif lying.start is not None:
            lying.total += 1

    # ------------------------------------------------------------------ confirmation

    def _confirm(self, state: _TrackState, cand: Candidate, t: float) -> None:
        cfg = self.cfg
        state.votes.append((cand.label, cand.score))
        if cand.label == state.confirmed_label:
            state.pending_label, state.pending_count = None, 0
            return
        if cand.label == state.pending_label:
            state.pending_count += 1
        else:
            state.pending_label, state.pending_count, state.pending_since = cand.label, 1, t
        if state.pending_count >= cfg.confirm_frames and (t - state.pending_since) >= cfg.min_confirm_s:
            if state.confirmed_label is not None:
                state.previous_label = state.confirmed_label
            state.confirmed_label, state.confirmed_since = state.pending_label, state.pending_since
            state.pending_label, state.pending_count = None, 0

    def _no_evidence(self, state: _TrackState, t: float) -> None:
        if state.no_evidence_since is None:
            state.no_evidence_since = t
        state.pending_label, state.pending_count = None, 0
        # A confirmed activity does not survive a long stretch without evidence: it would be stale.
        if (
            state.confirmed_label is not None
            and state.last_evidence_t is not None
            and t - state.last_evidence_t > self.cfg.stale_activity_s
        ):
            state.forget_activity()

    @staticmethod
    def _confirmed_confidence(state: _TrackState) -> float:
        if not state.votes:
            return 0.0
        matching = [s for lab, s in state.votes if lab == state.confirmed_label]
        if not matching:
            return 0.0
        return (sum(matching) / len(matching)) * (len(matching) / len(state.votes))

    # ------------------------------------------------------------------ response

    def _render(
        self,
        state: _TrackState,
        track: Optional[Track],
        vis: Visibility,
        posture: Optional[PostureResult],
        cand: Optional[Candidate],
        t: float,
        tracked: bool,
    ) -> Dict[str, Any]:
        cfg = self.cfg
        note: Optional[str]
        confidence: Optional[float]

        if cand is None:
            label = PARTIAL_BODY if vis.mode == MODE_PARTIAL else INSUFFICIENT_VISIBILITY
            candidate_label, confidence, confirmed = label, None, False
            previous = state.confirmed_label or state.previous_label
            duration = t - state.no_evidence_since if state.no_evidence_since is not None else 0.0
            note = vis.reason
            evidence: Dict[str, Any] = {}
        else:
            candidate_label = cand.label
            evidence = cand.evidence
            if state.confirmed_label is not None:
                label, confirmed = state.confirmed_label, True
                duration = t - state.confirmed_since
                confidence = self._confirmed_confidence(state)
                previous = state.previous_label
                if cand.label == label:
                    note = cand.note
                else:
                    note = f"The current frame suggests {cand.label}; waiting for it to hold before changing."
            else:
                label, confirmed = cand.label, False
                duration = t - state.pending_since if state.pending_label is not None else 0.0
                confidence = cand.score * min(1.0, state.pending_count / max(cfg.confirm_frames, 1))
                previous = state.previous_label
                note = cand.note
            if label == UNKNOWN:
                confidence = None
            elif confidence is not None:
                confidence = round(max(0.0, min(1.0, confidence)), 3)

        if not tracked:
            status = TRACK_UNTRACKED
        elif state.reacquired_left > 0:
            status = TRACK_REACQUIRED
            state.reacquired_left -= 1
        elif state.obs_count < cfg.confirm_frames:
            status = TRACK_INITIALIZING
        else:
            status = TRACK_TRACKING

        inactive_s = None
        if label in (LYING_DOWN, PROLONGED_INACTIVITY, POSSIBLE_SLEEPING):
            inactive_s = round(state.lying.inactive_s(t), 1)

        return {
            "track_id": track.track_id if track is not None else None,
            "label": label,
            "confidence": confidence,
            "confirmed": confirmed,
            "candidate_label": candidate_label,
            "previous_label": previous,
            "duration_s": round(max(0.0, duration), 1),
            "body_visibility": round(vis.score, 3),
            "visibility_mode": vis.mode,
            "detection_quality": vis.quality,
            "quality_score": round(vis.quality_score, 3),
            "tracking_status": status,
            "observations": state.obs_count,
            "inactive_s": inactive_s,
            "note": note,
            "missing_regions": vis.missing_regions,
            "evidence": evidence,
        }


# ---------------------------------------------------------------------- helpers

def _bbox_tuple(person: Dict[str, Any]) -> Tuple[float, float, float, float]:
    b = person.get("bbox") or {}
    return (float(b.get("x1", 0.0)), float(b.get("y1", 0.0)), float(b.get("x2", 0.0)), float(b.get("y2", 0.0)))


def _bbox_area(b: Dict[str, Any]) -> float:
    return max(0.0, float(b.get("width", 0.0) or 0.0)) * max(0.0, float(b.get("height", 0.0) or 0.0))


def _bbox_conf(person: Dict[str, Any]) -> float:
    return float(person.get("bbox_confidence", 0.0) or 0.0)


def _lost_info(tr: Track, now: float) -> Dict[str, Any]:
    state: Optional[_TrackState] = tr.payload
    label = None
    if state is not None:
        label = state.confirmed_label or state.previous_label
    return {
        "track_id": tr.track_id,
        "last_label": label,
        "seconds_since_seen": round(max(0.0, now - tr.last_seen_t), 1),
    }


_engine: Optional[ActivityEngine] = None
_engine_lock = threading.Lock()


def get_activity_engine() -> ActivityEngine:
    """Process-wide engine used by the HTTP service."""
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = ActivityEngine()
        return _engine

"""
Temporal activity-recognition tests.

Frames are exact skeletons (pose_fixtures) fed with explicit timestamps, so every sequence is
deterministic and the motion is known: a person walking at 0.82 body heights/s moves at 2.65 torso
lengths/s, a runner at 2.0 body heights/s at 6.5 torso lengths/s. Nothing here loads the YOLO model.
"""

import math
import unittest
from dataclasses import replace

from activity_engine import ActivityEngine
from activity_types import (
    ARM_MOVEMENT,
    ActivityConfig,
    BENDING,
    INSUFFICIENT_VISIBILITY,
    LYING_DOWN,
    MODE_UPPER,
    PARTIAL_BODY,
    POSSIBLE_SLEEPING,
    PROLONGED_INACTIVITY,
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
from pose_fixtures import Scene, make_person

HEIGHT = 240.0                       # body height in px; torso is 0.31 of it
WALK_PX_PER_S = 0.82 * HEIGHT        # 2.65 torso lengths per second
RUN_PX_PER_S = 2.0 * HEIGHT          # 6.5 torso lengths per second


def new_scene(**cfg_overrides) -> Scene:
    return Scene(ActivityEngine(replace(ActivityConfig(), **cfg_overrides)))


def stand(scene: Scene, seconds: float, x: float, fps: float = 1.0, **kw):
    out = None
    for _ in range(int(round(seconds * fps))):
        out = scene.one(scene.person("standing", cx=x, **kw), dt=1 / fps)
    return out


def move(scene: Scene, seconds: float, x0: float, px_per_s: float, fps: float = 1.0, cycle_hz: float = 1.0, **kw):
    """Walk (or run) to the right from x0. Returns (last activity, final x)."""
    out, x = None, x0
    for i in range(int(round(seconds * fps))):
        x += px_per_s / fps
        phase = 2 * math.pi * cycle_hz * scene.t
        out = scene.one(scene.person("walking", cx=x, phase=phase, **kw), dt=1 / fps)
    return out, x


class StandingTests(unittest.TestCase):
    def test_a_still_person_becomes_standing_only_after_the_observation_window(self):
        scene = new_scene()
        first = scene.one(stand_person(scene, 500))
        self.assertEqual(first["label"], STANDING)
        self.assertFalse(first["confirmed"], "one frame cannot confirm anything")
        self.assertEqual(first["tracking_status"], TRACK_INITIALIZING)
        self.assertIn("single frame", first["note"])

        scene.one(stand_person(scene, 500))
        third = scene.one(stand_person(scene, 500))
        self.assertTrue(third["confirmed"])
        self.assertEqual(third["label"], STANDING)
        self.assertEqual(third["tracking_status"], TRACK_TRACKING)
        self.assertGreater(third["confidence"], first["confidence"], "confidence grows as evidence accumulates")

    def test_the_default_configuration_will_not_confirm_an_activity_within_a_second(self):
        """
        Guards the shipped default (HAR_MIN_CONFIRM_S): at 5 FPS three frames arrive in 0.4 s, which is
        enough frames but nowhere near enough time, and must not produce a confirmed activity.
        """
        scene = new_scene()
        results = [scene.one(stand_person(scene, 500), dt=0.2) for _ in range(6)]
        self.assertTrue(all(not r["confirmed"] for r in results), "1 s of evidence must never be confirmed")
        for _ in range(4):
            out = scene.one(stand_person(scene, 500), dt=0.2)
        self.assertTrue(out["confirmed"], "after 1.5 s it is confirmed")

    def test_confirmation_needs_the_minimum_duration_not_just_the_frame_count(self):
        scene = new_scene(min_confirm_s=3.0)
        results = [scene.one(stand_person(scene, 500), dt=0.5) for _ in range(7)]       # 2 FPS: frame n is at t = 0.5 n
        self.assertFalse(results[2]["confirmed"], "3 frames, but they span only 1 s")
        self.assertFalse(results[5]["confirmed"], "6 frames spanning 2.5 s: still under the 3 s minimum")
        self.assertTrue(results[6]["confirmed"], "the first frame whose evidence spans 3 s")

    def test_duration_counts_up_while_the_activity_continues(self):
        scene = new_scene()
        out = stand(scene, 12, 500)
        self.assertEqual(out["label"], STANDING)
        self.assertAlmostEqual(out["duration_s"], 11.0, delta=0.5)

    def test_a_single_frame_of_a_walking_pose_is_never_reported_as_walking_or_running(self):
        scene = new_scene()
        out = scene.one(scene.person("walking", cx=500, phase=1.0))
        self.assertNotIn(out["label"], (WALKING, RUNNING))
        self.assertFalse(out["confirmed"])
        self.assertIsNone(out["evidence"].get("speed_tl_s"))

    def test_no_tracking_means_one_frame_only_and_says_so(self):
        scene = new_scene()
        for _ in range(4):
            out = scene.step([scene.person("standing", cx=500)], track=False)[0]
        self.assertEqual(out["tracking_status"], TRACK_UNTRACKED)
        self.assertIsNone(out["track_id"])
        self.assertFalse(out["confirmed"])
        self.assertEqual(out["observations"], 1, "frames sent without tracking never build a history")


def stand_person(scene: Scene, x: float):
    return scene.person("standing", cx=x)


class MotionTransitionTests(unittest.TestCase):
    def test_standing_followed_by_walking(self):
        scene = new_scene()
        stand(scene, 5, 300)
        first_moving, x = move(scene, 1, 300, WALK_PX_PER_S)
        self.assertEqual(first_moving["label"], STANDING, "one moving frame must not change a confirmed activity")
        out, _ = move(scene, 7, x, WALK_PX_PER_S)
        self.assertEqual(out["label"], WALKING)
        self.assertTrue(out["confirmed"])
        self.assertEqual(out["previous_label"], STANDING)
        self.assertAlmostEqual(out["evidence"]["speed_tl_s"], 2.65, delta=0.5)
        self.assertLess(out["duration_s"], 8.0, "duration restarts when the activity changes")

    def test_walking_followed_by_running(self):
        scene = new_scene()
        _, x = move(scene, 8, 200, WALK_PX_PER_S)
        walking = scene.log[-1]["activities"][0]
        self.assertEqual(walking["label"], WALKING)
        out, _ = move(scene, 4, x, RUN_PX_PER_S, fps=2)
        self.assertEqual(out["label"], RUNNING)
        self.assertTrue(out["confirmed"])
        self.assertEqual(out["previous_label"], WALKING)
        self.assertGreater(out["evidence"]["speed_tl_s"], 5.0)

    def test_running_followed_by_standing(self):
        scene = new_scene()
        _, x = move(scene, 5, 200, RUN_PX_PER_S, fps=2)
        self.assertEqual(scene.log[-1]["activities"][0]["label"], RUNNING)
        out = stand(scene, 12, x, fps=1)
        self.assertEqual(out["label"], STANDING)
        self.assertTrue(out["confirmed"])
        self.assertEqual(out["previous_label"], RUNNING)

    def test_walking_and_running_are_not_confused_at_any_distance(self):
        """Speeds are in torso lengths per second, so a distant runner is still a runner."""
        for height in (110.0, 240.0, 400.0):
            for heights_per_s, expected in ((0.82, WALKING), (2.0, RUNNING)):
                with self.subTest(height=height, expected=expected):
                    scene = new_scene()
                    out, _ = move(scene, 4, 200, heights_per_s * height, fps=2, height=height)
                    self.assertEqual(out["label"], expected)

    def test_frame_rate_does_not_change_the_answer(self):
        for fps in (0.5, 1.0, 2.0, 5.0):
            with self.subTest(fps=fps):
                scene = new_scene()
                out, _ = move(scene, 14 if fps < 1 else 8, 200, WALK_PX_PER_S, fps=fps)
                self.assertEqual(out["label"], WALKING, f"at {fps} FPS")

    def test_slow_drift_is_still_standing(self):
        """Posture sway / keypoint drift well below walking speed must not look like walking."""
        scene = new_scene()
        out, _ = move(scene, 8, 500, 0.15 * HEIGHT * 0.3)                # ~0.14 torso lengths/s
        self.assertEqual(out["label"], STANDING)

    def test_walking_toward_the_camera_is_not_standing(self):
        """
        No sideways movement at all: the person only grows in the picture as they approach (a camera at
        hip height keeps the hips on the horizon, so there is no vertical movement either).
        """
        scene = new_scene()
        out = None
        for i in range(10):
            height = 120 * math.exp(0.3 * i * 0.5)                        # +30% size per second
            person = make_person("standing", height, cx=1000, ground_y=700 + 0.5 * height, img_w=4000, img_h=1500,
                                 view="side", noise_px=0.5, seed=i)
            out = scene.one(person, dt=0.5)
        self.assertEqual(out["label"], WALKING)
        self.assertLess(out["evidence"]["speed_tl_s"], 0.5, "the scenario has no sideways movement")
        self.assertGreater(out["evidence"]["approach_rate"], 0.2)
        self.assertLessEqual(out["confidence"], 0.8, "movement along the camera axis alone is never high confidence")

    def test_a_person_slowly_growing_in_the_picture_from_noise_alone_is_still_standing(self):
        scene = new_scene()
        for i in range(10):
            height = 240 * (1 + 0.02 * ((-1) ** i))                       # +/-2% size jitter
            out = scene.one(make_person("standing", height, cx=1000, ground_y=1200, img_w=4000, img_h=1500,
                                        view="side", noise_px=1.0, seed=i), dt=0.5)
        self.assertEqual(out["label"], STANDING)


class StabilityTests(unittest.TestCase):
    def test_a_single_bad_frame_does_not_flip_a_confirmed_activity(self):
        scene = new_scene()
        _, x = move(scene, 8, 200, WALK_PX_PER_S)
        labels = []
        for i in range(8):
            if i == 3:                     # one frame in which the person seems to stand still
                labels.append(scene.one(scene.person("walking", cx=x, phase=0.5))["label"])
            else:
                x += WALK_PX_PER_S
                labels.append(scene.one(scene.person("walking", cx=x, phase=2 * math.pi * scene.t))["label"])
        self.assertEqual(set(labels), {WALKING})

    def test_a_single_unclassifiable_frame_is_reported_honestly_but_does_not_erase_the_activity(self):
        scene = new_scene()
        _, x = move(scene, 8, 200, WALK_PX_PER_S)
        x += WALK_PX_PER_S
        flicker = scene.one(scene.person("walking", cx=x, hide=("ankles",), phase=1.0))
        self.assertIn(flicker["label"], (PARTIAL_BODY, INSUFFICIENT_VISIBILITY))
        self.assertIsNone(flicker["confidence"], "no confidence is invented for a frame with nothing to classify")
        self.assertEqual(flicker["previous_label"], WALKING)
        x += WALK_PX_PER_S
        after = scene.one(scene.person("walking", cx=x, phase=2.0))
        self.assertEqual(after["label"], WALKING)
        self.assertTrue(after["confirmed"])

    def test_a_confirmed_activity_is_forgotten_after_too_long_without_evidence(self):
        scene = new_scene(stale_activity_s=4.0)
        stand(scene, 5, 500)
        for _ in range(6):                                          # six seconds of "ankles not visible"
            out = scene.one(scene.person("standing", cx=500, hide=("ankles",)))
        self.assertEqual(out["label"], PARTIAL_BODY)
        back = scene.one(scene.person("standing", cx=500))
        self.assertFalse(back["confirmed"], "the old Standing was stale and must be re-confirmed")
        self.assertEqual(back["previous_label"], STANDING)

    def test_labels_change_only_when_the_new_one_holds(self):
        scene = new_scene()
        stand(scene, 6, 500)
        seq = []
        for i in range(10):
            seq.append(scene.one(scene.person("sitting", cx=500, ground_y=1200))["label"])
        # Standing stays until Sitting has been the candidate 3 times in a row for 1.5 s
        first_sitting = seq.index(SITTING)
        self.assertGreaterEqual(first_sitting, 2)
        self.assertTrue(all(label == SITTING for label in seq[first_sitting:]))


class DisappearanceTests(unittest.TestCase):
    def test_a_person_who_disappears_briefly_keeps_the_track_and_is_reacquired(self):
        scene = new_scene()
        _, x = move(scene, 8, 200, WALK_PX_PER_S)
        before = scene.log[-1]["activities"][0]
        tid = before["track_id"]
        scene.step([], dt=1.0)
        scene.step([], dt=1.0)
        lost = scene.log[-1]["lost"]
        self.assertEqual([entry["track_id"] for entry in lost], [tid])
        self.assertEqual(lost[0]["last_label"], WALKING)
        self.assertAlmostEqual(lost[0]["seconds_since_seen"], 2.0, delta=0.1)

        x += 3 * WALK_PX_PER_S
        back = scene.one(scene.person("walking", cx=x, phase=1.0))
        self.assertEqual(back["track_id"], tid, "same person, same id")
        self.assertEqual(back["tracking_status"], TRACK_REACQUIRED)
        self.assertEqual(back["label"], WALKING, "the confirmed activity carries over a short absence")
        self.assertGreater(back["observations"], 8, "history was kept")

    def test_a_person_gone_longer_than_the_track_lifetime_starts_from_scratch(self):
        scene = new_scene(track_max_age_s=5.0)
        stand(scene, 6, 500)
        old_id = scene.log[-1]["activities"][0]["track_id"]
        scene.t += 8.0                                             # nobody in view for 8 s
        scene.step([], dt=0.0)
        new = scene.one(scene.person("standing", cx=520))
        self.assertNotEqual(new["track_id"], old_id)
        self.assertEqual(new["observations"], 1)
        self.assertFalse(new["confirmed"])
        self.assertIsNone(new["previous_label"], "nothing of the previous person is carried over")
        self.assertEqual(new["tracking_status"], TRACK_INITIALIZING)

    def test_an_empty_scene_reports_nothing_and_does_not_fail(self):
        scene = new_scene()
        out = scene.engine.process("scene", [], 640, 480, timestamp=0.0)
        self.assertEqual(out, {"activities": [], "lost_tracks": []})


class MultiplePeopleTests(unittest.TestCase):
    def test_two_people_keep_independent_histories(self):
        scene = new_scene()
        walker_x, still_x = 200.0, 3200.0
        out = None
        for _ in range(9):
            walker_x += WALK_PX_PER_S
            out = scene.step([
                scene.person("walking", cx=walker_x, phase=2 * math.pi * scene.t),
                scene.person("standing", cx=still_x),
            ])
        walker, still = out
        self.assertEqual((walker["label"], still["label"]), (WALKING, STANDING))
        self.assertNotEqual(walker["track_id"], still["track_id"])
        self.assertEqual(walker["observations"], still["observations"])
        self.assertLess(still["evidence"]["speed_tl_s"], 0.3, "the walker's movement must not leak into the other person")

    def test_the_two_ids_stay_attached_to_the_same_people_when_the_detector_reorders_them(self):
        scene = new_scene()
        ids = {}
        for i in range(6):
            a = scene.person("standing", cx=500)
            b = scene.person("standing", cx=3000)
            people = [a, b] if i % 2 == 0 else [b, a]
            out = scene.step(people)
            by_x = {round(p["bbox"]["x1"] / 1000): act["track_id"] for p, act in zip(people, out)}
            ids.setdefault("first", by_x)
            self.assertEqual(by_x, ids["first"], f"ids swapped at frame {i}")

    def test_only_the_largest_people_are_analysed(self):
        scene = new_scene(max_tracked_persons=2)
        people = [scene.person("standing", cx=300 + 700 * i, height=100 + 60 * i) for i in range(4)]
        out = scene.step(people)
        self.assertEqual([a is not None for a in out], [False, False, True, True])


class SessionTests(unittest.TestCase):
    def test_sessions_never_share_tracks_or_history(self):
        engine = ActivityEngine(ActivityConfig())
        a, b = Scene(engine, "tab-a"), Scene(engine, "tab-b")
        for _ in range(5):
            a.one(a.person("standing", cx=500))
        first_b = b.one(b.person("standing", cx=500))
        self.assertEqual(first_b["observations"], 1)
        self.assertEqual(first_b["track_id"], 1)
        self.assertEqual(a.log[-1]["activities"][0]["observations"], 5)

    def test_reset_forgets_one_session_only(self):
        engine = ActivityEngine(ActivityConfig())
        a, b = Scene(engine, "a"), Scene(engine, "b")
        for _ in range(3):
            a.one(a.person("standing", cx=500))
            b.one(b.person("standing", cx=500))
        engine.reset("a")
        self.assertEqual(a.one(a.person("standing", cx=500))["observations"], 1)
        self.assertEqual(b.one(b.person("standing", cx=500))["observations"], 4)

    def test_idle_sessions_expire(self):
        engine = ActivityEngine(replace(ActivityConfig(), session_ttl_s=60.0))
        a = Scene(engine, "old")
        a.one(a.person("standing", cx=500))
        b = Scene(engine, "new")
        b.t = 200.0
        b.one(b.person("standing", cx=500))
        self.assertEqual(engine.stats()["active_sessions"], 1)


class BoundedMemoryTests(unittest.TestCase):
    def test_pose_history_is_bounded(self):
        scene = new_scene(history_max_frames=40, history_max_s=20.0)
        stand(scene, 500, 500, fps=5)                                  # 2500 frames
        tracker = scene.engine._sessions[scene.session].tracker
        state = tracker.tracks[0].payload
        self.assertLessEqual(len(state.history), 40)
        self.assertLessEqual(len(state.votes), 5)
        self.assertGreaterEqual(state.history[-1].t - state.history[0].t, 0.0)
        self.assertLessEqual(state.history[-1].t - state.history[0].t, 20.0)

    def test_number_of_sessions_is_bounded(self):
        engine = ActivityEngine(replace(ActivityConfig(), max_sessions=4))
        for i in range(30):
            s = Scene(engine, f"tab-{i}")
            s.one(s.person("standing", cx=500))
        self.assertLessEqual(engine.stats()["active_sessions"], 4)

    def test_frames_closer_than_the_minimum_step_are_one_observation(self):
        scene = new_scene()
        scene.step([scene.person("standing", cx=500)], dt=0.0)          # same timestamp twice
        out = scene.step([scene.person("standing", cx=520)], dt=1.0)[0]
        self.assertEqual(out["observations"], 1)
        self.assertIsNone(out["evidence"].get("speed_tl_s"))

    def test_timestamps_going_backwards_are_treated_as_the_same_instant(self):
        scene = new_scene()
        stand(scene, 4, 500)
        scene.t -= 3.0
        out = scene.one(scene.person("standing", cx=500))
        self.assertIsNotNone(out)
        self.assertGreaterEqual(out["duration_s"], 0.0)


class GaitCueTests(unittest.TestCase):
    def test_leg_alternation_is_only_used_when_the_frame_rate_can_show_steps(self):
        slow = new_scene()
        out, _ = move(slow, 8, 200, WALK_PX_PER_S, fps=1)
        self.assertIn("unavailable", out["evidence"]["gait_cue"])
        self.assertIsNone(out["evidence"]["leg_alternations_per_s"])

        fast = new_scene()
        out, _ = move(fast, 5, 200, WALK_PX_PER_S, fps=5)
        self.assertEqual(out["evidence"]["gait_cue"], "available")
        self.assertGreaterEqual(out["evidence"]["leg_alternations_per_s"], 1.0)

    def test_walking_on_the_spot_is_seen_by_the_gait_cue_only_at_a_high_frame_rate(self):
        fast = new_scene()
        out = None
        for _ in range(40):
            out = fast.one(fast.person("walking", cx=500, phase=2 * math.pi * fast.t), dt=0.2)
        self.assertEqual(out["label"], WALKING)

        slow = new_scene()
        for _ in range(8):
            out = slow.one(slow.person("walking", cx=500, phase=2 * math.pi * slow.t + 0.7), dt=1.0)
        self.assertEqual(out["label"], STANDING, "at 1 FPS steps cannot be seen: this is a documented limit, not a guess")

    def test_standing_with_apart_feet_does_not_look_like_leg_alternation(self):
        scene = new_scene()
        out = stand(scene, 6, 500, fps=5)
        self.assertEqual(out["label"], STANDING)
        self.assertEqual(out["evidence"]["leg_alternations_per_s"], 0.0)


class OtherPostureTests(unittest.TestCase):
    def confirmed(self, posture, n=6, **kw):
        scene = new_scene()
        out = None
        for _ in range(n):
            out = scene.one(scene.person(posture, cx=900, **kw))
        return out

    def test_sitting(self):
        for view in ("front", "side"):
            out = self.confirmed("sitting", view=view)
            self.assertEqual((out["label"], out["confirmed"]), (SITTING, True), view)

    def test_bending(self):
        for view in ("front", "side"):
            out = self.confirmed("bending", view=view)
            self.assertEqual((out["label"], out["confirmed"]), (BENDING, True), view)

    def test_lying_down(self):
        out = self.confirmed("lying")
        self.assertEqual((out["label"], out["confirmed"]), (LYING_DOWN, True))

    def test_an_ambiguous_pose_is_unknown_activity_with_no_confidence(self):
        scene = new_scene()
        for _ in range(6):
            person = scene.person("sitting", cx=900)
            hip_y = person["keypoints"][11]["y"]
            for kp in person["keypoints"]:
                if kp["id"] in (15, 16):
                    kp["y"] = hip_y + 8                              # a crouch: neither standing nor sitting
            out = scene.one(person)
        self.assertEqual(out["label"], UNKNOWN)
        self.assertIsNone(out["confidence"])
        self.assertIn("ambiguous", out["note"])

    def test_a_person_who_sits_down_is_standing_then_sitting_with_previous_activity_recorded(self):
        scene = new_scene()
        stand(scene, 6, 900)
        out = None
        for _ in range(6):
            out = scene.one(scene.person("sitting", cx=900))
        self.assertEqual(out["label"], SITTING)
        self.assertEqual(out["previous_label"], STANDING)


class VisibilityDrivenLabelTests(unittest.TestCase):
    def test_partial_body_is_reported_as_partial_with_no_confidence(self):
        scene = new_scene()
        for _ in range(4):
            out = scene.one(scene.person("standing", cx=500, hide=("ankles",)))
        self.assertEqual(out["label"], PARTIAL_BODY)
        self.assertIsNone(out["confidence"])
        self.assertFalse(out["confirmed"])
        self.assertEqual(out["visibility_mode"], "partial")
        self.assertIn("legs", out["note"])
        self.assertIn(out["detection_quality"], ("poor", "insufficient"))

    def test_a_person_far_away_is_insufficient_visibility(self):
        scene = new_scene()
        out = scene.one(scene.person("standing", cx=500, height=30))
        self.assertEqual(out["label"], INSUFFICIENT_VISIBILITY)
        self.assertIsNone(out["confidence"])
        self.assertEqual(out["detection_quality"], "insufficient")

    def test_low_confidence_keypoints_are_insufficient_visibility(self):
        scene = new_scene()
        out = scene.one(scene.person("standing", cx=500, conf=0.3))
        self.assertEqual(out["label"], INSUFFICIENT_VISIBILITY)
        self.assertIsNone(out["confidence"])
        self.assertEqual(out["body_visibility"], 0.0)

    def test_legs_hidden_never_produces_a_full_body_label(self):
        scene = new_scene()
        _, x = move(scene, 8, 200, WALK_PX_PER_S, hide=("legs",))
        for entry in scene.log:
            label = entry["activities"][0]["label"]
            self.assertNotIn(label, (STANDING, WALKING, RUNNING, SITTING, LYING_DOWN, BENDING), label)

    def test_every_response_carries_visibility_and_quality(self):
        scene = new_scene()
        for hide in ((), ("legs",), ("ankles",)):
            out = scene.one(scene.person("standing", cx=500, hide=hide))
            for key in ("body_visibility", "visibility_mode", "detection_quality", "quality_score"):
                self.assertIn(key, out)
            self.assertTrue(0.0 <= out["body_visibility"] <= 1.0)


class UpperBodyActivityTests(unittest.TestCase):
    def feed(self, n=6, **kw):
        scene = new_scene()
        out = None
        for _ in range(n):
            out = scene.one(scene.person("standing", cx=900, hide=("legs",), **kw))
        return out

    def test_upper_body_inactivity(self):
        out = self.feed()
        self.assertEqual((out["label"], out["confirmed"]), (UPPER_BODY_INACTIVITY, True))
        self.assertEqual(out["visibility_mode"], MODE_UPPER)
        self.assertIn("upper-body", out["note"])

    def test_raising_hands(self):
        out = self.feed(hands_up=True)
        self.assertEqual((out["label"], out["confirmed"]), (RAISING_HANDS, True))

    def test_upper_body_bending(self):
        scene = new_scene()
        for _ in range(6):
            out = scene.one(scene.person("bending", cx=900, hide=("legs",), view="side"))
        self.assertEqual(out["label"], UPPER_BODY_BENDING)

    def test_arm_movement(self):
        scene = new_scene()
        for i in range(8):                       # the hands swing up and down by 0.2 body heights between frames
            out = scene.one(scene.person("standing", cx=900, hide=("legs",), view="front",
                                         arm_phase=(math.pi / 2) * (-1) ** i))
        self.assertEqual((out["label"], out["confirmed"]), (ARM_MOVEMENT, True))
        self.assertGreater(out["evidence"]["arm_motion_widths_s"], 0.4)

    def test_still_arms_are_not_arm_movement(self):
        out = self.feed(n=8, arm_phase=0.0)
        self.assertNotEqual(out["label"], ARM_MOVEMENT)

    def test_a_walking_upper_body_is_not_called_walking(self):
        scene = new_scene()
        x = 200.0
        for _ in range(8):
            x += WALK_PX_PER_S
            out = scene.one(scene.person("walking", cx=x, hide=("legs",), phase=1.0))
        self.assertNotIn(out["label"], (WALKING, RUNNING, STANDING))
        self.assertEqual(out["label"], UNKNOWN)
        self.assertIn("legs are not visible", out["note"])


class SleepingTests(unittest.TestCase):
    """Possible Sleeping = lying + good full-body evidence + a configurable period without movement."""

    def lying_scene(self, seconds, fps=1.0, scene=None, **kw):
        scene = scene or new_scene()
        out = None
        for _ in range(int(seconds * fps)):
            out = scene.one(scene.person("lying", cx=1500, height=260, **kw), dt=1 / fps)
        return scene, out

    def test_progression_lying_then_prolonged_inactivity_then_possible_sleeping(self):
        scene = new_scene()
        seen = {}
        for second in range(0, 80):
            out = scene.one(scene.person("lying", cx=1500, height=260))
            seen.setdefault(out["label"], second)
        self.assertEqual(list(seen), [LYING_DOWN, PROLONGED_INACTIVITY, POSSIBLE_SLEEPING])
        self.assertLess(seen[LYING_DOWN], 4)
        self.assertGreaterEqual(seen[PROLONGED_INACTIVITY], 15)
        self.assertLess(seen[PROLONGED_INACTIVITY], 22)
        self.assertGreaterEqual(seen[POSSIBLE_SLEEPING], 60, "never before the configured inactivity period")
        self.assertLess(seen[POSSIBLE_SLEEPING], 67)

    def test_sleeping_is_worded_as_an_estimate_and_carries_the_inactivity_time(self):
        scene, out = self.lying_scene(75)
        self.assertEqual(out["label"], POSSIBLE_SLEEPING)
        self.assertIn("estimate only", out["note"])
        self.assertIn("cannot be confirmed", out["note"])
        self.assertGreaterEqual(out["inactive_s"], 60)

    def test_a_lying_person_is_not_sleeping_after_a_short_while(self):
        scene, out = self.lying_scene(30)
        self.assertIn(out["label"], (LYING_DOWN, PROLONGED_INACTIVITY))
        self.assertNotEqual(out["label"], POSSIBLE_SLEEPING)

    def test_the_inactivity_period_is_configurable(self):
        scene = new_scene(sleep_min_inactivity_s=20.0, prolonged_inactivity_s=8.0)
        for _ in range(30):
            out = scene.one(scene.person("lying", cx=1500, height=260))
        self.assertEqual(out["label"], POSSIBLE_SLEEPING)

    def test_movement_restarts_the_inactivity_clock(self):
        scene = new_scene()
        for _ in range(50):
            scene.one(scene.person("lying", cx=1500, height=260))
        before = scene.log[-1]["activities"][0]
        self.assertEqual(before["label"], PROLONGED_INACTIVITY)
        # the person turns over / shifts by about a body length
        for _ in range(30):
            out = scene.one(scene.person("lying", cx=1800, height=260))
        self.assertNotEqual(out["label"], POSSIBLE_SLEEPING, "80 s lying in total, but only ~30 s since the person moved")
        self.assertLess(out["inactive_s"], 35)

    def test_getting_up_ends_the_lying_run(self):
        scene = new_scene()
        for _ in range(50):
            scene.one(scene.person("lying", cx=1500, height=260))
        for _ in range(4):
            scene.one(scene.person("standing", cx=1500, height=260))
        for _ in range(40):
            out = scene.one(scene.person("lying", cx=1500, height=260))
        self.assertNotEqual(out["label"], POSSIBLE_SLEEPING, "the 40 s since they lay down again is not enough")

    def test_poor_quality_evidence_never_leads_to_possible_sleeping(self):
        """Lying is still reported (honestly), but sleep needs good full-body evidence."""
        scene = new_scene()
        for _ in range(100):
            out = scene.one(scene.person("lying", cx=1500, height=260, conf=0.52, bbox_conf=0.2,
                                         hide=("arms", "head")))
        self.assertEqual(out["detection_quality"], "poor")
        self.assertEqual(out["label"], LYING_DOWN)
        self.assertNotIn(POSSIBLE_SLEEPING, scene.labels())
        self.assertNotIn(PROLONGED_INACTIVITY, scene.labels())

    def test_too_many_unusable_frames_means_insufficient_evidence(self):
        scene = new_scene()
        for i in range(100):
            hide = ("legs",) if i % 2 else ()                       # every other frame has no usable legs
            out = scene.one(scene.person("lying", cx=1500, height=260, hide=hide))
        self.assertNotIn(POSSIBLE_SLEEPING, scene.labels())

    def test_occasional_unusable_frames_do_not_stop_the_detection(self):
        scene = new_scene()
        for i in range(90):
            hide = ("ankles",) if i % 10 == 5 else ()               # 1 frame in 10 is partial
            out = scene.one(scene.person("lying", cx=1500, height=260, hide=hide))
        self.assertIn(POSSIBLE_SLEEPING, scene.labels())

    def test_possible_sleeping_is_never_claimed_from_a_single_frame_or_a_standing_person(self):
        scene = new_scene()
        out = scene.one(scene.person("lying", cx=1500, height=260))
        self.assertEqual(out["label"], LYING_DOWN)
        self.assertFalse(out["confirmed"])
        standing = new_scene()
        for _ in range(80):
            out = standing.one(standing.person("standing", cx=1500))
        self.assertEqual(out["label"], STANDING)

    def test_sleeping_works_at_a_low_frame_rate_too(self):
        scene = new_scene()
        for _ in range(40):                                          # 0.5 FPS: 80 s
            out = scene.one(scene.person("lying", cx=1500, height=260), dt=2.0)
        self.assertEqual(out["label"], POSSIBLE_SLEEPING)

    def test_lost_for_longer_than_the_track_lifetime_restarts_the_sleep_clock(self):
        scene = new_scene()
        for _ in range(50):
            scene.one(scene.person("lying", cx=1500, height=260))
        scene.t += 10.0                                              # out of view for 10 s (> 5 s lifetime)
        scene.step([], dt=0.0)
        out = scene.one(scene.person("lying", cx=1500, height=260))
        self.assertEqual(out["label"], LYING_DOWN)
        self.assertEqual(out["inactive_s"], 0.0)


if __name__ == "__main__":
    unittest.main()

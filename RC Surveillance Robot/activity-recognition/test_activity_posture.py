"""
Static posture tests (one frame): upright / sitting / bending / lying, plus the upper-body postures.
Walking and running are NOT decided here: one still image cannot show movement (see test_activity_temporal.py).
"""

import copy
import unittest
from dataclasses import replace

from activity_types import ActivityConfig, MODE_FULL, MODE_INSUFFICIENT, MODE_UPPER
from pose_fixtures import make_person
from posture import (
    BENDING,
    LYING,
    POSTURE_UNKNOWN,
    SITTING,
    UPPER_BENDING,
    UPPER_NEUTRAL,
    UPPER_RAISING,
    UPRIGHT,
    classify_full_body,
    classify_posture,
    ramp_down,
    ramp_up,
)
from visibility import ReliableKeypoints, assess_visibility

W, H = 640, 480
CFG = ActivityConfig()


def posture_of(person, cfg=CFG, w=W, h=H):
    v = assess_visibility(person, w, h, cfg)
    return v, classify_posture(v.keypoints, person["bbox"], v.mode, cfg)


class FuzzyHelperTests(unittest.TestCase):
    def test_ramps(self):
        self.assertEqual(ramp_up(0, 1, 3), 0.0)
        self.assertEqual(ramp_up(2, 1, 3), 0.5)
        self.assertEqual(ramp_up(5, 1, 3), 1.0)
        self.assertEqual(ramp_down(0, 1, 3), 1.0)
        self.assertEqual(ramp_down(2, 1, 3), 0.5)
        self.assertEqual(ramp_down(5, 1, 3), 0.0)


class FullBodyPostureTests(unittest.TestCase):
    def test_standing_front_and_side_at_every_distance(self):
        for view in ("front", "side"):
            for height in (60, 120, 300, 420):
                with self.subTest(view=view, height=height):
                    v, p = posture_of(make_person("standing", height, view=view, ground_y=470))
                    self.assertEqual(v.mode, MODE_FULL)
                    self.assertEqual(p.kind, UPRIGHT)
                    self.assertGreaterEqual(p.score, 0.9)
                    self.assertLess(p.features["torso_angle_deg"], 5)

    def test_sitting_front_and_side(self):
        for view in ("front", "side"):
            with self.subTest(view=view):
                _, p = posture_of(make_person("sitting", 300, view=view, ground_y=460))
                self.assertEqual(p.kind, SITTING)
                self.assertGreaterEqual(p.score, 0.9)
                self.assertLess(p.features["knee_drop"], 0.45)

    def test_sitting_at_different_distances(self):
        for height in (80, 150, 300, 400):
            with self.subTest(height=height):
                _, p = posture_of(make_person("sitting", height, view="side", ground_y=470))
                self.assertEqual(p.kind, SITTING)

    def test_bending_from_the_side_at_several_angles(self):
        for lean in (55, 75, 90):
            with self.subTest(lean=lean):
                _, p = posture_of(make_person("bending", 300, view="side", lean_deg=lean, ground_y=460))
                self.assertEqual(p.kind, BENDING)
                self.assertAlmostEqual(p.features["torso_angle_deg"], lean, delta=2)

    def test_bending_towards_the_camera_is_recognised_from_the_foreshortened_torso(self):
        _, p = posture_of(make_person("bending", 300, view="front", ground_y=460))
        self.assertEqual(p.kind, BENDING)
        self.assertLess(p.features["torso_ratio"], 0.30)

    def test_lying_down_in_either_direction_and_view(self):
        for view in ("front", "side"):
            for facing in (1, -1):
                with self.subTest(view=view, facing=facing):
                    v, p = posture_of(make_person("lying", 300, view=view, facing=facing, ground_y=440))
                    self.assertEqual(v.mode, MODE_FULL)
                    self.assertEqual(p.kind, LYING)
                    self.assertAlmostEqual(p.features["torso_angle_deg"], 90, delta=3)

    def test_lying_at_different_distances(self):
        for height in (90, 160, 260):
            with self.subTest(height=height):
                _, p = posture_of(make_person("lying", height, view="side", ground_y=440))
                self.assertEqual(p.kind, LYING)

    def test_posture_does_not_depend_on_distance(self):
        scores = []
        for height in (80, 160, 320):
            _, p = posture_of(make_person("sitting", height, view="side", ground_y=470))
            scores.append(p.scores)
        for s in scores[1:]:
            for kind, value in s.items():
                self.assertAlmostEqual(value, scores[0][kind], delta=0.05)

    def test_a_standing_person_with_realistic_keypoint_jitter_is_never_misread(self):
        for seed in range(25):
            for height, noise in ((100, 1.5), (300, 2.5)):
                with self.subTest(seed=seed, height=height):
                    _, p = posture_of(make_person("standing", height, noise_px=noise, seed=seed, ground_y=470))
                    self.assertEqual(p.kind, UPRIGHT)

    def test_a_crouching_person_is_ambiguous_not_sitting_or_standing(self):
        person = make_person("sitting", 300, view="side", ground_y=460)
        hip_y = person["keypoints"][11]["y"]
        for kp in person["keypoints"]:
            if kp["id"] in (15, 16):          # feet pulled up under the hips
                kp["y"] = hip_y + 10
        _, p = posture_of(person)
        self.assertEqual(p.kind, POSTURE_UNKNOWN)
        self.assertEqual(p.score, 0.0)

    def test_an_inverted_body_is_not_lying_down(self):
        """Upside-down image or a hanging person: torso and legs point the wrong way, so nothing is claimed."""
        person = make_person("standing", 300, ground_y=460)
        hip_y = (person["keypoints"][11]["y"] + person["keypoints"][12]["y"]) / 2
        for kp in person["keypoints"]:
            kp["y"] = round(2 * hip_y - kp["y"], 1)
        person["keypoints"] = [k for k in person["keypoints"]]
        _, p = posture_of(person, h=2000)
        self.assertEqual(p.kind, POSTURE_UNKNOWN)

    def test_lying_with_the_torso_horizontal_but_legs_vertical_is_bending_not_lying(self):
        _, p = posture_of(make_person("bending", 300, view="side", lean_deg=90, ground_y=460))
        self.assertEqual(p.kind, BENDING)
        self.assertLess(p.scores[LYING], 0.2)

    def test_scores_expose_every_candidate_posture(self):
        _, p = posture_of(make_person("standing", 300))
        self.assertEqual(set(p.scores), {UPRIGHT, SITTING, BENDING, LYING})

    def test_thresholds_are_configurable(self):
        person = make_person("sitting", 300, view="side", ground_y=460)
        v = assess_visibility(person, W, H, CFG)
        strict = replace(CFG, posture_min_score=1.01)
        self.assertEqual(classify_posture(v.keypoints, person["bbox"], v.mode, strict).kind, POSTURE_UNKNOWN)


class MissingDataTests(unittest.TestCase):
    def test_partial_and_insufficient_bodies_are_never_classified(self):
        for person in (
            make_person("standing", 300, hide=("ankles",)),     # partial
            make_person("standing", 300, conf=0.2),             # insufficient
            make_person("standing", 25),                        # too small
        ):
            v, p = posture_of(person)
            self.assertFalse(v.has_evidence)
            self.assertEqual(p.kind, POSTURE_UNKNOWN)

    def test_too_few_keypoints_for_a_full_body_posture_is_unknown_not_an_error(self):
        kp = ReliableKeypoints(pts={5: (100.0, 100.0, 0.9), 11: (100.0, 200.0, 0.9)})
        p = classify_full_body(kp, {"width": 50, "height": 200}, CFG)
        self.assertEqual(p.kind, POSTURE_UNKNOWN)

    def test_degenerate_geometry_does_not_divide_by_zero(self):
        person = make_person("standing", 300)
        for kp in person["keypoints"]:
            kp["x"], kp["y"] = 200.0, 200.0          # every joint on one point
        v = assess_visibility(person, W, H, CFG)
        p = classify_posture(v.keypoints, person["bbox"], MODE_FULL, CFG)
        self.assertEqual(p.kind, POSTURE_UNKNOWN)


class UpperBodyPostureTests(unittest.TestCase):
    def test_neutral_upper_body(self):
        v, p = posture_of(make_person("standing", 300, hide=("legs",)))
        self.assertEqual(v.mode, MODE_UPPER)
        self.assertEqual(p.kind, UPPER_NEUTRAL)

    def test_raised_hands(self):
        v, p = posture_of(make_person("standing", 300, hide=("legs",), hands_up=True))
        self.assertEqual(p.kind, UPPER_RAISING)
        self.assertGreater(p.features["hand_rise"], 0.4)

    def test_one_raised_hand_is_enough(self):
        person = make_person("standing", 300, hide=("legs",))
        shoulder_y = person["keypoints"][5]["y"]
        person["keypoints"][9]["y"] = shoulder_y - 90         # left wrist well above the shoulders
        _, p = posture_of(person)
        self.assertEqual(p.kind, UPPER_RAISING)

    def test_upper_body_bending(self):
        _, p = posture_of(make_person("bending", 300, view="side", hide=("legs",)))
        self.assertEqual(p.kind, UPPER_BENDING)

    def test_tilted_shoulders_count_as_upper_body_bending(self):
        person = make_person("standing", 300, hide=("legs",))
        person["keypoints"][5]["y"] += 60                     # one shoulder dropped: leaning sideways
        _, p = posture_of(person)
        self.assertEqual(p.kind, UPPER_BENDING)

    def test_upper_body_posture_at_different_distances(self):
        for height in (120, 240, 420):
            with self.subTest(height=height):
                self.assertEqual(posture_of(make_person("standing", height, hide=("legs",), ground_y=470))[1].kind, UPPER_NEUTRAL)
                self.assertEqual(posture_of(make_person("standing", height, hide=("legs",), hands_up=True, ground_y=470))[1].kind, UPPER_RAISING)

    def test_missing_arms_in_upper_body_mode_cannot_claim_raised_hands(self):
        person = make_person("standing", 300, hide=("legs", "arms"), hands_up=True)
        _, p = posture_of(person)
        self.assertNotEqual(p.kind, UPPER_RAISING)

    def test_without_a_head_position_neutral_is_less_certain(self):
        with_head = posture_of(make_person("standing", 300, hide=("legs",)))[1]
        no_head = posture_of(make_person("standing", 300, hide=("legs", "head")))[1]
        self.assertGreater(with_head.scores[UPPER_NEUTRAL], no_head.scores[UPPER_NEUTRAL])


if __name__ == "__main__":
    unittest.main()

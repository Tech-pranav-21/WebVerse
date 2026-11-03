"""
Adaptive body-visibility tests: which parts of the body may be trusted, and therefore what may be classified.
Skeletons come from pose_fixtures (exact poses at any distance); no model is loaded here.
"""

import unittest
from dataclasses import replace

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
from pose_fixtures import clamp_to_frame, make_person
from visibility import KEYPOINT_WEIGHTS, assess_visibility, extract_reliable

W, H = 640, 480
CFG = ActivityConfig()


def vis(person, cfg=CFG, w=W, h=H):
    return assess_visibility(person, w, h, cfg)


class FullBodyTests(unittest.TestCase):
    def test_full_body_is_recognised_with_good_quality(self):
        v = vis(make_person("standing", 300))
        self.assertEqual(v.mode, MODE_FULL)
        self.assertEqual(v.quality, QUALITY_GOOD)
        self.assertGreaterEqual(v.score, 0.95)
        self.assertEqual(v.reliable_count, 17)
        self.assertEqual(v.missing_regions, [])
        self.assertTrue(v.has_evidence)

    def test_distance_does_not_change_the_mode(self):
        """A person 60 px or 420 px tall is judged the same way (everything is ratios, not pixels)."""
        for height in (60, 90, 120, 200, 300, 420):
            with self.subTest(height=height):
                v = vis(make_person("standing", height, ground_y=470))
                self.assertEqual(v.mode, MODE_FULL)
                self.assertAlmostEqual(v.score, 1.0, places=2)

    def test_person_too_small_or_far_is_insufficient_even_with_perfect_keypoints(self):
        v = vis(make_person("standing", 30))
        self.assertEqual(v.mode, MODE_INSUFFICIENT)
        self.assertEqual(v.quality, QUALITY_INSUFFICIENT)
        self.assertIn("too small", v.reason)
        self.assertFalse(v.has_evidence)

    def test_a_lying_person_is_not_rejected_for_having_a_short_box(self):
        """Regression: size is the box's largest side. A person lying down is wide, only ~25 px tall."""
        person = make_person("lying", 160, view="side", ground_y=440)
        self.assertLess(person["bbox"]["height"], 40)
        self.assertGreater(person["bbox"]["width"], 100)
        self.assertEqual(vis(person).mode, MODE_FULL)

    def test_a_waist_up_shot_is_not_rejected_for_having_a_short_box(self):
        person = make_person("standing", 120, hide=("legs",), hands_up=True, ground_y=470)
        self.assertLess(person["bbox"]["height"], 40)
        self.assertEqual(vis(person).mode, MODE_UPPER)

    def test_minimum_person_height_is_configurable(self):
        person = make_person("standing", 60)
        self.assertEqual(vis(person).mode, MODE_FULL)
        self.assertEqual(vis(person, replace(CFG, min_person_size_px=200)).mode, MODE_INSUFFICIENT)

    def test_missing_arms_do_not_prevent_full_body_classification(self):
        v = vis(make_person("standing", 300, hide=("arms",)))
        self.assertEqual(v.mode, MODE_FULL)
        self.assertIn("arms", v.missing_regions)
        self.assertLess(v.score, 1.0)

    def test_one_missing_leg_still_counts_as_full_body(self):
        v = vis(make_person("standing", 300, hide=("right_leg",)))
        self.assertEqual(v.mode, MODE_FULL)

    def test_missing_head_does_not_prevent_full_body(self):
        v = vis(make_person("standing", 300, hide=("head",)))
        self.assertEqual(v.mode, MODE_FULL)
        self.assertIn("head", v.missing_regions)


class UpperBodyTests(unittest.TestCase):
    def test_legs_not_visible_gives_upper_body_mode(self):
        v = vis(make_person("standing", 300, hide=("legs",)))
        self.assertEqual(v.mode, MODE_UPPER)
        self.assertIn("legs", v.missing_regions)
        self.assertIn("upper-body", v.reason)
        self.assertTrue(v.has_evidence)

    def test_hips_and_legs_not_visible_is_still_upper_body(self):
        self.assertEqual(vis(make_person("standing", 300, hide=("hips", "legs"))).mode, MODE_UPPER)

    def test_knees_and_ankles_missing_with_hips_visible_is_upper_body(self):
        """A waist-up shot: hips are in view but nothing below them."""
        self.assertEqual(vis(make_person("standing", 300, hide=("lower_legs",))).mode, MODE_UPPER)

    def test_upper_body_at_different_distances(self):
        for height in (100, 200, 400):
            with self.subTest(height=height):
                self.assertEqual(vis(make_person("standing", height, hide=("legs",), ground_y=470)).mode, MODE_UPPER)


class PartialBodyTests(unittest.TestCase):
    def test_ankles_missing_is_partial_not_a_guess(self):
        v = vis(make_person("standing", 300, hide=("ankles",)))
        self.assertEqual(v.mode, MODE_PARTIAL)
        self.assertIn("legs", v.reason)
        self.assertFalse(v.has_evidence)

    def test_partial_quality_never_exceeds_poor(self):
        v = vis(make_person("standing", 300, hide=("ankles",)))
        self.assertIn(v.quality, (QUALITY_POOR, QUALITY_INSUFFICIENT))

    def test_both_shoulders_missing_is_partial(self):
        v = vis(make_person("standing", 300, hide=(5, 6)))
        self.assertEqual(v.mode, MODE_PARTIAL)
        self.assertIn("shoulders", v.reason)

    def test_person_close_to_the_camera_with_only_the_feet_cut_off_is_partial(self):
        """Hips and knees are in view but the ankles are below the frame: not enough to call it upright."""
        close = clamp_to_frame(make_person("standing", 640, ground_y=640, cx=320), W, H)
        v = vis(close)
        self.assertEqual(v.mode, MODE_PARTIAL)
        self.assertIn("bottom of the frame", v.reason)

    def test_person_so_close_that_only_the_upper_body_is_in_frame_is_upper_body_and_says_why(self):
        close = clamp_to_frame(make_person("standing", 800, ground_y=700, cx=320), W, H)
        v = vis(close)
        self.assertEqual(v.mode, MODE_UPPER)
        self.assertIn("bottom of the frame", v.reason)


class KeypointQualityTests(unittest.TestCase):
    def test_all_keypoints_low_confidence_is_insufficient(self):
        v = vis(make_person("standing", 300, conf=0.3))
        self.assertEqual(v.mode, MODE_INSUFFICIENT)
        self.assertEqual(v.reliable_count, 0)
        self.assertEqual(v.quality, QUALITY_INSUFFICIENT)

    def test_confidence_threshold_is_inclusive_and_exact(self):
        at = make_person("standing", 300, conf_overrides={9: 0.5})
        below = make_person("standing", 300, conf_overrides={9: 0.499})
        self.assertIn(9, extract_reliable(at, W, H, CFG))
        self.assertNotIn(9, extract_reliable(below, W, H, CFG))

    def test_threshold_is_configurable(self):
        person = make_person("standing", 300, conf=0.7)
        self.assertEqual(vis(person).mode, MODE_FULL)
        self.assertEqual(vis(person, replace(CFG, keypoint_min_conf=0.8)).mode, MODE_INSUFFICIENT)

    def test_keypoints_are_not_all_equally_valuable(self):
        """Losing both hips costs far more visibility than losing both ears."""
        no_ears = vis(make_person("standing", 300, hide=(3, 4))).score
        no_hips = vis(make_person("standing", 300, hide=("hips",))).score
        self.assertGreater(no_ears, no_hips)
        self.assertGreater(KEYPOINT_WEIGHTS[11], KEYPOINT_WEIGHTS[3])

    def test_a_keypoint_at_the_origin_is_a_missing_joint(self):
        person = make_person("standing", 300)
        person["keypoints"][9].update(x=0.0, y=0.0, confidence=0.99)
        self.assertNotIn(9, extract_reliable(person, W, H, CFG))

    def test_keypoint_pinned_to_the_image_border_is_not_trusted_even_when_confident(self):
        """YOLO pins joints it cannot see to the border and often gives them a high confidence."""
        person = make_person("standing", 300)
        person["keypoints"][10].update(x=W, y=300.0, confidence=0.99)
        person["keypoints"][9].update(x=200.0, y=H, confidence=0.99)
        reliable = extract_reliable(person, W, H, CFG)
        self.assertNotIn(10, reliable)
        self.assertNotIn(9, reliable)

    def test_keypoint_outside_the_image_is_not_trusted(self):
        person = make_person("standing", 300)
        person["keypoints"][15].update(x=300.0, y=H + 40, confidence=0.95)
        self.assertNotIn(15, extract_reliable(person, W, H, CFG))

    def test_malformed_keypoints_are_ignored_not_fatal(self):
        person = make_person("standing", 300)
        person["keypoints"][3] = {"id": 3}                                    # no coordinates
        person["keypoints"][4] = {"id": 4, "x": "nan?", "y": None, "confidence": 0.9}
        person["keypoints"].append({"id": 99, "x": 5, "y": 5, "confidence": 0.9})   # not a COCO point
        v = vis(person)
        self.assertEqual(v.mode, MODE_FULL)
        self.assertNotIn(3, v.keypoints)
        self.assertNotIn(4, v.keypoints)

    def test_person_without_keypoints_is_insufficient(self):
        for person in (
            {"bbox": {"height": 300, "width": 100}, "bbox_confidence": 0.9},
            {"bbox": {"height": 300, "width": 100}, "bbox_confidence": 0.9, "keypoints": []},
            {"bbox": {}, "keypoints": None},
        ):
            with self.subTest(person=person):
                self.assertEqual(vis(person).mode, MODE_INSUFFICIENT)

    def test_quality_levels_follow_the_configured_cutoffs(self):
        person = make_person("standing", 300)          # quality score ~0.96
        self.assertEqual(vis(person).quality, QUALITY_GOOD)
        self.assertEqual(vis(person, replace(CFG, quality_good=0.99, quality_medium=0.90)).quality, QUALITY_MEDIUM)
        self.assertEqual(
            vis(person, replace(CFG, quality_good=0.99, quality_medium=0.98, quality_poor=0.90)).quality, QUALITY_POOR
        )
        strict = replace(CFG, quality_good=0.999, quality_medium=0.998, quality_poor=0.99)
        self.assertEqual(vis(person, strict).mode, MODE_INSUFFICIENT)

    def test_quality_reflects_keypoint_confidence_not_just_count(self):
        sure = vis(make_person("standing", 300, conf=0.97))
        unsure = vis(make_person("standing", 300, conf=0.55, bbox_conf=0.4))
        self.assertGreater(sure.quality_score, unsure.quality_score)


if __name__ == "__main__":
    unittest.main()

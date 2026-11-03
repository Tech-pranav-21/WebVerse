"""
Activity recognition on REAL YOLOv8 pose output (not synthetic skeletons).

The input is the project's photograph and variants derived from it. Sequences feed the real model one
frame at a time with explicit timestamps; the movement is real keypoint movement (the person pasted at
shifting positions), so detector jitter is part of the test.
"""

import unittest

from PIL import Image

from activity_engine import ActivityEngine
from activity_types import (
    ActivityConfig,
    INSUFFICIENT_VISIBILITY,
    LYING_DOWN,
    MODE_FULL,
    MODE_PARTIAL,
    MODE_UPPER,
    PARTIAL_BODY,
    RAISING_HANDS,
    RUNNING,
    STANDING,
    UNKNOWN,
    UPPER_BODY_BENDING,
    UPPER_BODY_INACTIVITY,
    WALKING,
)
from photo_fixtures import canvas_with_person, load_photo, moving_person_frames
from pose_estimator import estimate_pose

UPPER_BODY_LABELS = {UPPER_BODY_INACTIVITY, UPPER_BODY_BENDING, RAISING_HANDS, "Arm Movement"}
FULL_BODY_LABELS = {STANDING, WALKING, RUNNING, "Sitting", "Bending", LYING_DOWN, "Prolonged Inactivity", "Possible Sleeping"}


def analyse(image: Image.Image, engine=None, session="real", t=0.0, track=True):
    engine = engine or ActivityEngine(ActivityConfig())
    result = estimate_pose(image)
    engine.attach(result, session, track=track, timestamp=t)
    return result


def one_person(result):
    assert result["person_count"] == 1, f"expected exactly one detected person, got {result['person_count']}"
    return result["persons"][0]["activity"]


class FullBodyRealPhotoTests(unittest.TestCase):
    def test_a_standing_person_is_full_body_with_good_quality(self):
        a = one_person(analyse(load_photo()))
        self.assertEqual(a["visibility_mode"], MODE_FULL)
        self.assertEqual(a["detection_quality"], "good")
        self.assertGreaterEqual(a["body_visibility"], 0.95)
        self.assertEqual(a["evidence"]["posture"], "upright")
        self.assertEqual(a["label"], STANDING)

    def test_one_frame_is_only_a_provisional_standing_and_says_why(self):
        a = one_person(analyse(load_photo()))
        self.assertFalse(a["confirmed"])
        self.assertEqual(a["tracking_status"], "initializing")
        self.assertIn("single frame", a["note"])
        self.assertLess(a["confidence"], 0.5)

    def test_the_same_scene_repeated_becomes_a_confirmed_standing(self):
        engine, photo = ActivityEngine(ActivityConfig()), load_photo()
        for i in range(5):
            a = one_person(analyse(photo, engine, t=float(i)))
        self.assertEqual((a["label"], a["confirmed"]), (STANDING, True))
        self.assertEqual(a["tracking_status"], "tracking")
        self.assertEqual(a["track_id"], 1)
        self.assertLess(a["evidence"]["speed_tl_s"], 0.2)
        self.assertGreater(a["confidence"], 0.7)

    def test_the_person_far_away_is_still_classified_when_big_enough(self):
        far = canvas_with_person((1200, 896), 140, 540, 560)
        a = one_person(analyse(far))
        self.assertEqual(a["visibility_mode"], MODE_FULL)
        self.assertEqual(a["label"], STANDING)

    def test_a_person_closer_than_the_frame_can_hold_is_partial_and_not_guessed(self):
        photo = load_photo()
        close = photo.crop((380, 150, 820, 700))           # legs cut off by the bottom of the frame
        a = one_person(analyse(close))
        self.assertEqual(a["visibility_mode"], MODE_PARTIAL)
        self.assertEqual(a["label"], PARTIAL_BODY)
        self.assertIsNone(a["confidence"])
        self.assertIn("legs", a["note"])
        self.assertIn(a["detection_quality"], ("poor", "insufficient"))


class UpperBodyRealPhotoTests(unittest.TestCase):
    def test_a_waist_up_view_only_gets_upper_body_activities(self):
        photo = load_photo()
        for bottom in (400, 520):                          # above the hips / through the thighs
            with self.subTest(cropped_at=bottom):
                a = one_person(analyse(photo.crop((0, 0, photo.width, bottom))))
                self.assertEqual(a["visibility_mode"], MODE_UPPER)
                self.assertIn(a["label"], UPPER_BODY_LABELS)
                self.assertNotIn(a["label"], FULL_BODY_LABELS)
                self.assertIn("legs", a["missing_regions"])
                self.assertLess(a["body_visibility"], 0.75)

    def test_hallucinated_hips_on_the_image_border_are_not_trusted(self):
        """On the crop above the hips YOLO invents hips/wrists pinned to the bottom edge. They must not count."""
        photo = load_photo()
        cropped = photo.crop((0, 0, photo.width, 400))
        result = estimate_pose(cropped)
        names = {k["name"]: k for k in result["persons"][0]["keypoints"]}
        self.assertGreaterEqual(names["right_wrist"]["y"], cropped.height - 2, "the wrist really is on the border")
        a = one_person(analyse(cropped))
        self.assertEqual(a["visibility_mode"], MODE_UPPER)


class LyingRealPhotoTests(unittest.TestCase):
    def test_the_photo_rotated_to_horizontal_is_lying_down(self):
        a = one_person(analyse(load_photo().rotate(90, expand=True)))
        self.assertEqual(a["evidence"]["posture"], "lying")
        self.assertEqual(a["label"], LYING_DOWN)
        self.assertEqual(a["visibility_mode"], MODE_FULL)

    def test_an_upside_down_photo_is_never_called_lying_down(self):
        a = one_person(analyse(load_photo().rotate(180, expand=True)))
        self.assertNotEqual(a["label"], LYING_DOWN)

    def test_a_pose_the_geometry_cannot_explain_is_unknown_not_forced_into_a_label(self):
        """Rotated the other way the model's skeleton is twisted: torso horizontal, legs not."""
        a = one_person(analyse(load_photo().rotate(270, expand=True)))
        self.assertIn(a["label"], (UNKNOWN, LYING_DOWN))
        if a["label"] == UNKNOWN:
            self.assertIsNone(a["confidence"])


class NothingToClassifyTests(unittest.TestCase):
    def test_no_person_means_no_activity_and_no_error(self):
        result = analyse(Image.new("RGB", (640, 480), (90, 90, 90)))
        self.assertEqual(result["person_count"], 0)
        self.assertEqual(result["activity_recognition"]["persons_analyzed"], 0)
        self.assertEqual(result["activity_recognition"]["lost_tracks"], [])

    def test_a_person_who_leaves_the_view_is_reported_as_lost(self):
        engine, photo = ActivityEngine(ActivityConfig()), load_photo()
        analyse(photo, engine, t=0.0)
        gone = analyse(Image.new("RGB", (640, 480), (90, 90, 90)), engine, t=1.0)
        lost = gone["activity_recognition"]["lost_tracks"]
        self.assertEqual([entry["track_id"] for entry in lost], [1])
        back = analyse(photo, engine, t=2.0)
        a = one_person(back)
        self.assertEqual((a["track_id"], a["tracking_status"]), (1, "reacquired"))


class RealMovementTests(unittest.TestCase):
    """The real model sees the person at shifting positions: detector jitter is part of the signal."""

    def run_sequence(self, frames, dt):
        engine = ActivityEngine(ActivityConfig())
        out = None
        for i, frame in enumerate(frames):
            out = one_person(analyse(frame, engine, t=i * dt))
        return out

    def test_a_person_who_does_not_move_is_standing(self):
        frames = moving_person_frames(6, px_per_frame=0)
        a = self.run_sequence(frames, dt=1.0)
        self.assertEqual((a["label"], a["confirmed"]), (STANDING, True))

    def test_a_person_moving_sideways_at_walking_speed_is_walking(self):
        # torso ~ 85 px at this size: 110 px per second ~ 1.3 torso lengths per second
        frames = moving_person_frames(8, px_per_frame=110)
        a = self.run_sequence(frames, dt=1.0)
        self.assertEqual((a["label"], a["confirmed"]), (WALKING, True))
        self.assertTrue(0.9 < a["evidence"]["speed_tl_s"] < 2.2, a["evidence"]["speed_tl_s"])
        self.assertEqual(a["track_id"], 1, "one person, one id for the whole sequence")

    def test_a_person_moving_sideways_at_running_speed_is_running(self):
        # A 200 px person has a ~54 px torso. 5 FPS and 60 px per frame = 300 px/s ~ 5.5 torso lengths/s.
        # Movement needs ~1 s to be measurable and the activity 1.5 s to be confirmed: 14 frames = 2.6 s.
        frames = moving_person_frames(14, px_per_frame=60, person_height=200)
        a = self.run_sequence(frames, dt=0.2)
        self.assertEqual((a["label"], a["confirmed"]), (RUNNING, True))
        self.assertEqual(a["track_id"], 1)
        self.assertGreater(a["evidence"]["speed_tl_s"], 4.6)

    def test_standing_then_walking_with_the_real_model(self):
        engine = ActivityEngine(ActivityConfig())
        still = moving_person_frames(4, px_per_frame=0)
        for i, f in enumerate(still):
            one_person(analyse(f, engine, t=float(i)))
        walking = moving_person_frames(8, px_per_frame=110)
        for i, f in enumerate(walking):
            a = one_person(analyse(f, engine, t=4.0 + i))
        self.assertEqual(a["label"], WALKING)
        self.assertEqual(a["previous_label"], STANDING)


if __name__ == "__main__":
    unittest.main()

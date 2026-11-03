"""
Pose-estimation tests with the REAL YOLOv8 pose model (CPU or GPU, whichever the service would use).

Covers: a person detected, no person, missing keypoints, low-confidence keypoints, the unchanged result
format, invalid input and a model that failed to load. Run from the activity-recognition folder.
"""

import io
import unittest
from unittest import mock

import numpy as np
from PIL import Image

import pose_estimator
from config import KEYPOINT_NAMES
from photo_fixtures import canvas_with_person, jpeg_bytes, load_photo
from pose_estimator import (
    InvalidImageError,
    ModelNotLoadedError,
    PoseEstimationError,
    annotate_image_bytes,
    decode_image_bytes,
    estimate_pose,
)

EXPECTED_TOP_LEVEL = {
    "ok", "person_count", "persons", "image_width", "image_height",
    "inference_time_ms", "total_time_ms", "device", "model",
}
EXPECTED_PERSON = {"person_id", "bbox", "bbox_confidence", "keypoints", "visible_keypoints", "total_keypoints"}


class PersonDetectedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.photo = load_photo()
        cls.result = estimate_pose(cls.photo)

    def test_one_person_is_found_with_all_17_keypoints(self):
        r = self.result
        self.assertTrue(r["ok"])
        self.assertEqual(r["person_count"], 1)
        person = r["persons"][0]
        self.assertEqual(len(person["keypoints"]), 17)
        self.assertEqual([k["name"] for k in person["keypoints"]], KEYPOINT_NAMES)
        self.assertGreaterEqual(person["visible_keypoints"], 15)
        self.assertGreater(person["bbox_confidence"], 0.5)

    def test_the_result_format_is_unchanged_by_activity_recognition(self):
        """estimate_pose is still pure pose estimation: activity is added by the engine, not here."""
        self.assertEqual(set(self.result), EXPECTED_TOP_LEVEL)
        self.assertEqual(set(self.result["persons"][0]), EXPECTED_PERSON)

    def test_the_box_surrounds_the_person_and_keypoints_are_inside_the_image(self):
        person = self.result["persons"][0]
        w, h = self.photo.size
        self.assertEqual((self.result["image_width"], self.result["image_height"]), (w, h))
        box = person["bbox"]
        self.assertGreater(box["height"], box["width"], "a standing person's box is taller than wide")
        for kp in person["keypoints"]:
            if kp["visible"]:
                self.assertTrue(0 <= kp["x"] <= w and 0 <= kp["y"] <= h)

    def test_bytes_and_pil_inputs_agree(self):
        from_bytes = estimate_pose(jpeg_bytes(self.photo, quality=95))
        self.assertEqual(from_bytes["person_count"], 1)
        a = {k["name"]: (k["x"], k["y"]) for k in self.result["persons"][0]["keypoints"]}
        b = {k["name"]: (k["x"], k["y"]) for k in from_bytes["persons"][0]["keypoints"]}
        for name in ("left_shoulder", "right_hip", "left_ankle"):
            self.assertAlmostEqual(a[name][0], b[name][0], delta=6)
            self.assertAlmostEqual(a[name][1], b[name][1], delta=6)

    def test_inference_reports_its_device_and_latency(self):
        self.assertIn(self.result["device"].split(":")[0], ("cpu", "cuda"))
        self.assertGreater(self.result["inference_time_ms"], 0)
        self.assertGreaterEqual(self.result["total_time_ms"], self.result["inference_time_ms"])


class NoPersonTests(unittest.TestCase):
    def test_a_blank_frame_has_no_person(self):
        r = estimate_pose(Image.new("RGB", (640, 480), (128, 128, 128)))
        self.assertTrue(r["ok"])
        self.assertEqual((r["person_count"], r["persons"]), (0, []))

    def test_random_noise_has_no_person(self):
        rng = np.random.default_rng(7)
        noise = Image.fromarray(rng.integers(0, 255, (480, 640, 3), dtype=np.uint8))
        self.assertEqual(estimate_pose(noise)["person_count"], 0)

    def test_a_person_too_small_to_detect_is_not_invented(self):
        tiny = canvas_with_person((1200, 896), 45, 500, 600)
        r = estimate_pose(tiny)
        for person in r["persons"]:                    # if the model does find something, it must be tiny
            self.assertLess(person["bbox"]["height"], 80)


class MissingAndLowConfidenceKeypointTests(unittest.TestCase):
    def test_a_cropped_body_keeps_the_person_but_reports_the_missing_joints(self):
        """Upper body only (cut above the hips): the model still finds the person, legs are not visible."""
        photo = load_photo()
        r = estimate_pose(photo.crop((0, 0, photo.width, 400)))
        self.assertEqual(r["person_count"], 1)
        by_name = {k["name"]: k for k in r["persons"][0]["keypoints"]}
        for name in ("left_knee", "right_knee", "left_ankle", "right_ankle"):
            self.assertFalse(by_name[name]["visible"], name)
        for name in ("nose", "left_shoulder", "right_shoulder"):
            self.assertTrue(by_name[name]["visible"], name)
        self.assertLess(r["persons"][0]["visible_keypoints"], 14)

    def test_the_visibility_flag_follows_the_keypoint_threshold(self):
        photo = load_photo()
        lenient = estimate_pose(photo, keypoint_conf_threshold=0.05)["persons"][0]
        default = estimate_pose(photo)["persons"][0]
        strict = estimate_pose(photo, keypoint_conf_threshold=0.9999)["persons"][0]
        self.assertGreaterEqual(lenient["visible_keypoints"], default["visible_keypoints"])
        self.assertLess(strict["visible_keypoints"], default["visible_keypoints"])
        # the numbers themselves do not change, only the flag
        self.assertEqual(
            [k["confidence"] for k in lenient["keypoints"]], [k["confidence"] for k in strict["keypoints"]]
        )

    def test_low_confidence_joints_of_a_real_detection_carry_their_low_confidence(self):
        photo = load_photo()
        r = estimate_pose(photo.crop((0, 0, photo.width, 400)))
        legs = [k for k in r["persons"][0]["keypoints"] if k["name"].endswith(("knee", "ankle"))]
        self.assertTrue(all(k["confidence"] < 0.4 for k in legs))


class ErrorHandlingTests(unittest.TestCase):
    def test_unreadable_images_raise_a_clear_error(self):
        for bad in (b"", b"not an image at all, just text bytes", b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"):
            with self.subTest(size=len(bad)):
                with self.assertRaises(InvalidImageError):
                    estimate_pose(bad)

    def test_a_truncated_jpeg_is_rejected(self):
        data = jpeg_bytes(load_photo())
        with self.assertRaises(InvalidImageError):
            decode_image_bytes(data[: len(data) // 3])

    def test_model_that_failed_to_load_raises_model_not_loaded(self):
        dead = mock.Mock(loaded=False, model=None)
        with mock.patch.object(pose_estimator, "get_model_manager", return_value=dead):
            with self.assertRaises(ModelNotLoadedError):
                estimate_pose(Image.new("RGB", (64, 64)))
        self.assertTrue(issubclass(ModelNotLoadedError, PoseEstimationError))

    def test_a_crash_inside_the_model_is_wrapped(self):
        broken = mock.Mock(loaded=True, device="cpu", model_name="x")
        broken.model.predict.side_effect = RuntimeError("CUDA out of memory")
        with mock.patch.object(pose_estimator, "get_model_manager", return_value=broken):
            with self.assertRaisesRegex(PoseEstimationError, "CUDA out of memory"):
                estimate_pose(Image.new("RGB", (64, 64)))


class OverlayTests(unittest.TestCase):
    def test_the_overlay_shows_the_activity_when_there_is_one(self):
        photo_bytes = jpeg_bytes(load_photo())
        result = estimate_pose(photo_bytes)
        plain = annotate_image_bytes(photo_bytes, result)
        result["persons"][0]["track_id"] = 3
        result["persons"][0]["activity"] = {"label": "Walking", "confidence": 0.92}
        labelled = annotate_image_bytes(photo_bytes, result)
        self.assertEqual(Image.open(io.BytesIO(labelled)).size, load_photo().size)
        self.assertNotEqual(plain, labelled, "the banner text must change when an activity is attached")

    def test_the_overlay_copes_with_a_person_whose_activity_is_missing(self):
        photo_bytes = jpeg_bytes(load_photo())
        result = estimate_pose(photo_bytes)
        result["persons"][0]["activity"] = None
        self.assertEqual(Image.open(io.BytesIO(annotate_image_bytes(photo_bytes, result))).format, "JPEG")


if __name__ == "__main__":
    unittest.main()

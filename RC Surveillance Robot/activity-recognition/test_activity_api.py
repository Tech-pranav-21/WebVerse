"""
HTTP API tests: the extended /detect endpoint, tracking sessions, stateless /detect/visualize, error
handling (timeouts excluded: that is the client's job). Uses the real model through FastAPI's TestClient;
the engine clock is replaced so the time between frames is exact and independent of machine speed.
"""

import base64
import io
import json
import unittest
from unittest import mock

from fastapi.testclient import TestClient
from PIL import Image

import pose_estimator
import service
from activity_engine import get_activity_engine
from activity_types import ACTIVITY_FIELDS, ACTIVITY_LABELS, QUALITY_LEVELS, TRACKING_STATUSES, VISIBILITY_MODES
from photo_fixtures import jpeg_bytes, load_photo


class FakeClock:
    def __init__(self) -> None:
        self.t = 5000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


PHOTO_B64 = b64(jpeg_bytes(load_photo()))
BLANK_B64 = b64(jpeg_bytes(Image.new("RGB", (320, 240), (120, 120, 120))))


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(service.app)

    def setUp(self):
        self.engine = get_activity_engine()
        self.engine.reset()
        self.clock = FakeClock()
        self._real_clock = self.engine._clock
        self.engine._clock = self.clock
        self.addCleanup(self._restore)

    def _restore(self):
        self.engine._clock = self._real_clock
        self.engine.reset()

    def detect(self, image_b64=PHOTO_B64, **extra):
        return self.client.post("/detect", json={"imageBase64": image_b64, **extra})


class DetectContractTests(ApiTestCase):
    def test_existing_pose_fields_are_all_still_there(self):
        r = self.detect()
        self.assertEqual(r.status_code, 200)
        body = r.json()
        for key in ("ok", "person_count", "persons", "image_width", "image_height",
                    "inference_time_ms", "total_time_ms", "device", "model"):
            self.assertIn(key, body)
        person = body["persons"][0]
        for key in ("person_id", "bbox", "bbox_confidence", "keypoints", "visible_keypoints", "total_keypoints"):
            self.assertIn(key, person)
        self.assertEqual(len(person["keypoints"]), 17)

    def test_each_person_gets_a_track_id_and_a_complete_activity_object(self):
        body = self.detect(sessionId="contract").json()
        person = body["persons"][0]
        self.assertEqual(person["track_id"], 1)
        activity = person["activity"]
        self.assertEqual(list(activity), list(ACTIVITY_FIELDS), "exactly the fields the frontend type declares")
        self.assertIn(activity["label"], ACTIVITY_LABELS)
        self.assertIn(activity["visibility_mode"], VISIBILITY_MODES)
        self.assertIn(activity["detection_quality"], QUALITY_LEVELS)
        self.assertIn(activity["tracking_status"], TRACKING_STATUSES)
        self.assertEqual(activity["track_id"], person["track_id"])
        self.assertTrue(0 <= activity["body_visibility"] <= 1)
        self.assertTrue(0 <= activity["confidence"] <= 1)

    def test_the_summary_block_describes_what_happened(self):
        block = self.detect(sessionId="summary").json()["activity_recognition"]
        self.assertEqual(block["enabled"], True)
        self.assertEqual(block["tracking"], True)
        self.assertEqual(block["session_id"], "summary")
        self.assertEqual((block["persons_analyzed"], block["persons_skipped"]), (1, 0))
        self.assertEqual(block["lost_tracks"], [])

    def test_the_response_is_strict_json(self):
        """No NaN / Infinity: browsers' JSON.parse would reject the whole response."""
        text = self.detect().text
        json.loads(text, parse_constant=lambda c: self.fail(f"non-finite number in response: {c}"))

    def test_a_request_from_an_old_client_without_any_activity_field_still_works(self):
        r = self.client.post("/detect", json={"imageBase64": PHOTO_B64, "mimeType": "image/jpeg",
                                              "confThreshold": 0.35, "keypointThreshold": 0.4})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["persons"][0]["track_id"], 1)

    def test_no_person_gives_an_empty_but_well_formed_result(self):
        body = self.detect(BLANK_B64, sessionId="empty").json()
        self.assertEqual((body["person_count"], body["persons"]), (0, []))
        self.assertEqual(body["activity_recognition"]["persons_analyzed"], 0)

    def test_annotated_image_only_comes_back_when_asked_for(self):
        self.assertNotIn("annotated_image_base64", self.detect().json())
        body = self.detect(includeAnnotated=True).json()
        img = Image.open(io.BytesIO(base64.b64decode(body["annotated_image_base64"])))
        self.assertEqual(img.format, "JPEG")
        self.assertEqual(img.size, (body["image_width"], body["image_height"]))

    def test_multipart_upload_has_activity_too(self):
        r = self.client.post(
            "/detect/file", params={"session_id": "upload"},
            files={"file": ("p.jpg", jpeg_bytes(load_photo()), "image/jpeg")},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["persons"][0]["activity"]["track_id"], 1)

    def test_health_reports_activity_recognition(self):
        h = self.client.get("/health").json()
        self.assertIn("activity_recognition", h)
        self.assertTrue(h["activity_recognition"]["enabled"])
        self.assertIn("active_sessions", h["activity_recognition"])


class TrackingSessionTests(ApiTestCase):
    def activity(self, **extra):
        return self.detect(**extra).json()["persons"][0]["activity"]

    def test_consecutive_frames_of_one_session_build_one_history(self):
        first = self.activity(sessionId="cam-1")
        self.clock.advance(1.0)
        second = self.activity(sessionId="cam-1")
        self.clock.advance(1.0)
        third = self.activity(sessionId="cam-1")
        self.assertEqual([a["track_id"] for a in (first, second, third)], [1, 1, 1])
        self.assertEqual([a["observations"] for a in (first, second, third)], [1, 2, 3])
        self.assertTrue(third["confirmed"])
        self.assertEqual(third["label"], "Standing")

    def test_two_sessions_never_share_history(self):
        for _ in range(3):
            self.activity(sessionId="tab-a")
            self.clock.advance(1.0)
        other = self.activity(sessionId="tab-b")
        self.assertEqual(other["observations"], 1)
        self.assertFalse(other["confirmed"])

    def test_requests_without_a_session_id_share_the_default_session(self):
        self.activity()
        self.clock.advance(1.0)
        self.assertEqual(self.activity()["observations"], 2)

    def test_single_frame_requests_do_not_touch_the_history(self):
        self.activity(sessionId="live")
        self.clock.advance(1.0)
        single = self.activity(sessionId="live", trackActivity=False)
        self.assertEqual(single["tracking_status"], "untracked")
        self.assertIsNone(single["track_id"])
        self.assertEqual(single["observations"], 1)
        self.clock.advance(1.0)
        self.assertEqual(self.activity(sessionId="live")["observations"], 2, "the sample frame left no trace")

    def test_reset_tracking_starts_a_new_history(self):
        self.activity(sessionId="r")
        self.clock.advance(1.0)
        self.activity(sessionId="r")
        self.clock.advance(1.0)
        after = self.activity(sessionId="r", resetTracking=True)
        self.assertEqual((after["observations"], after["track_id"]), (1, 1))

    def test_visualize_is_stateless_a_frame_is_never_counted_twice(self):
        """
        The overlay endpoint must not touch tracking. The clock advances between the calls, so a frame it
        recorded would really be counted (frames in the same instant would merge and hide the mistake).
        """
        self.activity(sessionId="vis")
        for _ in range(3):
            self.clock.advance(1.0)
            r = self.client.post("/detect/visualize", json={"imageBase64": PHOTO_B64, "sessionId": "vis"})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.headers["content-type"], "image/jpeg")
        self.clock.advance(1.0)
        after = self.activity(sessionId="vis")
        self.assertEqual(after["observations"], 2, "only the two /detect calls may count")
        self.assertFalse(after["confirmed"], "two observations cannot confirm an activity")

    def test_the_person_leaving_and_returning_is_reported_in_lost_tracks(self):
        self.activity(sessionId="gone")
        self.clock.advance(1.0)
        empty = self.detect(BLANK_B64, sessionId="gone").json()
        self.assertEqual([t["track_id"] for t in empty["activity_recognition"]["lost_tracks"]], [1])
        self.clock.advance(1.0)
        back = self.activity(sessionId="gone")
        self.assertEqual((back["track_id"], back["tracking_status"]), (1, "reacquired"))

    def test_a_long_absence_starts_a_new_person(self):
        self.activity(sessionId="long")
        self.clock.advance(30.0)
        again = self.activity(sessionId="long")
        self.assertEqual((again["track_id"], again["observations"]), (2, 1))


class ErrorHandlingTests(ApiTestCase):
    def test_missing_image_field(self):
        self.assertIn(self.client.post("/detect", json={}).status_code, (400, 422))

    def test_malformed_base64(self):
        r = self.client.post("/detect", json={"imageBase64": "%%%not-base64%%%"})
        self.assertEqual(r.status_code, 400)

    def test_bytes_that_are_not_an_image(self):
        r = self.client.post("/detect", json={"imageBase64": b64(b"this is definitely not a jpeg file at all")})
        self.assertEqual(r.status_code, 400)
        self.assertIn("image", r.json()["detail"].lower())

    def test_truncated_image(self):
        data = jpeg_bytes(load_photo())
        self.assertEqual(self.client.post("/detect", json={"imageBase64": b64(data[:2000])}).status_code, 400)

    def test_invalid_session_ids_are_rejected(self):
        for bad in ("has space", "semi;colon", "x" * 65, "<script>"):
            with self.subTest(session=bad):
                self.assertEqual(self.detect(sessionId=bad).status_code, 422)

    def test_out_of_range_thresholds_are_rejected(self):
        self.assertEqual(self.detect(confThreshold=2.0).status_code, 422)
        self.assertEqual(self.detect(keypointThreshold=0.0).status_code, 422)

    def test_oversized_image_is_413(self):
        big = b64(b"\xff\xd8" + b"\x00" * (11 * 1024 * 1024))
        self.assertEqual(self.client.post("/detect", json={"imageBase64": big}).status_code, 413)

    def test_model_that_failed_to_load_is_503_with_a_clear_message(self):
        dead = mock.Mock(loaded=False, model=None)
        with mock.patch.object(pose_estimator, "get_model_manager", return_value=dead):
            for path in ("/detect", "/detect/visualize"):
                with self.subTest(path=path):
                    r = self.client.post(path, json={"imageBase64": PHOTO_B64})
                    self.assertEqual(r.status_code, 503)
                    self.assertIn("not loaded", r.json()["detail"])

    def test_an_inference_crash_is_a_500_with_the_reason(self):
        broken = mock.Mock(loaded=True, device="cpu", model_name="x")
        broken.model.predict.side_effect = RuntimeError("boom")
        with mock.patch.object(pose_estimator, "get_model_manager", return_value=broken):
            r = self.client.post("/detect", json={"imageBase64": PHOTO_B64})
        self.assertEqual(r.status_code, 500)
        self.assertIn("boom", r.json()["detail"])

    def test_a_bug_in_the_activity_layer_never_costs_the_pose_result(self):
        class Boom:
            def attach(self, *a, **k):
                raise RuntimeError("activity bug")

        with mock.patch.object(service, "get_activity_engine", return_value=Boom()):
            r = self.detect()
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["person_count"], 1)
        self.assertEqual(len(body["persons"][0]["keypoints"]), 17)
        self.assertIsNone(body["persons"][0]["activity"])
        self.assertIn("activity bug", body["activity_recognition"]["error"])

    def test_activity_recognition_can_be_switched_off(self):
        with mock.patch.object(service, "HAR_ENABLED", False):
            body = self.detect().json()
        self.assertEqual(body["activity_recognition"], {"enabled": False})
        self.assertEqual(body["person_count"], 1)
        self.assertNotIn("activity", body["persons"][0])


if __name__ == "__main__":
    unittest.main()

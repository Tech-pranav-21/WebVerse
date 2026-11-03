"""
Person-tracker tests: stable ids, no mixing of people, expiry when a person disappears, bounded state.
"""

import unittest
from dataclasses import replace

from activity_types import ActivityConfig
from person_tracker import Detection, PersonTracker, iou

CFG = ActivityConfig()


def box(cx, cy, w=100.0, h=300.0):
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def det(i, cx, cy=500.0, w=100.0, h=300.0):
    return Detection(index=i, bbox=box(cx, cy, w, h), confidence=0.9)


class IouTests(unittest.TestCase):
    def test_identical_disjoint_and_half_overlapping_boxes(self):
        self.assertEqual(iou((0, 0, 10, 10), (0, 0, 10, 10)), 1.0)
        self.assertEqual(iou((0, 0, 10, 10), (20, 20, 30, 30)), 0.0)
        self.assertAlmostEqual(iou((0, 0, 10, 10), (5, 0, 15, 10)), 1 / 3, places=3)

    def test_degenerate_boxes_do_not_crash(self):
        self.assertEqual(iou((0, 0, 0, 0), (0, 0, 0, 0)), 0.0)


class SinglePersonTests(unittest.TestCase):
    def test_one_person_keeps_the_same_id_while_moving(self):
        tracker = PersonTracker(CFG)
        ids = set()
        for frame in range(12):
            up = tracker.update([det(0, 200 + 120 * frame)], t=float(frame))
            ids.add(up.matches[0].track_id)
        self.assertEqual(ids, {1})

    def test_ids_start_at_one_and_a_new_person_gets_the_next_id(self):
        tracker = PersonTracker(CFG)
        tracker.update([det(0, 200)], t=0.0)
        up = tracker.update([det(0, 205), det(1, 1500)], t=1.0)
        self.assertEqual(up.matches[0].track_id, 1)
        self.assertEqual(up.matches[1].track_id, 2)

    def test_standing_to_lying_keeps_the_identity(self):
        """A fall changes the box from tall to wide around the same place; it must stay the same person."""
        tracker = PersonTracker(CFG)
        tracker.update([det(0, 600, 500, w=100, h=300)], t=0.0)
        up = tracker.update([det(0, 640, 600, w=300, h=100)], t=1.0)
        self.assertEqual(up.matches[0].track_id, 1)

    def test_a_much_larger_or_smaller_box_is_a_different_person(self):
        tracker = PersonTracker(CFG)
        tracker.update([det(0, 600, 500, w=100, h=300)], t=0.0)
        up = tracker.update([det(0, 610, 500, w=500, h=1500)], t=0.5)
        self.assertEqual(up.matches[0].track_id, 2)


class TwoPeopleTests(unittest.TestCase):
    def test_two_people_walking_past_each_other_keep_separate_ids(self):
        tracker = PersonTracker(CFG)
        # A walks right at y=400, B walks left at y=600; 1 FPS.
        for frame in range(8):
            a, b = det(0, 200 + 100 * frame, 400), det(1, 1200 - 100 * frame, 600)
            up = tracker.update([a, b], t=float(frame))
            if frame == 0:
                id_a, id_b = up.matches[0].track_id, up.matches[1].track_id
                self.assertNotEqual(id_a, id_b)
            self.assertEqual(up.matches[0].track_id, id_a, f"A swapped at frame {frame}")
            self.assertEqual(up.matches[1].track_id, id_b, f"B swapped at frame {frame}")

    def test_detection_order_does_not_matter(self):
        tracker = PersonTracker(CFG)
        tracker.update([det(0, 300), det(1, 1500)], t=0.0)
        up = tracker.update([det(0, 1510), det(1, 305)], t=1.0)       # the detector listed them the other way round
        self.assertEqual(up.matches[0].track_id, 2)
        self.assertEqual(up.matches[1].track_id, 1)


class DisappearanceTests(unittest.TestCase):
    def test_a_missed_frame_keeps_the_track_and_marks_it_lost_then_reacquired(self):
        tracker = PersonTracker(CFG)
        tracker.update([det(0, 300)], t=0.0)
        gone = tracker.update([], t=1.0)
        self.assertEqual([tr.track_id for tr in gone.lost], [1])
        back = tracker.update([det(0, 330)], t=2.0)
        self.assertEqual(back.matches[0].track_id, 1)
        self.assertTrue(back.matches[0].reacquired)

    def test_a_person_gone_longer_than_max_age_is_forgotten_and_gets_a_new_id(self):
        tracker = PersonTracker(replace(CFG, track_max_age_s=5.0))
        first = tracker.update([det(0, 300)], t=0.0).matches[0]
        first.payload = {"history": "of person one"}
        up = tracker.update([det(0, 305)], t=6.5)
        self.assertEqual([tr.track_id for tr in up.expired], [1])
        self.assertEqual(up.matches[0].track_id, 2)
        self.assertIsNone(up.matches[0].payload, "history must not carry over to the new person")

    def test_a_track_just_inside_max_age_survives(self):
        tracker = PersonTracker(replace(CFG, track_max_age_s=5.0))
        tracker.update([det(0, 300)], t=0.0)
        self.assertEqual(tracker.update([det(0, 300)], t=5.0).matches[0].track_id, 1)

    def test_a_new_person_arriving_while_the_old_one_is_missing_is_not_merged_when_far_away_in_size(self):
        tracker = PersonTracker(CFG)
        tracker.update([det(0, 300, w=100, h=300)], t=0.0)
        up = tracker.update([det(0, 2500, w=400, h=1200)], t=1.0)
        self.assertEqual(up.matches[0].track_id, 2)


class BoundedStateTests(unittest.TestCase):
    def test_track_count_never_exceeds_the_cap_even_with_a_flickering_detector(self):
        cfg = replace(CFG, max_tracks=6, track_max_age_s=1000.0)
        tracker = PersonTracker(cfg)
        for frame in range(200):
            # one false person at a new place every frame, never matching the previous ones
            tracker.update([det(0, 100 + (frame * 997) % 3000, 100 + (frame * 389) % 900, w=60, h=120)], t=float(frame))
            self.assertLessEqual(len(tracker.tracks), 6)

    def test_reset_forgets_everyone_and_restarts_ids(self):
        tracker = PersonTracker(CFG)
        tracker.update([det(0, 300)], t=0.0)
        tracker.reset()
        self.assertEqual(tracker.tracks, [])
        self.assertEqual(tracker.update([det(0, 300)], t=1.0).matches[0].track_id, 1)


if __name__ == "__main__":
    unittest.main()

/**
 * Contract between the Python service and the dashboard, checked against REAL service output
 * (tests/fixtures/*.json, recorded from the YOLOv8 model + activity engine; see tests/poseFixtures.ts).
 *
 * If the backend adds, renames or removes a field, or produces a label the dashboard does not know,
 * these tests fail (and so does activity-recognition/test_contract_fixtures.py on the Python side).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_FIELDS,
  ACTIVITY_LABELS,
  DETECTION_QUALITIES,
  TRACKING_STATUSES,
  VISIBILITY_MODES,
} from '../src/types/pose';
import { fixture, fixtureNames, onlyPerson, rawFixture } from './poseFixtures';

describe('real backend responses', () => {
  it('there is a fixture for every situation the dashboard has to show', () => {
    const names = fixtureNames();
    for (const wanted of [
      'pose-standing-single-frame',
      'pose-standing-confirmed',
      'pose-walking-confirmed',
      'pose-lying-down',
      'pose-possible-sleeping',
      'pose-upper-body',
      'pose-partial-legs-cut',
      'pose-insufficient-head-only',
      'pose-no-person',
      'pose-person-lost',
    ]) {
      assert.ok(names.includes(wanted), `missing fixture ${wanted}`);
    }
  });

  for (const name of fixtureNames()) {
    it(`${name}: is accepted by the validator and no activity is dropped`, () => {
      const result = fixture(name);
      assert.equal(result.activity_recognition?.error, undefined, 'a field the validator rejected would be reported here');
      const raw = rawFixture(name);
      assert.equal(result.persons.length, raw.persons.length);
      result.persons.forEach((p, i) => {
        assert.ok(p.activity, `person ${i} lost its activity in parsing`);
        assert.equal(p.track_id, raw.persons[i].track_id);
      });
    });

    it(`${name}: the activity object has exactly the fields the TypeScript type declares, in order`, () => {
      for (const person of rawFixture(name).persons) {
        assert.deepEqual(Object.keys(person.activity), [...ACTIVITY_FIELDS]);
      }
    });

    it(`${name}: every label, mode, quality and status is one the dashboard knows`, () => {
      for (const person of rawFixture(name).persons) {
        const a = person.activity;
        assert.ok((ACTIVITY_LABELS as readonly string[]).includes(a.label), a.label);
        assert.ok((ACTIVITY_LABELS as readonly string[]).includes(a.candidate_label), a.candidate_label);
        if (a.previous_label !== null) assert.ok((ACTIVITY_LABELS as readonly string[]).includes(a.previous_label));
        assert.ok((VISIBILITY_MODES as readonly string[]).includes(a.visibility_mode), a.visibility_mode);
        assert.ok((DETECTION_QUALITIES as readonly string[]).includes(a.detection_quality), a.detection_quality);
        assert.ok((TRACKING_STATUSES as readonly string[]).includes(a.tracking_status), a.tracking_status);
      }
    });
  }

  it('the pose fields the page already used are unchanged', () => {
    const r = rawFixture('pose-standing-confirmed');
    for (const key of ['ok', 'person_count', 'persons', 'image_width', 'image_height', 'inference_time_ms', 'total_time_ms', 'device', 'model']) {
      assert.ok(key in r, key);
    }
    const p = r.persons[0];
    for (const key of ['person_id', 'bbox', 'bbox_confidence', 'keypoints', 'visible_keypoints', 'total_keypoints']) {
      assert.ok(key in p, key);
    }
    assert.equal(p.keypoints.length, 17);
    assert.deepEqual(Object.keys(p.keypoints[0]), ['id', 'name', 'x', 'y', 'confidence', 'visible']);
  });
});

describe('what the real backend said in each situation', () => {
  it('one frame of a standing person: provisional Standing, not yet tracked long enough', () => {
    const a = onlyPerson('pose-standing-single-frame').activity!;
    assert.equal(a.label, 'Standing');
    assert.equal(a.confirmed, false);
    assert.equal(a.tracking_status, 'initializing');
    assert.equal(a.visibility_mode, 'full_body');
    assert.ok(a.confidence !== null && a.confidence < 0.5);
    assert.match(a.note ?? '', /single frame/);
  });

  it('a standing person seen for several seconds: confirmed Standing', () => {
    const a = onlyPerson('pose-standing-confirmed').activity!;
    assert.deepEqual([a.label, a.confirmed, a.tracking_status, a.track_id], ['Standing', true, 'tracking', 1]);
    assert.ok(a.confidence! > 0.7);
    assert.ok(a.observations >= 3);
  });

  it('walking after standing: confirmed Walking, previous activity Standing', () => {
    const a = onlyPerson('pose-walking-confirmed').activity!;
    assert.deepEqual([a.label, a.confirmed, a.previous_label], ['Walking', true, 'Standing']);
    assert.ok(a.duration_s > 0);
  });

  it('a person lying down', () => {
    const a = onlyPerson('pose-lying-down').activity!;
    assert.deepEqual([a.label, a.visibility_mode], ['Lying Down', 'full_body']);
  });

  it('possible sleeping is worded as an estimate and carries the inactivity time', () => {
    const a = onlyPerson('pose-possible-sleeping').activity!;
    assert.equal(a.label, 'Possible Sleeping');
    assert.ok(a.inactive_s! >= 60);
    assert.equal(a.previous_label, 'Prolonged Inactivity');
    assert.match(a.note ?? '', /estimate only/);
  });

  it('upper body only: upper-body activity, legs reported missing', () => {
    const a = onlyPerson('pose-upper-body').activity!;
    assert.equal(a.visibility_mode, 'upper_body');
    assert.ok(a.missing_regions.includes('legs'));
    assert.ok(['Upper Body Inactivity', 'Upper Body Bending', 'Raising Hands', 'Arm Movement'].includes(a.label));
  });

  it('legs cut off by the frame: Partial Body Detected with no confidence', () => {
    const a = onlyPerson('pose-partial-legs-cut').activity!;
    assert.deepEqual([a.label, a.visibility_mode, a.confidence, a.confirmed], ['Partial Body Detected', 'partial', null, false]);
    assert.match(a.note ?? '', /legs/);
  });

  it('only a head in view: Insufficient Visibility with no confidence', () => {
    const a = onlyPerson('pose-insufficient-head-only').activity!;
    assert.deepEqual([a.label, a.detection_quality, a.confidence], ['Insufficient Visibility', 'insufficient', null]);
    assert.ok(a.body_visibility < 0.25);
  });

  it('no person in view', () => {
    const r = fixture('pose-no-person');
    assert.deepEqual([r.person_count, r.persons.length], [0, 0]);
  });

  it('a person who left the view is reported as a lost track', () => {
    const r = fixture('pose-person-lost');
    assert.equal(r.person_count, 0);
    assert.equal(r.activity_recognition?.lost_tracks?.length, 1);
    assert.equal(r.activity_recognition?.lost_tracks?.[0].track_id, 1);
  });
});

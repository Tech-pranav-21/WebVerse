/**
 * How activity values are formatted for display. Every expected number is computed from a REAL recorded
 * backend response (tests/fixtures) or from an explicit edge value; nothing is a made-up detection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_TEXT,
  QUALITY_TONE,
  activityTone,
  buildPersonView,
  describeEmptyState,
  formatDuration,
  formatPercent,
  isNoActivityLabel,
  lostTrackText,
  personTitle,
} from '../src/services/activityPresentation';
import { DETECTION_QUALITIES } from '../src/types/pose';
import { clone, fixture, onlyPerson } from './poseFixtures';

describe('formatPercent', () => {
  it('rounds a 0..1 score to a whole percent', () => {
    assert.equal(formatPercent(0.923), '92%');
    assert.equal(formatPercent(0.954), '95%');
    assert.equal(formatPercent(0.5), '50%');
    assert.equal(formatPercent(0), '0%');
    assert.equal(formatPercent(1), '100%');
    assert.equal(formatPercent(0.004), '0%');
    assert.equal(formatPercent(0.995), '100%');
  });

  it('never shows a number for "no confidence": null and undefined are an em dash', () => {
    assert.equal(formatPercent(null), '—');
    assert.equal(formatPercent(undefined), '—');
  });

  it('keeps out-of-range and broken values on the scale instead of showing 130% or NaN%', () => {
    assert.equal(formatPercent(1.3), '100%');
    assert.equal(formatPercent(-0.2), '0%');
    assert.equal(formatPercent(Number.NaN), '—');
    assert.equal(formatPercent(Number.POSITIVE_INFINITY), '—');
  });
});

describe('formatDuration', () => {
  it('seconds, minutes and hours', () => {
    assert.equal(formatDuration(0), '0 s');
    assert.equal(formatDuration(12), '12 s');
    assert.equal(formatDuration(11.6), '12 s');
    assert.equal(formatDuration(59.4), '59 s');
    assert.equal(formatDuration(60), '1 min');
    assert.equal(formatDuration(65), '1 min 5 s');
    assert.equal(formatDuration(600), '10 min');
    assert.equal(formatDuration(3600), '1 h');
    assert.equal(formatDuration(3725), '1 h 2 min');
  });

  it('shows an em dash for values that make no sense', () => {
    for (const bad of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatDuration(bad as number), '—');
    }
  });
});

describe('detection quality', () => {
  it('has a label and a tone for every quality the service can send', () => {
    for (const q of DETECTION_QUALITIES) {
      assert.ok(QUALITY_TEXT[q].length > 0);
      assert.ok(QUALITY_TONE[q]);
    }
    assert.deepEqual(DETECTION_QUALITIES.map((q) => QUALITY_TEXT[q]), ['Good', 'Medium', 'Poor', 'Insufficient']);
  });

  it('the tone gets worse as the quality gets worse', () => {
    assert.deepEqual(
      DETECTION_QUALITIES.map((q) => QUALITY_TONE[q]),
      ['good', 'accent', 'warn', 'bad'],
    );
  });
});

describe('activityTone / isNoActivityLabel', () => {
  it('lying, long inactivity, possible sleeping and partial bodies deserve attention', () => {
    for (const label of ['Lying Down', 'Prolonged Inactivity', 'Possible Sleeping', 'Partial Body Detected'] as const) {
      assert.equal(activityTone({ label, confirmed: true }), 'warn', label);
    }
    assert.equal(activityTone({ label: 'Insufficient Visibility', confirmed: false }), 'bad');
  });

  it('an ordinary activity is highlighted only once it is confirmed', () => {
    assert.equal(activityTone({ label: 'Walking', confirmed: true }), 'accent');
    assert.equal(activityTone({ label: 'Walking', confirmed: false }), 'neutral');
    assert.equal(activityTone({ label: 'Unknown Activity', confirmed: true }), 'neutral');
  });

  it('knows which labels say "nothing is claimed"', () => {
    assert.equal(isNoActivityLabel('Partial Body Detected'), true);
    assert.equal(isNoActivityLabel('Insufficient Visibility'), true);
    assert.equal(isNoActivityLabel('Unknown Activity'), true);
    assert.equal(isNoActivityLabel('Standing'), false);
    assert.equal(isNoActivityLabel('Possible Sleeping'), false);
  });
});

describe('personTitle', () => {
  it('uses the stable tracking id, and the position in the frame (from 1) when there is none', () => {
    assert.equal(personTitle({ track_id: 3 }, 0), 'Person #3');
    assert.equal(personTitle({ track_id: null }, 0), 'Person #1');
    assert.equal(personTitle({}, 1), 'Person #2');
  });
});

describe('buildPersonView (from real backend responses)', () => {
  it('a confirmed walking person', () => {
    const person = onlyPerson('pose-walking-confirmed');
    const a = person.activity!;
    const v = buildPersonView(person, 0)!;
    assert.equal(v.title, 'Person #1');
    assert.equal(v.activity, 'Walking');
    assert.equal(v.stateText, 'Confirmed');
    assert.equal(v.confidenceText, formatPercent(a.confidence));
    assert.equal(v.confidencePct, Math.round(a.confidence! * 100));
    assert.equal(v.visibilityText, formatPercent(a.body_visibility));
    assert.equal(v.qualityText, 'Good');
    assert.equal(v.previousText, 'Standing');
    assert.equal(v.durationText, formatDuration(a.duration_s));
    assert.equal(v.trackingText, 'Tracking');
    assert.equal(v.modeText, 'Full body');
    assert.equal(v.tone, 'accent');
  });

  it('a provisional first frame says it is provisional and still tracking-up', () => {
    const v = buildPersonView(onlyPerson('pose-standing-single-frame'), 0)!;
    assert.equal(v.activity, 'Standing');
    assert.equal(v.stateText, 'Provisional');
    assert.equal(v.trackingText, 'Initializing');
    assert.equal(v.previousText, 'None');
    assert.match(v.note ?? '', /single frame/);
  });

  it('partial body: no confidence number, "Not classified", poor quality, the missing part named', () => {
    const v = buildPersonView(onlyPerson('pose-partial-legs-cut'), 0)!;
    assert.equal(v.activity, 'Partial Body Detected');
    assert.equal(v.confidenceText, '—');
    assert.equal(v.confidencePct, null);
    assert.equal(v.stateText, 'Not classified');
    assert.equal(v.qualityText, 'Poor');
    assert.equal(v.modeText, 'Partial body');
    assert.ok(v.missingRegions.includes('legs'));
    assert.equal(v.tone, 'warn');
  });

  it('insufficient visibility: no confidence, insufficient quality, low body visibility', () => {
    const v = buildPersonView(onlyPerson('pose-insufficient-head-only'), 0)!;
    assert.equal(v.activity, 'Insufficient Visibility');
    assert.equal(v.confidenceText, '—');
    assert.equal(v.qualityText, 'Insufficient');
    assert.equal(v.qualityTone, 'bad');
    assert.ok(v.visibilityPct < 25);
    assert.equal(v.tone, 'bad');
  });

  it('possible sleeping shows how long there has been no movement', () => {
    const v = buildPersonView(onlyPerson('pose-possible-sleeping'), 0)!;
    assert.equal(v.activity, 'Possible Sleeping');
    assert.match(v.inactiveText ?? '', /^1 min/);
    assert.equal(v.previousText, 'Prolonged Inactivity');
    assert.equal(v.tone, 'warn');
  });

  it('a person without activity has no card (the service did not analyse them)', () => {
    const person = clone(onlyPerson('pose-standing-confirmed'));
    delete person.activity;
    assert.equal(buildPersonView(person, 0), null);
  });

  it('an untracked frame is labelled as a single frame', () => {
    const person = clone(onlyPerson('pose-standing-confirmed'));
    person.activity!.tracking_status = 'untracked';
    person.activity!.track_id = null;
    person.track_id = null;
    const v = buildPersonView(person, 0)!;
    assert.equal(v.trackingText, 'Single frame');
    assert.equal(v.title, 'Person #1');
  });

  it('every value in the view is derived from the response (change the response, the view changes)', () => {
    const person = clone(onlyPerson('pose-standing-confirmed'));
    person.activity!.confidence = 0.123;
    person.activity!.body_visibility = 0.456;
    person.activity!.duration_s = 3725;
    person.activity!.previous_label = 'Running';
    person.activity!.detection_quality = 'medium';
    const v = buildPersonView(person, 0)!;
    assert.deepEqual(
      [v.confidenceText, v.visibilityText, v.durationText, v.previousText, v.qualityText],
      ['12%', '46%', '1 h 2 min', 'Running', 'Medium'],
    );
  });
});

describe('describeEmptyState', () => {
  it('before the first analysis', () => {
    assert.deepEqual(describeEmptyState(null), { kind: 'idle' });
  });

  it('no person in the frame', () => {
    assert.deepEqual(describeEmptyState(fixture('pose-no-person')), { kind: 'no_person' });
    assert.deepEqual(describeEmptyState(fixture('pose-person-lost')), { kind: 'no_person' });
  });

  it('nothing to explain when there is at least one activity', () => {
    assert.equal(describeEmptyState(fixture('pose-walking-confirmed')), null);
  });

  it('activity recognition switched off on the service', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    delete r.persons[0].activity;
    r.activity_recognition = { enabled: false };
    assert.deepEqual(describeEmptyState(r), { kind: 'disabled' });
  });

  it('the activity layer failed on the service: its message is passed on', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    delete r.persons[0].activity;
    r.activity_recognition = { enabled: true, error: 'Activity recognition failed: boom' };
    assert.deepEqual(describeEmptyState(r), { kind: 'unavailable', message: 'Activity recognition failed: boom' });
  });

  it('a service that does not do activity recognition at all (older version)', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    delete r.persons[0].activity;
    delete r.activity_recognition;
    assert.equal(describeEmptyState(r)?.kind, 'unavailable');
  });
});

describe('lostTrackText', () => {
  it('says who left, when, and what they were doing', () => {
    assert.equal(
      lostTrackText({ track_id: 2, last_label: 'Walking', seconds_since_seen: 3.4 }),
      'Person #2 left the view 3 s ago (last seen: Walking).',
    );
    assert.equal(lostTrackText({ track_id: 1, last_label: null, seconds_since_seen: 1 }), 'Person #1 left the view 1 s ago.');
  });
});

/**
 * The Pose Estimation page's components, rendered to HTML (react-dom/server: no browser, no new
 * dependency). Every result shown here is a REAL recorded backend response (tests/fixtures) or a copy of
 * one with a single field changed, so the numbers on screen can be traced to the response.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityRecognitionSection } from '../src/components/ActivityRecognitionSection';
import { PoseKeypointInspector } from '../src/components/PoseKeypointInspector';
import { PoseEstimationPanel, type PoseEstimationPanelProps } from '../src/components/PoseEstimationPanel';
import type { PoseDetectionResult } from '../src/types/pose';
import { clone, fixture, readSource } from './poseFixtures';

const html = (el: ReactElement) => renderToStaticMarkup(el);
/** Visible text only, with whitespace collapsed. */
const textOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const section = (result: PoseDetectionResult | null, extra: { isDetecting?: boolean; error?: string | null } = {}) =>
  html(createElement(ActivityRecognitionSection, { result, isDetecting: false, ...extra }));

const FIELDS = [
  'Detected Person',
  'Current Activity',
  'Activity Confidence',
  'Body Visibility',
  'Detection Quality',
  'Activity Duration',
  'Previous Activity',
  'Tracking Status',
];

describe('Human Activity Recognition section: a person with a confirmed activity', () => {
  const result = fixture('pose-walking-confirmed');
  const a = result.persons[0].activity!;
  const markup = section(result);
  const text = textOf(markup);

  it('is titled HUMAN ACTIVITY RECOGNITION and is a labelled region', () => {
    assert.ok(text.includes('HUMAN ACTIVITY RECOGNITION'));
    assert.match(markup, /<section aria-labelledby="activity-recognition-title"/);
    assert.match(markup, /<h3 id="activity-recognition-title"/);
  });

  it('shows each of the eight requested fields once per person', () => {
    for (const field of FIELDS) assert.equal(count(text, field), 1, `${field} should appear exactly once`);
  });

  it('shows the values the backend sent', () => {
    assert.ok(text.includes('Person #1'));
    assert.ok(text.includes('Walking'));
    assert.ok(text.includes('Confirmed'));
    assert.ok(text.includes('95%'), 'confidence 0.954 -> 95%');
    assert.ok(text.includes('100%'), 'body visibility');
    assert.ok(text.includes('Good'));
    assert.ok(text.includes('Tracking'));
    assert.match(text, /Previous Activity Standing/);
    assert.match(text, /Activity Duration 4 s/);
    assert.equal(a.confidence, 0.954);
  });

  it('draws the confidence and visibility as accessible meters carrying the same numbers', () => {
    assert.match(markup, /role="meter" aria-label="Activity confidence"[^>]*aria-valuenow="95"/);
    assert.match(markup, /role="meter" aria-label="Body visibility"[^>]*aria-valuenow="100"/);
  });

  it('carries the estimate disclaimer', () => {
    assert.match(text, /estimates from body posture and movement, not facts/);
    assert.match(text, /heuristic score, not a probability/);
  });
});

describe('confidence is displayed exactly as received', () => {
  const cases: Array<[number, string]> = [
    [0.923, '92%'],
    [0.5, '50%'],
    [0.004, '0%'],
    [1, '100%'],
    [0.196, '20%'],
  ];
  for (const [value, shown] of cases) {
    it(`${value} is shown as ${shown}`, () => {
      const r = clone(fixture('pose-standing-confirmed'));
      r.persons[0].activity!.confidence = value;
      const markup = section(r);
      assert.ok(textOf(markup).includes(`Activity Confidence ${shown}`), shown);
      assert.match(markup, new RegExp(`aria-label="Activity confidence"[^>]*aria-valuenow="${shown.replace('%', '')}"`));
    });
  }

  it('a person with no confidence shows a dash and "Not available", and no meter', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    r.persons[0].activity!.confidence = null;
    const markup = section(r);
    assert.ok(textOf(markup).includes('Activity Confidence — Not available'));
    assert.ok(!markup.includes('aria-label="Activity confidence"'));
  });

  it('a first, provisional frame is marked as such', () => {
    const text = textOf(section(fixture('pose-standing-single-frame')));
    assert.ok(text.includes('Provisional'));
    assert.ok(text.includes('Initializing'));
    assert.match(text, /Previous Activity None/);
    assert.match(text, /single frame/);
  });
});

describe('insufficient and partial visibility', () => {
  it('Insufficient Visibility: nothing classified, no confidence, quality Insufficient', () => {
    const markup = section(fixture('pose-insufficient-head-only'));
    const text = textOf(markup);
    assert.ok(text.includes('Insufficient Visibility'));
    assert.ok(text.includes('Not classified'));
    assert.ok(text.includes('Activity Confidence — Not available'));
    assert.match(text, /Detection Quality Insufficient/);
    assert.ok(text.includes('Too little of the body is visible.'));
    assert.match(text, /Body Visibility 12%/);
    assert.ok(!markup.includes('aria-label="Activity confidence"'));
  });

  it('Partial Body Detected: says which part is missing and why', () => {
    const text = textOf(section(fixture('pose-partial-legs-cut')));
    assert.ok(text.includes('Partial Body Detected'));
    assert.ok(text.includes('Not classified'));
    assert.match(text, /Detection Quality Poor/);
    assert.match(text, /Not clearly visible: head, legs\./, 'the recorded photo crop cuts off the head as well as the legs');
    assert.match(text, /bottom of the frame cuts off the legs/);
    assert.match(text, /Partial body/);
  });

  it('upper-body mode: shows an upper-body activity and the mode', () => {
    const text = textOf(section(fixture('pose-upper-body')));
    assert.match(text, /Upper body/);
    assert.match(text, /Upper Body (Inactivity|Bending)|Raising Hands|Arm Movement/);
    assert.match(text, /only upper-body activities are classified/);
  });

  it('possible sleeping is shown with its limits and the inactivity time', () => {
    const text = textOf(section(fixture('pose-possible-sleeping')));
    assert.ok(text.includes('Possible Sleeping'));
    assert.match(text, /No movement for 1 min/);
    assert.match(text, /estimate only: sleep cannot be confirmed from video/);
  });
});

describe('nothing to show, and failures', () => {
  it('before the first analysis', () => {
    const text = textOf(section(null));
    assert.ok(text.includes('HUMAN ACTIVITY RECOGNITION'));
    assert.match(text, /Run an analysis to see what each person/);
  });

  it('no person detected', () => {
    const text = textOf(section(fixture('pose-no-person')));
    assert.ok(text.includes('No person detected in the last frame.'));
    assert.ok(!text.includes('Current Activity'));
  });

  it('a person who left the view is reported', () => {
    const text = textOf(section(fixture('pose-person-lost')));
    assert.match(text, /Person #1 left the view 1 s ago\./);
  });

  it('an API failure is explained in the section', () => {
    const text = textOf(section(fixture('pose-standing-confirmed'), { error: 'The pose service did not answer within 20 seconds.' }));
    assert.match(text, /Activity recognition could not run: The pose service did not answer within 20 seconds\./);
  });

  it('after a failure the previous result is hidden, not shown as if it were current', () => {
    const markup = section(fixture('pose-walking-confirmed'), { error: 'Cannot reach the local pose service.' });
    const text = textOf(markup);
    assert.ok(!text.includes('Walking'), 'a stale activity must not stay on screen');
    assert.ok(!text.includes('Current Activity'));
    assert.equal(count(markup, 'data-testid="activity-card"'), 0);
    assert.match(text, /The last result is hidden because it is out of date/);
  });

  it('the stale-result note only appears when there was a result to hide', () => {
    assert.ok(!textOf(section(null, { error: 'x' })).includes('out of date'));
    assert.ok(!textOf(section(fixture('pose-no-person'), { error: 'x' })).includes('out of date'));
  });

  it('the result is shown again as soon as the failure is cleared', () => {
    assert.ok(textOf(section(fixture('pose-walking-confirmed'), { error: null })).includes('Walking'));
  });

  it('an API failure with no earlier result', () => {
    const markup = section(null, { error: 'Cannot reach the local pose service.' });
    assert.ok(textOf(markup).includes('Activity recognition could not run: Cannot reach the local pose service.'));
    assert.ok(!textOf(markup).includes('Run an analysis'), 'the failure replaces the idle hint');
  });

  it('activity recognition switched off on the service', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    delete r.persons[0].activity;
    r.activity_recognition = { enabled: false };
    assert.match(textOf(section(r)), /switched off on the local service/);
  });

  it('the activity layer failed on the service while the pose result is fine', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    delete r.persons[0].activity;
    r.activity_recognition = { enabled: true, error: 'Activity recognition failed: boom' };
    assert.match(textOf(section(r)), /Activity recognition is unavailable for this frame: Activity recognition failed: boom/);
  });

  it('shows that analysis is running', () => {
    assert.match(textOf(section(null, { isDetecting: true })), /Analysing…/);
  });
});

describe('several people and untrusted text', () => {
  it('each person gets a card with their own tracking id', () => {
    const r = clone(fixture('pose-walking-confirmed'));
    const second = clone(fixture('pose-lying-down').persons[0]);
    second.track_id = 2;
    second.activity!.track_id = 2;
    r.persons.push(second);
    r.person_count = 2;
    const markup = section(r);
    assert.equal(count(markup, 'data-testid="activity-card"'), 2);
    const text = textOf(markup);
    assert.ok(text.includes('Person #1') && text.includes('Person #2'));
    assert.ok(text.includes('Walking') && text.includes('Lying Down'));
  });

  it('says when some people were detected but not analysed', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    const extra = clone(r.persons[0]);
    delete extra.activity;
    r.persons.push(extra);
    assert.match(textOf(section(r)), /1 more person was detected but not analysed/);
  });

  it('text from the service is escaped, never interpreted as HTML', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    r.persons[0].activity!.note = '<img src=x onerror=alert(1)>';
    r.activity_recognition = { enabled: true, error: '<script>alert(2)</script>' };
    const markup = section(r);
    assert.ok(!markup.includes('<img src=x'), 'note must be escaped');
    assert.ok(!markup.includes('<script>'), 'error must be escaped');
    assert.ok(markup.includes('&lt;img src=x'));
  });
});

describe('keypoint inspector (the existing keypoint coordinates card)', () => {
  const result = fixture('pose-partial-legs-cut');

  it('lists all 17 keypoints, with coordinates for visible ones and "unseen" for the rest', () => {
    const text = textOf(html(createElement(PoseKeypointInspector, { result, selectedIdx: 0, onSelect: () => {} })));
    const person = result.persons[0];
    assert.equal(person.keypoints.length, 17);
    for (const kp of person.keypoints) {
      assert.ok(text.includes(kp.name.replace('_', ' ')) || text.toLowerCase().includes(kp.name.replace('_', ' ')), kp.name);
    }
    const nose = person.keypoints[0];
    assert.ok(text.includes(`${Math.round(nose.x)},${Math.round(nose.y)}`));
    const hidden = person.keypoints.filter((k) => !k.visible).length;
    assert.ok(hidden > 0);
    assert.equal(count(text, 'unseen'), hidden);
  });

  it('shows the same person numbering as the activity cards', () => {
    const text = textOf(html(createElement(PoseKeypointInspector, { result, selectedIdx: 0, onSelect: () => {} })));
    assert.ok(text.includes('Keypoint Coordinates (Person #1)'));
  });

  it('offers a selector when there are several people, and survives a stale selection', () => {
    const r = clone(fixture('pose-standing-confirmed'));
    const second = clone(r.persons[0]);
    second.track_id = 2;
    r.persons.push(second);
    r.person_count = 2;
    const markup = html(createElement(PoseKeypointInspector, { result: r, selectedIdx: 1, onSelect: () => {} }));
    assert.equal(count(markup, '<button'), 2);
    assert.ok(textOf(markup).includes('Keypoint Coordinates (Person #2)'));
    const stale = html(createElement(PoseKeypointInspector, { result: fixture('pose-standing-confirmed'), selectedIdx: 5, onSelect: () => {} }));
    assert.ok(textOf(stale).includes('Keypoint Coordinates (Person #1)'), 'a selection from an earlier frame falls back to the first person');
  });

  it('renders nothing when nobody was detected', () => {
    assert.equal(html(createElement(PoseKeypointInspector, { result: fixture('pose-no-person'), selectedIdx: 0, onSelect: () => {} })), '');
  });

  it('has no raw-JSON toggle or dump', () => {
    const markup = html(createElement(PoseKeypointInspector, { result, selectedIdx: 0, onSelect: () => {} }));
    assert.ok(!/JSON/i.test(markup));
    assert.ok(!markup.includes('<pre'));
  });
});

describe('Pose Estimation page', () => {
  const props: PoseEstimationPanelProps = {
    feedSlot: createElement('div', { 'data-testid': 'shared-camera-slot' }),
    viewMode: 'stream',
    isStreamConfigured: true,
    health: { status: 'connected' } as unknown as PoseEstimationPanelProps['health'],
    getImage: () => null,
    streamUrl: 'http://camera.local/stream',
    config: {} as PoseEstimationPanelProps['config'],
  };
  const markup = html(createElement(PoseEstimationPanel, props));
  const text = textOf(markup);

  it('still has every control and block it had before', () => {
    for (const expected of [
      'Local Human Pose Estimation',
      'Live Camera Feed',
      'Analyze Current Frame',
      'Test Sample Frame',
      'Inference Frequency',
      'Manual',
      '0.5 FPS (2s)',
      '1 FPS (1s)',
      'Pose Estimation Preview',
      'No pose analysis run yet',
    ]) {
      assert.ok(text.includes(expected), expected);
    }
  });

  it('shows the camera through the shared slot it was given (no second camera element)', () => {
    assert.equal(count(markup, 'data-testid="shared-camera-slot"'), 1);
    assert.equal(count(markup, '<img'), 0, 'no image element of its own before a result exists');
    assert.equal(count(markup, '<video'), 0);
  });

  it('has the new HUMAN ACTIVITY RECOGNITION section', () => {
    assert.ok(text.includes('HUMAN ACTIVITY RECOGNITION'));
    assert.equal(count(markup, 'data-testid="activity-recognition"'), 1);
  });

  it('has no Hide / View Raw Detection JSON option', () => {
    assert.ok(!/raw detection json/i.test(text));
    assert.ok(!/(hide|view) raw/i.test(text));
    assert.ok(!markup.includes('<pre') || !/raw/i.test(markup));
  });
});

describe('PoseEstimationPanel source', () => {
  const source = readSource('components/PoseEstimationPanel.tsx');

  it('the Raw Detection JSON toggle, its state and its output are gone', () => {
    for (const gone of ['Raw Detection JSON', 'showJson', 'setShowJson', 'JSON.stringify(lastResult', 'ChevronUp', 'ChevronDown']) {
      assert.ok(!source.includes(gone), `${gone} must not be in PoseEstimationPanel.tsx`);
    }
  });

  it('the detection data is still kept in state for the sections that use it', () => {
    assert.match(source, /useState<PoseDetectionResult \| null>\(null\)/);
    assert.match(source, /<ActivityRecognitionSection result=\{lastResult\}/);
    assert.match(source, /<PoseKeypointInspector result=\{lastResult\}/);
  });

  it('reads frames from the existing shared camera element and opens no stream of its own', () => {
    assert.match(source, /getImage\(\)/);
    assert.match(source, /captureFrameFromImage\(img\)/);
    for (const forbidden of ['new Image(', 'EventSource', 'grabFrameFromStream', 'new WebSocket', 'streamUrl)', 'fetch(']) {
      assert.ok(!source.includes(forbidden), `PoseEstimationPanel must not use ${forbidden}`);
    }
  });

  it('never runs two analyses at once and keeps the sample frame out of the live history', () => {
    assert.match(source, /inFlightRef\.current/);
    assert.match(source, /trackActivity: !isSample/);
    assert.match(source, /sampleSessionId\(sessionIdRef\.current\)/);
  });

  it('asks for the overlay in the same request instead of running a second inference', () => {
    assert.match(source, /includeAnnotated: true/);
  });
});

/**
 * Pose page settings: the inference-rate options (the original three must survive) and the session id
 * that keeps this camera's frames together on the service.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INFERENCE_OPTIONS, createSessionId, sampleSessionId } from '../src/services/poseSettings';

// The service accepts exactly this pattern (activity-recognition/service.py: sessionId).
const SERVICE_SESSION_ID = /^[A-Za-z0-9_.:\-]{1,64}$/;

describe('inference frequency options', () => {
  it('keeps the original modes: Manual, 0.5 FPS (2s) and 1 FPS (1s)', () => {
    const find = (label: string) => INFERENCE_OPTIONS.find((o) => o.label === label);
    assert.equal(find('Manual')?.intervalSec, 0);
    assert.equal(find('0.5 FPS (2s)')?.intervalSec, 2);
    assert.equal(find('1 FPS (1s)')?.intervalSec, 1);
  });

  it('the first option is manual, so nothing runs by itself until the user chooses', () => {
    assert.equal(INFERENCE_OPTIONS[0].intervalSec, 0);
  });

  it('offers a faster mode for movement, and every option is distinct and sane', () => {
    assert.ok(INFERENCE_OPTIONS.some((o) => o.intervalSec === 0.5));
    const intervals = INFERENCE_OPTIONS.map((o) => o.intervalSec);
    assert.equal(new Set(intervals).size, intervals.length);
    assert.equal(new Set(INFERENCE_OPTIONS.map((o) => o.label)).size, INFERENCE_OPTIONS.length);
    for (const i of intervals) assert.ok(i >= 0.5 || i === 0, 'never faster than 2 FPS: the camera and CPU are small');
  });
});

describe('createSessionId', () => {
  it('uses a random UUID when the browser has one', () => {
    const id = createSessionId({ randomUUID: () => '123e4567-e89b-12d3-a456-426614174000' });
    assert.equal(id, 'pose-123e4567-e89b-12d3-a456-426614174000');
    assert.match(id, SERVICE_SESSION_ID);
  });

  it('works on a plain http page, where crypto.randomUUID does not exist', () => {
    for (const impl of [undefined, {}, { randomUUID: undefined }]) {
      const id = createSessionId(impl);
      assert.match(id, SERVICE_SESSION_ID);
      assert.ok(id.startsWith('pose-'));
    }
  });

  it('is different every time (two tabs must not share a history)', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createSessionId({})));
    assert.equal(ids.size, 200);
  });

  it('never exceeds the 64 characters the service accepts', () => {
    assert.ok(createSessionId({ randomUUID: () => 'x'.repeat(200) }).length <= 64);
  });

  it('uses the real environment by default', () => {
    assert.match(createSessionId(), SERVICE_SESSION_ID);
  });
});

describe('sampleSessionId', () => {
  it('is a different, valid session from the live one', () => {
    const live = createSessionId({});
    const sample = sampleSessionId(live);
    assert.notEqual(sample, live);
    assert.match(sample, SERVICE_SESSION_ID);
    assert.ok(sample.startsWith(live.slice(0, 20)));
  });

  it('stays within 64 characters even for the longest live id', () => {
    assert.ok(sampleSessionId('p'.repeat(64)).length <= 64);
  });
});

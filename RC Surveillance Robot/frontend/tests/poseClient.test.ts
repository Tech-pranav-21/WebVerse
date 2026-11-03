/**
 * Pose service client: requests, the proxy -> direct fallback, timeouts, cancellation and every way a
 * response can be wrong. The network is a scripted fake (nothing is sent anywhere); the ACCEPTED
 * response bodies are the real recorded ones from tests/fixtures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPoseClient } from '../src/services/poseClient';
import { PoseClientError } from '../src/services/poseErrors';
import { parsePoseDetectionResult } from '../src/services/poseResponse';
import { clone, rawFixture } from './poseFixtures';

type Call = { url: string; init: RequestInit };
type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string, status: number) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });
const frame = () => new Blob([new Uint8Array(200).fill(7)], { type: 'image/jpeg' });

function scripted(handler: Handler) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

/** A fetch that never answers but, like the real one, rejects when it is aborted. */
const hang: Handler = (_url, init) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

/**
 * A request that never settles is a bug, so these tests must FAIL on it rather than hang for ever (a
 * hanging test blocks a whole CI run and tells nobody what broke). Every expected failure is raced
 * against a deadline well above the timeouts the tests configure.
 */
const NEVER_SETTLED = Symbol('never settled');

async function settles<T>(promise: Promise<T>, ms = 5000): Promise<T | typeof NEVER_SETTLED> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<typeof NEVER_SETTLED>((resolve) => {
    timer = setTimeout(() => resolve(NEVER_SETTLED), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

async function failure(promise: Promise<unknown>): Promise<PoseClientError> {
  // Swallow the rejection the race may leave unobserved, so Node does not report an unhandled rejection.
  promise.catch(() => {});
  let settled: unknown;
  try {
    settled = await settles(promise);
  } catch (err) {
    assert.ok(err instanceof PoseClientError, `expected a PoseClientError, got ${String(err)}`);
    return err;
  }
  if (settled === NEVER_SETTLED) {
    assert.fail('the request never settled: it would hang the page (and this test suite) for ever');
  }
  assert.fail('expected the request to fail');
}

describe('detect: the request', () => {
  it('sends the frame and the session options to the proxy and returns the validated result', async () => {
    const { calls, fetchImpl } = scripted(() => json(rawFixture('pose-walking-confirmed')));
    const client = createPoseClient({ fetchImpl });
    const result = await client.detect(frame(), {
      sessionId: 'tab-1',
      trackActivity: true,
      includeAnnotated: true,
      keypointThreshold: 0.4,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/pose/detect');
    assert.equal(calls[0].init.method, 'POST');
    const sent = JSON.parse(String(calls[0].init.body));
    assert.equal(sent.sessionId, 'tab-1');
    assert.equal(sent.trackActivity, true);
    assert.equal(sent.includeAnnotated, true);
    assert.equal(sent.keypointThreshold, 0.4);
    assert.equal(sent.mimeType, 'image/jpeg');
    assert.ok(sent.imageBase64.length > 100);
    assert.equal(result.persons[0].activity?.label, 'Walking');
  });

  it('leaves out options that were not given, so the service applies its own defaults', async () => {
    const { calls, fetchImpl } = scripted(() => json(rawFixture('pose-no-person')));
    await createPoseClient({ fetchImpl }).detect(frame());
    const sent = JSON.parse(String(calls[0].init.body));
    for (const key of ['sessionId', 'trackActivity', 'resetTracking', 'includeAnnotated', 'confThreshold']) {
      assert.ok(!(key in sent), key);
    }
  });

  it('a single-frame request says so (the sample frame must not feed the live history)', async () => {
    const { calls, fetchImpl } = scripted(() => json(rawFixture('pose-no-person')));
    await createPoseClient({ fetchImpl }).detect(frame(), { sessionId: 's-sample', trackActivity: false });
    assert.equal(JSON.parse(String(calls[0].init.body)).trackActivity, false);
  });

  it('never lets the browser cache a detection', async () => {
    const { calls, fetchImpl } = scripted(() => json(rawFixture('pose-no-person')));
    await createPoseClient({ fetchImpl }).detect(frame());
    assert.equal(calls[0].init.cache, 'no-store');
  });
});

describe('detect: reaching the service', () => {
  it('falls back to the service port when the proxy cannot connect', async () => {
    const { calls, fetchImpl } = scripted((url) => {
      if (url.startsWith('/api/pose')) throw new TypeError('Failed to fetch');
      return json(rawFixture('pose-no-person'));
    });
    const result = await createPoseClient({ fetchImpl }).detect(frame());
    assert.deepEqual(calls.map((c) => c.url), ['/api/pose/detect', 'http://127.0.0.1:8000/detect']);
    assert.equal(result.person_count, 0);
  });

  it('falls back when the dev-server proxy answers with its plain-text error page', async () => {
    const { calls, fetchImpl } = scripted((url) =>
      url.startsWith('/api/pose') ? text('proxy error', 500) : json(rawFixture('pose-no-person')),
    );
    await createPoseClient({ fetchImpl }).detect(frame());
    assert.equal(calls.length, 2);
  });

  it('does NOT repeat a frame the service itself answered with an error (it would be analysed twice)', async () => {
    const { calls, fetchImpl } = scripted(() => json({ detail: 'Pose model is not loaded. Check server startup logs.' }, 503));
    const err = await failure(createPoseClient({ fetchImpl }).detect(frame()));
    assert.equal(calls.length, 1);
    assert.equal(err.kind, 'model_unavailable');
    assert.equal(err.status, 503);
    assert.match(err.message, /model is not loaded/i);
  });

  it('says how to start the service when it cannot be reached at all', async () => {
    const { fetchImpl } = scripted(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await failure(createPoseClient({ fetchImpl }).detect(frame()));
    assert.equal(err.kind, 'unreachable');
    assert.match(err.message, /python activity-recognition\/run_service\.py/);
  });
});

describe('detect: errors reported by the service', () => {
  it('a rejected frame (400) shows the service\'s own reason', async () => {
    const { fetchImpl } = scripted(() => json({ detail: 'Invalid image header: Payload is not a recognized JPEG.' }, 400));
    const err = await failure(createPoseClient({ fetchImpl }).detect(frame()));
    assert.deepEqual([err.kind, err.status], ['bad_request', 400]);
    assert.match(err.message, /not a recognized JPEG/);
  });

  it('an oversized frame (413)', async () => {
    const { fetchImpl } = scripted(() => json({ detail: 'Image size exceeds limit.' }, 413));
    assert.equal((await failure(createPoseClient({ fetchImpl }).detect(frame()))).kind, 'bad_request');
  });

  it('FastAPI validation errors (422) are turned into readable text', async () => {
    const { fetchImpl } = scripted(() =>
      json({ detail: [{ loc: ['body', 'sessionId'], msg: 'String should match pattern', type: 'string_pattern_mismatch' }] }, 422),
    );
    const err = await failure(createPoseClient({ fetchImpl }).detect(frame(), { sessionId: 'bad id' }));
    assert.equal(err.kind, 'bad_request');
    assert.match(err.message, /should match pattern/);
  });

  it('a processing failure (500) shows the reason', async () => {
    const { fetchImpl } = scripted(() => json({ detail: 'Model inference failed: CUDA out of memory' }, 500));
    const err = await failure(createPoseClient({ fetchImpl }).detect(frame()));
    assert.deepEqual([err.kind, err.status], ['server_error', 500]);
    assert.match(err.message, /CUDA out of memory/);
  });

  it('an error without a readable body still gives a message', async () => {
    const { fetchImpl } = scripted((url) => (url.startsWith('/api') ? text('x', 502) : new Response('', { status: 500 })));
    const err = await failure(createPoseClient({ fetchImpl }).detect(frame()));
    assert.equal(err.kind, 'server_error');
    assert.match(err.message, /HTTP 500/);
  });
});

describe('detect: timeout and cancellation', () => {
  it('gives up after the time limit with a clear message', async () => {
    const { fetchImpl } = scripted(hang);
    const started = Date.now();
    const err = await failure(createPoseClient({ fetchImpl, detectTimeoutMs: 40 }).detect(frame()));
    assert.equal(err.kind, 'timeout');
    assert.match(err.message, /did not answer/);
    assert.ok(Date.now() - started < 1000);
  });

  it('one deadline covers the proxy attempt AND the fallback', async () => {
    let attempts = 0;
    const { fetchImpl } = scripted((url, init) => {
      attempts += 1;
      if (url.startsWith('/api')) throw new TypeError('Failed to fetch');
      return hang(url, init);
    });
    const err = await failure(createPoseClient({ fetchImpl, detectTimeoutMs: 40 }).detect(frame()));
    assert.equal(err.kind, 'timeout');
    assert.equal(attempts, 2);
  });

  it('a caller can cancel; the request is aborted and reported as cancelled', async () => {
    const { fetchImpl } = scripted(hang);
    const controller = new AbortController();
    const pending = createPoseClient({ fetchImpl, detectTimeoutMs: 5000 }).detect(frame(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    assert.equal((await failure(pending)).kind, 'cancelled');
  });

  it('a request that was cancelled before it started sends nothing', async () => {
    const { calls, fetchImpl } = scripted(() => json(rawFixture('pose-no-person')));
    const controller = new AbortController();
    controller.abort();
    const err = await failure(createPoseClient({ fetchImpl }).detect(frame(), { signal: controller.signal }));
    assert.equal(err.kind, 'cancelled');
    assert.equal(calls.length, 0);
  });
});

describe('detect: responses that are not what the dashboard expects', () => {
  const bad: Array<[string, () => Response]> = [
    ['not JSON at all', () => new Response('<html>Bad gateway</html>', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['JSON that is not an object', () => json([1, 2, 3])],
    ['an empty object', () => json({})],
    ['a null body', () => json(null)],
    ['no persons list', () => json({ ok: true, inference_time_ms: 5, device: 'cpu' })],
    ['persons that is not a list', () => json({ persons: 'none', inference_time_ms: 5, device: 'cpu' })],
    ['no inference time', () => json({ persons: [], device: 'cpu' })],
    ['a person without keypoints', () => json({ persons: [{ bbox: {} }], inference_time_ms: 5, device: 'cpu' })],
    [
      'a keypoint with a text coordinate',
      () => {
        const r = clone(rawFixture('pose-standing-confirmed'));
        r.persons[0].keypoints[0].x = 'left';
        return json(r);
      },
    ],
    [
      'a bounding box that is missing',
      () => {
        const r = clone(rawFixture('pose-standing-confirmed'));
        delete r.persons[0].bbox;
        return json(r);
      },
    ],
  ];

  for (const [name, make] of bad) {
    it(`rejects ${name} with an invalid_response error`, async () => {
      const { fetchImpl } = scripted(make);
      const err = await failure(createPoseClient({ fetchImpl }).detect(frame()));
      assert.equal(err.kind, 'invalid_response');
      assert.ok(err.message.length > 20);
    });
  }

  it('keeps the pose result when only the activity part is malformed, and says so', async () => {
    const body = clone(rawFixture('pose-standing-confirmed'));
    body.persons[0].activity.label = 'Moonwalking';
    const { fetchImpl } = scripted(() => json(body));
    const result = await createPoseClient({ fetchImpl }).detect(frame());
    assert.equal(result.persons[0].keypoints.length, 17, 'the skeleton is still shown');
    assert.equal(result.persons[0].activity, undefined);
    assert.match(result.activity_recognition?.error ?? '', /not understood/);
  });

  it('accepts a response from a service without activity recognition (older version)', async () => {
    const body = clone(rawFixture('pose-standing-confirmed'));
    delete body.activity_recognition;
    for (const p of body.persons) {
      delete p.activity;
      delete p.track_id;
    }
    const { fetchImpl } = scripted(() => json(body));
    const result = await createPoseClient({ fetchImpl }).detect(frame());
    assert.equal(result.person_count, 1);
    assert.equal(result.persons[0].activity, undefined);
    assert.equal(result.activity_recognition, undefined);
  });

  it('accepts null activity (person not analysed) and a service-reported activity error', async () => {
    const body = clone(rawFixture('pose-standing-confirmed'));
    body.persons[0].activity = null;
    body.persons[0].track_id = null;
    body.activity_recognition = { enabled: true, error: 'Activity recognition failed: boom' };
    const { fetchImpl } = scripted(() => json(body));
    const result = await createPoseClient({ fetchImpl }).detect(frame());
    assert.equal(result.persons[0].activity, undefined);
    assert.equal(result.activity_recognition?.error, 'Activity recognition failed: boom');
  });

  it('keeps the annotated overlay when the service sends it', async () => {
    const body = { ...clone(rawFixture('pose-no-person')), annotated_image_base64: 'QUJD' };
    const { fetchImpl } = scripted(() => json(body));
    assert.equal((await createPoseClient({ fetchImpl }).detect(frame(), { includeAnnotated: true })).annotated_image_base64, 'QUJD');
  });
});

describe('detectAnnotated (the separate, stateless overlay request)', () => {
  it('returns the image and the headers the page used before', async () => {
    const { calls, fetchImpl } = scripted(
      () =>
        new Response(new Uint8Array([0xff, 0xd8, 1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'X-Person-Count': '2', 'X-Inference-Time-Ms': '41.5', 'X-Device': 'cuda:0' },
        }),
    );
    const out = await createPoseClient({ fetchImpl }).detectAnnotated(frame());
    assert.equal(calls[0].url, '/api/pose/detect/visualize');
    assert.deepEqual([out.personCount, out.latencyMs, out.device], [2, 41.5, 'cuda:0']);
    assert.equal(out.blob.size, 5);
  });

  it('maps failures like detect does', async () => {
    const { fetchImpl } = scripted(() => json({ detail: 'Pose model is not loaded.' }, 503));
    assert.equal((await failure(createPoseClient({ fetchImpl }).detectAnnotated(frame()))).kind, 'model_unavailable');
  });
});

describe('checkHealth', () => {
  const health = {
    ok: true,
    status: 'ready',
    uptime_seconds: 3,
    service: 'activity-recognition',
    hardware: { device: 'cpu', cuda_available: false, gpu_name: null, vram_allocated_mb: null, vram_total_mb: null },
    model: { name: 'yolov8n-pose.pt', loaded: true, load_duration_ms: 1, warmup_duration_ms: 1 },
    activity_recognition: { enabled: true, active_sessions: 0, tracked_people: 0 },
  };

  it('returns the service health', async () => {
    const { calls, fetchImpl } = scripted(() => json(health));
    assert.deepEqual(await createPoseClient({ fetchImpl }).checkHealth(), health);
    assert.equal(calls[0].url, '/api/pose/health');
  });

  it('is null when the service is down, answers with an error, or is too slow', async () => {
    assert.equal(await createPoseClient({ fetchImpl: scripted(() => { throw new TypeError('x'); }).fetchImpl }).checkHealth(), null);
    assert.equal(await createPoseClient({ fetchImpl: scripted(() => json({ detail: 'no' }, 500)).fetchImpl }).checkHealth(), null);
    // Raced, so a health check that never gives up fails this test instead of stalling the whole run.
    const slow = await settles(createPoseClient({ fetchImpl: scripted(hang).fetchImpl, healthTimeoutMs: 30 }).checkHealth());
    assert.equal(slow, null, 'a health check must give up on its own');
  });
});

describe('parsePoseDetectionResult', () => {
  it('fills in defaults for optional pose fields an old service may omit', () => {
    const r = parsePoseDetectionResult({
      persons: [
        {
          bbox: { x1: 1, y1: 2, x2: 3, y2: 4, width: 2, height: 2 },
          keypoints: [{ id: 0, name: 'nose', x: 1, y: 2, confidence: 0.9, visible: true }],
        },
      ],
      inference_time_ms: 12,
      device: 'cpu',
    });
    assert.equal(r.person_count, 1);
    assert.equal(r.persons[0].person_id, 0);
    assert.equal(r.persons[0].total_keypoints, 1);
    assert.equal(r.total_time_ms, 12);
    assert.equal(r.model, 'unknown');
  });

  it('refuses non-finite numbers (NaN / Infinity would break the layout)', () => {
    const r = clone(rawFixture('pose-standing-confirmed'));
    r.persons[0].keypoints[3].confidence = null;
    assert.throws(() => parsePoseDetectionResult(r), PoseClientError);
  });
});

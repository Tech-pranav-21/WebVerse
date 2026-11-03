/**
 * AI recognition supervisor tests.
 *
 * SIMULATED: a scripted backend client, a scripted frame source and a fake clock. They prove WHEN
 * a picture may be sent and how every outcome is handled. They say nothing about what the real Groq
 * model returns: no request to Groq or to a camera is made by any test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AiClientError } from '../src/services/aiClient';
import { DEFAULT_MAX_IMAGE_BYTES, backendUsable, matchesFilters, primaryCategory } from '../src/services/aiRecognizer';
import { MANUAL_MIN_INTERVAL_MS } from '../src/services/aiSettings';
import { FILTERABLE_CATEGORIES } from '../server/protocol';
import {
  AUTO_ON,
  AiHarness,
  carObject,
  chairObject,
  deferred,
  dogObject,
  makeFrame,
  motionEvent,
  okResponse,
  personObject,
  readyStatus,
  setupAi,
} from './aiFakes';

const manualGap = (h: AiHarness) => h.clock.advance(MANUAL_MIN_INTERVAL_MS + 1);

describe('manual recognition', () => {
  it('does nothing, and sends nothing, while external AI processing is switched off', async () => {
    const h = setupAi({ settings: { enabled: false } });
    const outcome = await h.recognizer.analyzeNow();
    assert.deepEqual([outcome.status, outcome.status === 'skipped' && outcome.reason], ['skipped', 'disabled']);
    assert.equal(h.calls.frames, 0, 'the picture is not even read');
    assert.equal(h.client.recognizeCalls.length, 0);
    assert.equal(h.state().notice?.kind, 'info');
    assert.match(h.state().notice?.message ?? '', /switched off/);
  });

  it('reads one frame, sends it once, and records the result', async () => {
    const h = setupAi();
    const outcome = await h.recognizer.analyzeNow();

    assert.equal(outcome.status, 'done');
    assert.equal(h.calls.frames, 1);
    assert.equal(h.client.recognizeCalls.length, 1);
    assert.equal(h.client.recognizeCalls[0].blob, h.frame.blob, 'the frame that was read is the frame that was sent');
    assert.ok(h.client.recognizeCalls[0].signal, 'the request can be cancelled');

    const e = h.events()[0];
    assert.equal(e.id, 'ai1');
    assert.equal(e.trigger, 'manual');
    assert.equal(e.status, 'success');
    assert.equal(e.model, 'qwen/qwen3.8-27b');
    assert.equal(e.summary, 'A person stands near a parked car.');
    assert.deepEqual(e.objects.map((o) => o.label), ['person', 'car']);
    assert.equal(e.category, 'person');
    assert.equal(e.matched, true);
    assert.equal(e.t, h.clock.now());
    assert.deepEqual(e.usage, { promptTokens: 2400, completionTokens: 120 });
    assert.equal(e.latencyMs, 1800);
    assert.equal(e.motionEventId, undefined);
    assert.deepEqual(h.state().current, e);
    assert.equal(h.state().requestsThisSession, 1);
    assert.equal(h.state().analyzing, false);
  });

  it('shows a loading state while the request is out, then clears it', async () => {
    const h = setupAi();
    const held = h.client.hold();
    const pending = h.recognizer.analyzeNow();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(h.state().analyzing, true);
    assert.equal(h.state().notice, null);
    held.resolve();
    await pending;
    assert.equal(h.state().analyzing, false);
    assert.ok(h.states.some((s) => s.analyzing), 'the loading state was published');
  });

  it('a double click sends one request: the second is refused while the first runs', async () => {
    const h = setupAi();
    const held = h.client.hold();
    const first = h.recognizer.analyzeNow();
    const second = await h.recognizer.analyzeNow();
    assert.deepEqual([second.status, second.status === 'skipped' && second.reason], ['skipped', 'busy']);
    assert.equal(h.state().notice, null, 'a refused double click is not an error banner');
    held.resolve();
    assert.equal((await first).status, 'done');
    assert.equal(h.client.recognizeCalls.length, 1);
    assert.equal(h.calls.frames, 1);
  });

  it('two clicks in quick succession are collapsed even after the first finished (accidental repeat)', async () => {
    const h = setupAi();
    await h.recognizer.analyzeNow();
    const again = await h.recognizer.analyzeNow();
    assert.deepEqual([again.status, again.status === 'skipped' && again.reason], ['skipped', 'too-soon']);
    assert.equal(h.client.recognizeCalls.length, 1);
    manualGap(h);
    assert.equal((await h.recognizer.analyzeNow()).status, 'done');
    assert.equal(h.client.recognizeCalls.length, 2);
  });

  it('refuses a picture over the size limit before sending it, and records no event', async () => {
    const h = setupAi({ frame: async () => ({ ok: true, frame: makeFrame(DEFAULT_MAX_IMAGE_BYTES + 1) }) });
    const outcome = await h.recognizer.analyzeNow();
    assert.equal(outcome.status, 'failed');
    assert.equal(h.client.recognizeCalls.length, 0);
    assert.equal(h.state().notice?.code, 'image_too_large');
    assert.equal(h.events().length, 0);
  });

  it('uses the limit the backend reports once it has been asked', async () => {
    const h = setupAi({ frame: async () => ({ ok: true, frame: makeFrame(60_000) }) });
    h.client.statusImpl = async () => readyStatus({ maxImageBytes: 50_000 });
    await h.recognizer.refreshBackend();
    assert.equal((await h.recognizer.analyzeNow()).status, 'failed');
    assert.equal(h.client.recognizeCalls.length, 0);
    assert.match(h.state().notice?.message ?? '', /over the 49 kB limit/);
  });
});

describe('camera and frame-access failures', () => {
  it('does not send anything when the camera is disconnected', async () => {
    const h = setupAi({ frame: async () => ({ ok: false, blocked: false, message: 'The camera stream is not connected (reconnecting), so the picture on screen may be an old frame.' }) });
    const outcome = await h.recognizer.analyzeNow();
    assert.equal(outcome.status, 'failed');
    assert.equal(h.client.recognizeCalls.length, 0);
    assert.equal(h.state().notice?.code, 'frame_unavailable');
    assert.match(h.state().notice?.message ?? '', /not connected/);
    assert.equal(h.events().length, 0, 'no request was made, so there is no recognition event');
    assert.equal(h.state().frameBlocked, false);
    assert.equal(h.state().analyzing, false);
  });

  it('reports a browser-blocked picture with the fix, sends nothing, and pauses automatic analysis', async () => {
    const h = setupAi({
      settings: AUTO_ON,
      frame: async () => ({ ok: false, blocked: true, message: 'The browser will not let this page read the live picture.', action: 'enable-capture' }),
    });
    const manual = await h.recognizer.analyzeNow();
    assert.equal(manual.status, 'failed');
    assert.equal(h.state().notice?.code, 'frame_blocked');
    assert.equal(h.state().notice?.action, 'enable-capture');
    assert.equal(h.state().frameBlocked, true);
    assert.equal(h.client.recognizeCalls.length, 0);

    // Automatic mode does not keep retrying a blocked picture.
    const framesBefore = h.calls.frames;
    for (let i = 0; i < 5; i++) {
      const auto = await h.recognizer.handleMotionEvent(motionEvent(`m${i}`));
      assert.deepEqual([auto.status, auto.status === 'skipped' && auto.reason], ['skipped', 'frame-blocked']);
    }
    assert.equal(h.calls.frames, framesBefore, 'the blocked picture is not read again');
    assert.match(h.state().autoNote ?? '', /blocked/);
  });

  it('automatic analysis resumes once the stream has reconnected', async () => {
    let blocked = true;
    const h = setupAi({
      settings: AUTO_ON,
      frame: async () => (blocked ? { ok: false, blocked: true, message: 'blocked' } : { ok: true, frame: makeFrame() }),
    });
    await h.recognizer.analyzeNow();
    assert.equal(h.state().frameBlocked, true);
    blocked = false;
    h.recognizer.notifyStreamReconnected();
    assert.equal(h.state().frameBlocked, false);
    h.clock.advance(1);
    assert.equal((await h.recognizer.handleMotionEvent(motionEvent('m1'))).status, 'done');
  });
});

describe('Groq / backend errors', () => {
  const failed = async (h: AiHarness) => {
    const outcome = await h.recognizer.analyzeNow();
    assert.equal(outcome.status, 'failed');
    return h.events()[0];
  };

  it('records a failed recognition with its reason, and does not retry by itself', async () => {
    const h = setupAi();
    h.client.failWith('malformed_output', "The model's answer could not be understood.");
    const e = await failed(h);
    assert.equal(e.status, 'failed');
    assert.equal(e.error?.code, 'malformed_output');
    assert.deepEqual(e.objects, []);
    assert.equal(e.category, 'none');
    assert.equal(e.matched, false);
    assert.equal(h.client.recognizeCalls.length, 1, 'one click, one request');
    assert.equal(h.state().notice?.kind, 'error');
    assert.equal(h.state().analyzing, false);
  });

  it('a rate limit blocks further requests for the time the server named, then allows them again', async () => {
    const h = setupAi();
    h.client.failWith('rate_limited', 'Groq is rate limiting requests.', 20);
    await failed(h);
    assert.equal(h.state().blockedUntil, h.clock.now() + 20_000);
    assert.match(h.state().notice?.message ?? '', /Waiting 20 s/);

    h.client.recognizeImpl = async () => okResponse();
    const blocked = await h.recognizer.analyzeNow();
    assert.deepEqual([blocked.status, blocked.status === 'skipped' && blocked.reason], ['skipped', 'blocked-until']);
    assert.match(blocked.status === 'skipped' ? blocked.message : '', /try again in 20 s/);
    assert.equal(h.client.recognizeCalls.length, 1, 'nothing was sent while blocked');

    h.clock.advance(20_001);
    assert.equal((await h.recognizer.analyzeNow()).status, 'done');
  });

  it('an exhausted quota waits much longer (10 minutes if the server gave no time) and says so', async () => {
    const h = setupAi();
    h.client.failWith('quota_exhausted', 'The Groq daily quota is used up.');
    await failed(h);
    assert.equal(h.state().blockedUntil, h.clock.now() + 600_000);
    assert.match(h.state().notice?.message ?? '', /daily quota/);
    assert.match(h.state().notice?.message ?? '', /10 min/);
  });

  it('a rate limit also extends the automatic cooldown, so a motion burst cannot hammer Groq', async () => {
    const h = setupAi({ settings: { ...AUTO_ON, cooldownSec: 10 } });
    h.client.failWith('rate_limited', 'slow down', 90);
    await h.recognizer.handleMotionEvent(motionEvent('m1'));
    h.clock.advance(15_000); // past the 10 s cooldown, still inside the 90 s rate limit
    const next = await h.recognizer.handleMotionEvent(motionEvent('m2'));
    assert.deepEqual([next.status, next.status === 'skipped' && next.reason], ['skipped', 'blocked-until']);
    assert.equal(h.client.recognizeCalls.length, 1);
  });

  it('an unreachable backend is reported with how to start it, and remembered', async () => {
    const h = setupAi();
    h.client.failWith('backend_unreachable', 'The AI backend is not reachable. Start it with "npm run server".');
    const e = await failed(h);
    assert.equal(e.error?.code, 'backend_unreachable');
    assert.equal(h.state().backend.kind, 'unreachable');
  });

  it('a missing server key marks the backend as not configured', async () => {
    const h = setupAi();
    h.client.failWith('not_configured', 'AI recognition is not configured on the server.');
    await failed(h);
    assert.equal(h.state().backend.kind, 'not-configured');
    manualGap(h);
    const again = await h.recognizer.analyzeNow();
    assert.equal(again.status, 'failed'); // a manual click still tries (the user may have just fixed it)
  });

  it('timeouts, provider errors and auth errors are all recorded as failures with their codes', async () => {
    for (const code of ['timeout', 'provider_timeout', 'provider_error', 'provider_auth', 'provider_rejected', 'payload_too_large'] as const) {
      const h = setupAi();
      h.client.failWith(code, `fail ${code}`);
      const e = await failed(h);
      assert.equal(e.error?.code, code);
      assert.equal(h.client.recognizeCalls.length, 1);
    }
  });

  it('an unexpected exception is reported, not thrown, and releases the busy state', async () => {
    const h = setupAi();
    h.client.recognizeImpl = async () => {
      throw new Error('boom');
    };
    const e = await failed(h);
    assert.equal(e.error?.code, 'internal_error');
    assert.equal(h.state().analyzing, false);
    manualGap(h);
    h.client.recognizeImpl = async () => okResponse();
    assert.equal((await h.recognizer.analyzeNow()).status, 'done');
  });
});

describe('cancellation and stale responses', () => {
  it('cancel() aborts the request and ignores its answer, even if one arrives', async () => {
    const h = setupAi();
    const held = h.client.hold();
    const pending = h.recognizer.analyzeNow();
    await Promise.resolve();
    await Promise.resolve();
    const signal = h.client.recognizeCalls[0].signal!;
    h.recognizer.cancel();
    assert.equal(signal.aborted, true);
    assert.equal(h.state().analyzing, false);
    held.resolve(okResponse([dogObject])); // a late answer
    const outcome = await pending;
    assert.deepEqual([outcome.status, outcome.status === 'skipped' && outcome.reason], ['skipped', 'cancelled']);
    assert.equal(h.events().length, 0, 'an ignored answer is not recorded');
    assert.equal(h.state().current, null);
  });

  it('switching the feature off drops an answer that is still on its way', async () => {
    const h = setupAi();
    const held = h.client.hold();
    const pending = h.recognizer.analyzeNow();
    await Promise.resolve();
    await Promise.resolve();
    h.recognizer.configure({ enabled: false });
    held.resolve();
    assert.equal((await pending).status, 'skipped');
    assert.equal(h.events().length, 0);
    assert.equal(h.state().settings.enabled, false);
  });

  it('a SUCCESSFUL answer that still arrives after cancel() (a race the abort cannot always win) is ignored, not recorded', async () => {
    const h = setupAi({ settings: { retainSnapshot: true } });
    const late = deferred<ReturnType<typeof okResponse>>();
    h.client.recognizeImpl = () => late.promise; // ignores the abort signal, like a response already on its way
    const pending = h.recognizer.analyzeNow();
    await Promise.resolve();
    await Promise.resolve();
    h.recognizer.cancel();
    late.resolve(okResponse([personObject]));
    const outcome = await pending;
    assert.deepEqual([outcome.status, outcome.status === 'skipped' && outcome.reason], ['skipped', 'cancelled']);
    assert.equal(h.events().length, 0, 'not recorded');
    assert.equal(h.state().current, null, 'not shown');
    assert.equal(h.calls.saves.length, 0, 'and no snapshot is kept for an ignored answer');
    assert.equal(h.state().analyzing, false);
  });

  it('the same holds when the feature is switched off while the answer is on its way', async () => {
    const h = setupAi({ settings: { retainSnapshot: true } });
    const late = deferred<ReturnType<typeof okResponse>>();
    h.client.recognizeImpl = () => late.promise;
    const pending = h.recognizer.analyzeNow();
    await Promise.resolve();
    await Promise.resolve();
    h.recognizer.configure({ enabled: false });
    late.resolve(okResponse([personObject]));
    assert.equal((await pending).status, 'skipped');
    assert.equal(h.events().length, 0);
    assert.equal(h.calls.saves.length, 0);
  });

  it('cancelling while the snapshot is being saved drops the event instead of recording it', async () => {
    const saving = deferred<{ status: 'saved'; snapshotId: string }>();
    const h = setupAi({ settings: { retainSnapshot: true }, saveSnapshot: () => saving.promise });
    const pending = h.recognizer.analyzeNow();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    h.recognizer.cancel();
    saving.resolve({ status: 'saved', snapshotId: 's1' });
    assert.equal((await pending).status, 'skipped');
    assert.equal(h.events().length, 0);
  });

  it('cancelling before the frame has been read means no request is ever made', async () => {
    const frame = deferred<{ ok: true; frame: ReturnType<typeof makeFrame> }>();
    const h = setupAi({ frame: () => frame.promise });
    const pending = h.recognizer.analyzeNow();
    h.recognizer.cancel();
    frame.resolve({ ok: true, frame: makeFrame() });
    assert.equal((await pending).status, 'skipped');
    assert.equal(h.client.recognizeCalls.length, 0);
  });

  it('after cancelling, a new analysis works normally', async () => {
    const h = setupAi();
    const held = h.client.hold();
    const pending = h.recognizer.analyzeNow();
    await Promise.resolve();
    await Promise.resolve();
    h.recognizer.cancel();
    held.resolve();
    await pending;
    manualGap(h);
    h.client.recognizeImpl = async () => okResponse([dogObject], 'A dog.');
    assert.equal((await h.recognizer.analyzeNow()).status, 'done');
    assert.equal(h.events().length, 1);
    assert.equal(h.events()[0].category, 'animal');
  });
});

describe('motion-triggered recognition', () => {
  it('ignores motion alerts while automatic mode is off, and reads no picture', async () => {
    const h = setupAi({ settings: { enabled: true, autoOnMotion: false } });
    const outcome = await h.recognizer.handleMotionEvent(motionEvent('m1'));
    assert.deepEqual([outcome.status, outcome.status === 'skipped' && outcome.reason], ['skipped', 'auto-off']);
    assert.equal(h.calls.frames, 0);
    assert.equal(h.client.recognizeCalls.length, 0);
  });

  it('automatic mode cannot be switched on without the privacy acknowledgement, or while the feature is off', () => {
    const h = setupAi({ settings: { enabled: true } });
    h.recognizer.configure({ autoOnMotion: true });
    assert.equal(h.state().settings.autoOnMotion, false, 'not acknowledged');
    h.recognizer.configure({ autoAcknowledged: true });
    h.recognizer.configure({ autoOnMotion: true });
    assert.equal(h.state().settings.autoOnMotion, true);
    h.recognizer.configure({ autoAcknowledged: false });
    assert.equal(h.state().settings.autoOnMotion, false, 'withdrawing the acknowledgement also stops automatic analysis');
  });

  it('analyses a motion alert once and links the event to it', async () => {
    const h = setupAi({ settings: AUTO_ON });
    const outcome = await h.recognizer.handleMotionEvent(motionEvent('mot-9'));
    assert.equal(outcome.status, 'done');
    const e = h.events()[0];
    assert.equal(e.trigger, 'motion');
    assert.equal(e.motionEventId, 'mot-9');
    assert.equal(h.client.recognizeCalls.length, 1);
    assert.equal(h.state().autoCooldownUntil, h.clock.now() + 60_000);
  });

  it('applies the cooldown: alerts inside it are skipped without reading the picture or calling the backend', async () => {
    const h = setupAi({ settings: AUTO_ON });
    await h.recognizer.handleMotionEvent(motionEvent('m1'));
    h.clock.advance(10_000);
    const early = await h.recognizer.handleMotionEvent(motionEvent('m2'));
    assert.deepEqual([early.status, early.status === 'skipped' && early.reason], ['skipped', 'cooldown']);
    assert.match(h.state().autoNote ?? '', /cooldown, 50 s left/);
    assert.equal(h.calls.frames, 1);
    assert.equal(h.client.recognizeCalls.length, 1);

    h.clock.advance(50_000);
    assert.equal((await h.recognizer.handleMotionEvent(motionEvent('m3'))).status, 'done');
    assert.equal(h.client.recognizeCalls.length, 2);
    assert.equal(h.state().autoNote, null);
  });

  it('a burst of alerts produces exactly one request: the rest are dropped while it runs', async () => {
    const h = setupAi({ settings: AUTO_ON });
    const held = h.client.hold();
    const first = h.recognizer.handleMotionEvent(motionEvent('b0'));
    const rest = await Promise.all(Array.from({ length: 19 }, (_, i) => h.recognizer.handleMotionEvent(motionEvent(`b${i + 1}`))));
    assert.ok(rest.every((o) => o.status === 'skipped' && o.reason === 'busy'));
    held.resolve();
    assert.equal((await first).status, 'done');
    assert.equal(h.client.recognizeCalls.length, 1);
    assert.equal(h.events().length, 1);
  });

  it('the same alert is never analysed twice', async () => {
    const h = setupAi({ settings: AUTO_ON });
    assert.equal((await h.recognizer.handleMotionEvent(motionEvent('same'))).status, 'done');
    h.clock.advance(120_000);
    const again = await h.recognizer.handleMotionEvent(motionEvent('same'));
    assert.deepEqual([again.status, again.status === 'skipped' && again.reason], ['skipped', 'duplicate-event']);
    assert.equal(h.client.recognizeCalls.length, 1);
  });

  it('only one recognition at a time: an alert during a manual analysis is dropped, not queued', async () => {
    const h = setupAi({ settings: AUTO_ON });
    const held = h.client.hold();
    const manual = h.recognizer.analyzeNow();
    await Promise.resolve();
    await Promise.resolve();
    const auto = await h.recognizer.handleMotionEvent(motionEvent('m1'));
    assert.deepEqual([auto.status, auto.status === 'skipped' && auto.reason], ['skipped', 'busy']);
    assert.match(h.state().autoNote ?? '', /already running/);
    held.resolve();
    await manual;
    assert.equal(h.client.recognizeCalls.length, 1);
    await Promise.resolve();
    assert.equal(h.client.recognizeCalls.length, 1, 'the dropped alert is not replayed afterwards');
  });

  it('a failed automatic analysis still starts the cooldown, so there is no retry storm', async () => {
    const h = setupAi({ settings: AUTO_ON });
    h.client.failWith('provider_error', 'Groq had a problem.');
    await h.recognizer.handleMotionEvent(motionEvent('m1'));
    h.clock.advance(5_000);
    const next = await h.recognizer.handleMotionEvent(motionEvent('m2'));
    assert.deepEqual([next.status, next.status === 'skipped' && next.reason], ['skipped', 'cooldown']);
    assert.equal(h.client.recognizeCalls.length, 1);
  });

  it('pauses automatic analysis while the backend is known to be unavailable', async () => {
    const h = setupAi({ settings: AUTO_ON });
    h.client.statusImpl = async () => {
      throw new AiClientError('backend_unreachable', 'down');
    };
    await h.recognizer.refreshBackend();
    assert.equal(h.state().backend.kind, 'unreachable');
    const outcome = await h.recognizer.handleMotionEvent(motionEvent('m1'));
    assert.deepEqual([outcome.status, outcome.status === 'skipped' && outcome.reason], ['skipped', 'backend-unavailable']);
    assert.equal(h.calls.frames, 0);
    assert.equal(h.client.recognizeCalls.length, 0);
  });

  it('a changed cooldown setting applies to the next analysis without a restart', async () => {
    const h = setupAi({ settings: AUTO_ON });
    await h.recognizer.handleMotionEvent(motionEvent('m1'));
    h.recognizer.configure({ cooldownSec: 10 });
    h.clock.advance(11_000);
    // the first cooldown (60 s) is still running: it was set when the request was made
    assert.equal((await h.recognizer.handleMotionEvent(motionEvent('m2'))).status, 'skipped');
    h.clock.advance(50_000);
    assert.equal((await h.recognizer.handleMotionEvent(motionEvent('m3'))).status, 'done');
    assert.equal(h.state().autoCooldownUntil, h.clock.now() + 10_000, 'the new, shorter cooldown applies from then on');
  });
});

describe('category filters', () => {
  it('matchesFilters needs a CONFIRMED object in a category that is switched on', () => {
    const on = { person: true, animal: false, vehicle: false, other: false };
    assert.equal(matchesFilters([personObject], on), true);
    assert.equal(matchesFilters([dogObject, carObject], on), false);
    assert.equal(matchesFilters([{ ...personObject, uncertain: true }], on), false, 'a guess is not a confirmed match');
    assert.equal(matchesFilters([{ ...personObject, category: 'unknown' }], on), false);
    assert.equal(matchesFilters([], on), false);
    assert.equal(matchesFilters([personObject], { person: false, animal: false, vehicle: false, other: false }), false);
  });

  it('primaryCategory prefers a matching object, then the first object, then "none"', () => {
    const cats = { person: false, animal: true, vehicle: false, other: false };
    assert.equal(primaryCategory([personObject, dogObject], cats), 'animal');
    assert.equal(primaryCategory([personObject, carObject], cats), 'person');
    assert.equal(primaryCategory([], cats), 'none');
  });

  it('a result outside the filters is shown and recorded, but is not an event and keeps no snapshot', async () => {
    const h = setupAi({ settings: { categories: { person: true, animal: false, vehicle: false, other: false }, retainSnapshot: true } });
    h.client.recognizeImpl = async () => okResponse([dogObject], 'A dog.');
    await h.recognizer.analyzeNow();
    const e = h.events()[0];
    assert.equal(e.category, 'animal');
    assert.equal(e.matched, false);
    assert.equal(h.calls.saves.length, 0);
    assert.deepEqual(e.snapshot, { status: 'off' });
  });

  it('the filters can be changed while running, and apply to the very next result', async () => {
    const h = setupAi({ settings: { categories: { person: true, animal: false, vehicle: false, other: false } } });
    h.client.recognizeImpl = async () => okResponse([chairObject], 'A chair.');
    await h.recognizer.analyzeNow();
    assert.equal(h.events()[0].matched, false);
    h.recognizer.configure({ categories: { ...h.state().settings.categories, other: true } });
    manualGap(h);
    await h.recognizer.analyzeNow();
    assert.equal(h.events()[0].matched, true);
    assert.equal(h.saved.at(-1)?.categories.other, true, 'and the choice is saved');
  });

  it('with no category selected nothing ever counts as an event', async () => {
    const h = setupAi({ settings: { categories: { person: false, animal: false, vehicle: false, other: false } } });
    await h.recognizer.analyzeNow();
    assert.equal(h.events()[0].matched, false);
    assert.deepEqual(FILTERABLE_CATEGORIES.map((c) => h.state().settings.categories[c]), [false, false, false, false]);
  });

  it('an unknown or uncertain result is shown as such and never counts', async () => {
    const h = setupAi({ settings: { retainSnapshot: true } });
    h.client.recognizeImpl = async () => okResponse([{ label: 'blur', category: 'unknown', description: 'Something unclear.', uncertain: true }, { ...personObject, uncertain: true }], 'Unclear.');
    await h.recognizer.analyzeNow();
    const e = h.events()[0];
    assert.equal(e.matched, false);
    assert.equal(e.category, 'unknown');
    assert.equal(h.calls.saves.length, 0);
  });
});

describe('Smart Snapshot integration', () => {
  it('keeps nothing unless the setting is on (it is off by default)', async () => {
    const h = setupAi();
    assert.equal(h.state().settings.retainSnapshot, false);
    await h.recognizer.analyzeNow();
    assert.equal(h.calls.saves.length, 0);
    assert.deepEqual(h.events()[0].snapshot, { status: 'off' });
  });

  it('with the setting on, saves the exact analysed frame for a matching result and links it', async () => {
    const h = setupAi({ settings: { retainSnapshot: true } });
    await h.recognizer.analyzeNow();
    assert.equal(h.calls.saves.length, 1);
    assert.equal(h.calls.saves[0], h.frame, 'the frame that was analysed is the one that is kept');
    assert.deepEqual(h.events()[0].snapshot, { status: 'saved', snapshotId: 'snap-1' });
    assert.deepEqual(h.state().current?.snapshot, { status: 'saved', snapshotId: 'snap-1' });
  });

  it('records a failed or throwing snapshot without losing the recognition', async () => {
    const failing = setupAi({ settings: { retainSnapshot: true }, saveSnapshot: async () => ({ status: 'failed', note: 'storage unavailable' }) });
    await failing.recognizer.analyzeNow();
    assert.deepEqual(failing.events()[0].snapshot, { status: 'failed', note: 'storage unavailable' });
    assert.equal(failing.events()[0].status, 'success');

    const throwing = setupAi({
      settings: { retainSnapshot: true },
      saveSnapshot: async () => {
        throw new Error('gallery exploded');
      },
    });
    assert.equal((await throwing.recognizer.analyzeNow()).status, 'done');
    assert.equal(throwing.events()[0].snapshot.status, 'failed');
    assert.match(throwing.events()[0].snapshot.note ?? '', /gallery exploded/);
  });

  it('records a snapshot that was captured but could not be stored', async () => {
    const h = setupAi({ settings: { retainSnapshot: true }, saveSnapshot: async () => ({ status: 'session-only', snapshotId: 's9', note: 'storage full' }) });
    await h.recognizer.analyzeNow();
    assert.deepEqual(h.events()[0].snapshot, { status: 'session-only', snapshotId: 's9', note: 'storage full' });
  });

  it('does not take a second picture when Motion Detection is already keeping one for the same alert', async () => {
    for (const status of ['pending', 'saved'] as const) {
      const h = setupAi({ settings: { ...AUTO_ON, retainSnapshot: true } });
      await h.recognizer.handleMotionEvent(motionEvent('m1', { status, snapshotId: status === 'saved' ? 'motion-snap' : undefined }));
      assert.equal(h.calls.saves.length, 0, `motion snapshot ${status}`);
      assert.equal(h.events()[0].snapshot.status, 'skipped');
      assert.match(h.events()[0].snapshot.note ?? '', /Motion Detection already saves/);
    }
  });

  it('does take its own picture for a motion alert that has no snapshot of its own', async () => {
    const h = setupAi({ settings: { ...AUTO_ON, retainSnapshot: true } });
    await h.recognizer.handleMotionEvent(motionEvent('m1', { status: 'off' }));
    assert.equal(h.calls.saves.length, 1);
    assert.equal(h.events()[0].snapshot.status, 'saved');
  });

  it('respects the cooldown: no second snapshot for alerts inside it', async () => {
    const h = setupAi({ settings: { ...AUTO_ON, retainSnapshot: true } });
    for (let i = 0; i < 6; i++) {
      await h.recognizer.handleMotionEvent(motionEvent(`m${i}`));
      h.clock.advance(5_000);
    }
    assert.equal(h.calls.saves.length, 1);
    assert.equal(h.client.recognizeCalls.length, 1);
  });

  it('works without a snapshot service at all', async () => {
    const h = setupAi({ settings: { retainSnapshot: true }, saveSnapshot: null });
    assert.equal((await h.recognizer.analyzeNow()).status, 'done');
    assert.deepEqual(h.events()[0].snapshot, { status: 'off' });
  });
});

describe('backend status', () => {
  it('reports ready, not configured, unreachable and other errors without sending any image', async () => {
    const h = setupAi();
    await h.recognizer.refreshBackend();
    assert.equal(h.state().backend.kind, 'ready');
    assert.equal(backendUsable(h.state().backend), true);

    h.client.statusImpl = async () => readyStatus({ configured: false });
    await h.recognizer.refreshBackend();
    assert.equal(h.state().backend.kind, 'not-configured');
    assert.equal(backendUsable(h.state().backend), false);

    h.client.statusImpl = async () => {
      throw new AiClientError('backend_unreachable', 'down');
    };
    await h.recognizer.refreshBackend();
    assert.equal(h.state().backend.kind, 'unreachable');

    h.client.statusImpl = async () => {
      throw new AiClientError('internal_error', 'weird');
    };
    await h.recognizer.refreshBackend();
    assert.equal(h.state().backend.kind, 'error');
    assert.equal(h.client.recognizeCalls.length, 0);
    assert.equal(h.calls.frames, 0);
  });

  it('a "backend not reachable" banner goes away once the backend answers again', async () => {
    const h = setupAi();
    h.client.failWith('backend_unreachable', 'The AI backend is not reachable.');
    await h.recognizer.analyzeNow();
    assert.equal(h.state().notice?.code, 'backend_unreachable');
    h.client.statusImpl = async () => readyStatus();
    await h.recognizer.refreshBackend();
    assert.equal(h.state().backend.kind, 'ready');
    assert.equal(h.state().notice, null);
  });

  it('other banners are not touched by a status check', async () => {
    const h = setupAi();
    h.client.failWith('malformed_output', 'The answer could not be understood.');
    await h.recognizer.analyzeNow();
    await h.recognizer.refreshBackend();
    assert.equal(h.state().notice?.code, 'malformed_output');
  });

  it('asks only once while a check is already running', async () => {
    const h = setupAi();
    const gate = deferred<ReturnType<typeof readyStatus>>();
    h.client.statusImpl = () => gate.promise;
    const a = h.recognizer.refreshBackend();
    const b = h.recognizer.refreshBackend();
    assert.equal(h.state().backend.kind, 'checking');
    gate.resolve(readyStatus());
    await Promise.all([a, b]);
    assert.equal(h.client.statusCalls, 1);
  });
});

describe('settings and state', () => {
  it('saves every change, and keeps the same state object until something changes', () => {
    const h = setupAi();
    const s0 = h.state();
    assert.equal(h.state(), s0);
    h.recognizer.configure({ cooldownSec: 120 });
    assert.notEqual(h.state(), s0);
    assert.equal(h.saved.at(-1)?.cooldownSec, 120);
  });

  it('shutdown aborts anything in flight', async () => {
    const h = setupAi();
    h.client.hold();
    const pending = h.recognizer.analyzeNow();
    await Promise.resolve();
    await Promise.resolve();
    h.recognizer.shutdown();
    assert.equal(h.client.recognizeCalls[0].signal?.aborted, true);
    assert.equal((await pending).status, 'skipped');
  });
});

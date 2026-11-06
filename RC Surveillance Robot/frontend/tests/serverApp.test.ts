/**
 * AI backend: the HTTP layer, run for real on a loopback port. MOCKED upstream: Groq is replaced
 * by a fake `fetch`, so no key is used on the network and nothing leaves the machine.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed } from '../server/app';
import { ServerConfig } from '../server/config';
import {
  FAKE_KEY,
  GOOD_ANSWER,
  UpstreamHandler,
  fakeGroq,
  goodBody,
  groqAnswer,
  groqError,
  hangingFetch,
  jpegBase64,
  jsonPost,
  rawRequest,
  startApp,
  testConfig,
} from './serverFakes';

/** Start the server with a fake Groq, run the test body, always shut the server down. */
async function withApp(
  fn: (ctx: Awaited<ReturnType<typeof startApp>> & { groq: ReturnType<typeof fakeGroq> }) => Promise<void>,
  options: { config?: Partial<ServerConfig>; groq?: UpstreamHandler } = {},
): Promise<void> {
  const groq = fakeGroq(options.groq ?? (() => groqAnswer(GOOD_ANSWER)));
  const app = await startApp(testConfig(options.config), groq.fetchImpl);
  try {
    await fn({ ...app, groq });
  } finally {
    await app.close();
  }
}

const everything = (ctx: { logs: string[] }, ...texts: string[]) => [...ctx.logs, ...texts].join('\n');

describe('GET /api/ai/status', () => {
  it('reports the model and limits, says whether a key is configured, and never returns the key', async () => {
    await withApp(async (s) => {
      const r = await s.request({ path: '/api/ai/status' });
      assert.equal(r.status, 200);
      assert.equal(r.json.provider, 'groq');
      assert.equal(r.json.configured, true);
      assert.equal(r.json.model, 'qwen/qwen3.8-27b');
      assert.equal(r.json.preview, true);
      assert.deepEqual(r.json.mimeTypes, ['image/jpeg']);
      assert.equal(r.json.maxImageBytes, 200_000);
      assert.deepEqual(r.json.limits, { perMinute: 60, perDay: 1000, remainingToday: 1000 });
      assert.ok(!r.text.includes(FAKE_KEY), 'the key must never appear in a response');
      assert.ok(!/gsk_/.test(r.text));
      assert.equal(s.groq.calls.length, 0, 'asking for the status never calls Groq');
    });
  });

  it('works without a key and says so', async () => {
    await withApp(async (s) => {
      const r = await s.request({ path: '/api/ai/status' });
      assert.equal(r.json.configured, false);
    }, { config: { apiKey: undefined } });
  });

  it('flags a model that is not the documented preview default as non-preview, and shows remaining quota after use', async () => {
    await withApp(async (s) => {
      await jsonPost(s.port, goodBody());
      const r = await s.request({ path: '/api/ai/status' });
      assert.equal(r.json.preview, false);
      assert.equal(r.json.limits.remainingToday, 999);
    }, { config: { model: 'some/other-model', maxPerDay: 1000 } });
  });
});

describe('POST /api/ai/recognize: backend not configured', () => {
  it('answers 503 not_configured, does not call Groq, and leaks nothing', async () => {
    await withApp(async (s) => {
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 503);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.error.code, 'not_configured');
      assert.match(r.json.error.message, /GROQ_API_KEY is not set/);
      assert.equal(s.groq.calls.length, 0);
    }, { config: { apiKey: undefined } });
  });
});

describe('POST /api/ai/recognize: success', () => {
  it('returns the normalised result, the model, token usage and timing, and sends exactly one request to Groq', async () => {
    await withApp(async (s) => {
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 200);
      assert.equal(r.json.ok, true);
      assert.equal(r.json.model, 'qwen/qwen3.8-27b');
      assert.equal(r.json.result.summary, 'A person stands near a parked car.');
      assert.deepEqual(r.json.result.objects.map((o: any) => [o.label, o.category, o.uncertain]), [
        ['person', 'person', false],
        ['car', 'vehicle', false],
      ]);
      assert.deepEqual(r.json.usage, { promptTokens: 2400, completionTokens: 120 });
      assert.equal(typeof r.json.latencyMs, 'number');
      assert.match(r.json.requestId, /^[0-9a-f-]{36}$/);
      assert.equal(s.groq.calls.length, 1);
    });
  });

  it('sends Groq the image that was uploaded, with the key in the header and nowhere else, and returns neither', async () => {
    await withApp(async (s) => {
      const body = goodBody(800, 600);
      const r = await jsonPost(s.port, body);
      const call = s.groq.calls[0];
      assert.equal(call.url, 'https://api.groq.test/openai/v1/chat/completions');
      assert.equal(call.headers.Authorization, `Bearer ${FAKE_KEY}`);
      assert.equal(call.body.messages[0].content[1].image_url.url, `data:image/jpeg;base64,${body.imageBase64}`);
      assert.ok(!call.rawBody.includes(FAKE_KEY));
      assert.ok(!r.text.includes(FAKE_KEY));
      assert.ok(!r.text.includes(body.imageBase64), 'the image is not echoed back');
    });
  });

  it('sets no-store and nosniff headers on every API response', async () => {
    await withApp(async (s) => {
      for (const r of [await jsonPost(s.port, goodBody()), await s.request({ path: '/api/ai/status' }), await s.request({ path: '/nope' })]) {
        assert.equal(r.headers['cache-control'], 'no-store');
        assert.equal(r.headers['x-content-type-options'], 'nosniff');
        assert.match(String(r.headers['content-type']), /application\/json/);
      }
    });
  });

  it('writes one access line per request and never a body, an image or the key into its log', async () => {
    await withApp(async (s) => {
      const body = goodBody();
      await jsonPost(s.port, body);
      await s.request({ path: '/api/ai/status' });
      assert.equal(s.logs.length, 2);
      assert.match(s.logs[0], /^POST \/api\/ai\/recognize -> 200 \d+ms$/);
      const all = everything(s);
      assert.ok(!all.includes(FAKE_KEY));
      assert.ok(!all.includes(body.imageBase64.slice(0, 40)));
    });
  });
});

describe('POST /api/ai/recognize: bad requests', () => {
  it('rejects a request that is not JSON, and a JSON body that is not an object', async () => {
    await withApp(async (s) => {
      const text = await rawRequest(s.port, { method: 'POST', path: '/api/ai/recognize', headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
      assert.equal(text.status, 415);
      assert.equal(text.json.error.code, 'unsupported_media_type');
      const bad = await rawRequest(s.port, { method: 'POST', path: '/api/ai/recognize', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
      assert.equal(bad.status, 400);
      assert.equal(bad.json.error.code, 'bad_request');
      const arr = await rawRequest(s.port, { method: 'POST', path: '/api/ai/recognize', headers: { 'Content-Type': 'application/json' }, body: '[1,2]' });
      assert.equal(arr.status, 400);
      assert.equal(s.groq.calls.length, 0);
    });
  });

  it('rejects missing, malformed and non-JPEG images with 400 invalid_image and never calls Groq', async () => {
    await withApp(async (s) => {
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 2)]).toString('base64');
      for (const body of [{}, { mimeType: 'image/jpeg' }, { imageBase64: '', mimeType: 'image/jpeg' }, { imageBase64: 'not base64!', mimeType: 'image/jpeg' }, { imageBase64: png, mimeType: 'image/jpeg' }, { imageBase64: 123, mimeType: 'image/jpeg' }]) {
        const r = await jsonPost(s.port, body);
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
        assert.equal(r.json.error.code, 'invalid_image');
      }
      assert.equal(s.groq.calls.length, 0);
    });
  });

  it('rejects the wrong mime type with 415', async () => {
    await withApp(async (s) => {
      const r = await jsonPost(s.port, { imageBase64: jpegBase64(), mimeType: 'image/png' });
      assert.equal(r.status, 415);
      assert.equal(r.json.error.code, 'unsupported_media_type');
    });
  });

  it('rejects an image over the size limit with 413, whether or not the whole body arrives', async () => {
    await withApp(async (s) => {
      // Just over the image limit but under the request-body cap: the image check itself refuses it.
      const slightlyBig = { imageBase64: jpegBase64(640, 480, 10_500), mimeType: 'image/jpeg' };
      const r = await jsonPost(s.port, slightlyBig);
      assert.equal(r.status, 413);
      assert.equal(r.json.error.code, 'payload_too_large');
      assert.match(r.json.error.message, /larger than/);
      // Far over: refused by the request-body cap before anything is decoded.
      const tooBig = await jsonPost(s.port, { imageBase64: jpegBase64(640, 480, 40_000), mimeType: 'image/jpeg' });
      assert.equal(tooBig.status, 413);
      assert.equal(tooBig.json.error.code, 'payload_too_large');
      const huge = await rawRequest(s.port, { method: 'POST', path: '/api/ai/recognize', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: 'A'.repeat(200_000), mimeType: 'image/jpeg' }) });
      assert.equal(huge.status, 413);
      assert.equal(s.groq.calls.length, 0);
    }, { config: { maxImageBytes: 10_000 } });
  });

  it('answers unknown paths with 404 and wrong methods with 405', async () => {
    await withApp(async (s) => {
      assert.equal((await s.request({ path: '/' })).status, 404);
      assert.equal((await s.request({ path: '/api/ai/other' })).status, 404);
      assert.equal((await s.request({ path: '/api/ai/recognize' })).status, 405);
      assert.equal((await s.request({ method: 'POST', path: '/api/ai/status', body: '{}' })).status, 405);
      assert.equal((await s.request({ method: 'OPTIONS', path: '/api/ai/recognize' })).status, 405);
    });
  });
});

describe('origin check', () => {
  it('allows pages from this machine (any port) and requests without an Origin header', async () => {
    await withApp(async (s) => {
      for (const origin of ['http://localhost:3000', 'http://127.0.0.1:4173', 'http://[::1]:5173', 'https://localhost']) {
        assert.equal((await jsonPost(s.port, goodBody(), { Origin: origin })).status, 200, origin);
      }
      assert.equal((await jsonPost(s.port, goodBody())).status, 200);
    });
  });

  it('refuses other origins with 403 and does not call Groq', async () => {
    await withApp(async (s) => {
      for (const origin of ['http://evil.example', 'http://192.168.1.50:3000', 'null', 'http://localhost.evil.example', 'file://']) {
        const r = await jsonPost(s.port, goodBody(), { Origin: origin });
        assert.equal(r.status, 403, origin);
        assert.equal(r.json.error.code, 'origin_not_allowed');
      }
      assert.equal((await s.request({ path: '/api/ai/status', headers: { Origin: 'http://evil.example' } })).status, 403);
      assert.equal(s.groq.calls.length, 0);
    });
  });

  it('accepts an origin that is listed in AI_ALLOWED_ORIGINS', async () => {
    await withApp(async (s) => {
      assert.equal((await jsonPost(s.port, goodBody(), { Origin: 'http://192.168.1.50:3000' })).status, 200);
    }, { config: { allowedOrigins: ['http://192.168.1.50:3000'] } });
  });

  it('isOriginAllowed is strict about hostnames', () => {
    const cfg = { allowedOrigins: [] };
    assert.equal(isOriginAllowed('http://localhost:3000', cfg), true);
    assert.equal(isOriginAllowed('ftp://localhost', cfg), false);
    assert.equal(isOriginAllowed('http://localhost.evil.example', cfg), false);
    assert.equal(isOriginAllowed('not an origin', cfg), false);
  });
});

describe('provider failures through the API', () => {
  it('Groq timeout -> 504 provider_timeout (and the server stays usable)', async () => {
    await withApp(async (s) => {
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 504);
      assert.equal(r.json.error.code, 'provider_timeout');
      assert.equal(s.app.gate.inFlight, 0, 'the concurrency slot was released');
    }, { groq: hangingFetch, config: { requestTimeoutMs: 80 } });
  });

  it('Groq 429 -> 429 rate_limited with the wait in the body and a Retry-After header', async () => {
    await withApp(async (s) => {
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 429);
      assert.equal(r.json.error.code, 'rate_limited');
      assert.equal(r.json.error.retryAfterSec, 30);
      assert.equal(r.headers['retry-after'], '30');
    }, { groq: () => groqError(429, 'Rate limit reached for tokens per minute (TPM)', { 'retry-after': '30' }) });
  });

  it('Groq daily quota -> 429 quota_exhausted', async () => {
    await withApp(async (s) => {
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 429);
      assert.equal(r.json.error.code, 'quota_exhausted');
    }, { groq: () => groqError(429, 'tokens per day (TPD) limit reached', { 'retry-after': '3600' }) });
  });

  it('Groq rejecting the key -> 502 provider_auth, with no key in the answer or the log', async () => {
    await withApp(async (s) => {
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 502);
      assert.equal(r.json.error.code, 'provider_auth');
      assert.ok(!everything(s, r.text).includes(FAKE_KEY));
    }, { groq: () => groqError(401, `bad key ${FAKE_KEY}`) });
  });

  it('Groq 5xx -> 502 provider_error; network failure -> 502 provider_unreachable', async () => {
    await withApp(async (s) => {
      assert.equal((await jsonPost(s.port, goodBody())).json.error.code, 'provider_error');
    }, { groq: () => groqError(503, 'down'), config: { maxRetries: 0 } });
    await withApp(async (s) => {
      assert.equal((await jsonPost(s.port, goodBody())).json.error.code, 'provider_unreachable');
    }, { groq: () => { throw new TypeError('fetch failed'); }, config: { maxRetries: 0 } });
  });

  it('every kind of malformed model output -> 502 malformed_output, never a crash or a half result', async () => {
    for (const content of ['', 'I see a person standing there.', '[1,2,3]', '{"summary":"s"}', '{"summary":"s","objects":"none"}']) {
      await withApp(async (s) => {
        const r = await jsonPost(s.port, goodBody());
        assert.equal(r.status, 502, content);
        assert.equal(r.json.error.code, 'malformed_output');
        assert.ok(!/at .*\.js:\d+/.test(r.text), 'no stack trace');
      }, { groq: () => groqAnswer(content) });
    }
  });

  it('unknown categories and extra fields from the model are normalised, not passed through', async () => {
    await withApp(async (s) => {
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 200);
      assert.equal(r.json.result.objects[0].category, 'unknown');
      assert.equal(r.json.result.objects[0].uncertain, true);
      assert.ok(!('confidence' in r.json.result.objects[0]));
      assert.ok(!r.text.includes('0.97'));
    }, { groq: () => groqAnswer(JSON.stringify({ summary: 's', objects: [{ label: 'blob', category: 'cryptid', description: '?', uncertain: false, confidence: 0.97 }] })) });
  });
});

describe('a browser that goes away mid-request', () => {
  it('abandons the call to Groq instead of waiting for it, frees its slot, and logs it as cancelled', async () => {
    await withApp(async (s) => {
      const http = await import('node:http');
      const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/ai/recognize', headers: { 'Content-Type': 'application/json' } });
      req.on('error', () => {});
      req.end(JSON.stringify(goodBody()));
      let _w = 0;
      while (s.groq.calls.length < 1 && _w++ < 200) await new Promise((r) => setTimeout(r, 5));
      assert.equal(s.app.gate.inFlight, 1);
      req.destroy(); // the browser navigates away
      for (let i = 0; i < 200 && s.app.gate.inFlight > 0; i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal(s.app.gate.inFlight, 0, 'the concurrency slot was released without waiting for Groq');
      for (let i = 0; i < 100 && !s.logs.some((l) => /-> 499/.test(l)); i++) await new Promise((r) => setTimeout(r, 10));
      assert.ok(s.logs.some((l) => /^POST \/api\/ai\/recognize -> 499/.test(l)), s.logs.join(' | '));
    }, { groq: hangingFetch, config: { requestTimeoutMs: 10_000 } });
  });
});

describe('usage limits', () => {
  it('refuses requests beyond the per-minute limit with 429 and a Retry-After, without calling Groq again', async () => {
    await withApp(async (s) => {
      assert.equal((await jsonPost(s.port, goodBody())).status, 200);
      assert.equal((await jsonPost(s.port, goodBody())).status, 200);
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 429);
      assert.equal(r.json.error.code, 'rate_limited');
      assert.ok(r.json.error.retryAfterSec >= 1);
      assert.ok(r.headers['retry-after']);
      assert.equal(s.groq.calls.length, 2);
    }, { config: { ratePerMinute: 2 } });
  });

  it('refuses requests beyond the daily cap with quota_exhausted', async () => {
    await withApp(async (s) => {
      assert.equal((await jsonPost(s.port, goodBody())).status, 200);
      const r = await jsonPost(s.port, goodBody());
      assert.equal(r.status, 429);
      assert.equal(r.json.error.code, 'quota_exhausted');
      assert.match(r.json.error.message, /1 AI requests per day/);
      assert.equal(s.groq.calls.length, 1);
    }, { config: { maxPerDay: 1 } });
  });

  it('invalid requests do not use up any of the budget', async () => {
    await withApp(async (s) => {
      for (let i = 0; i < 5; i++) await jsonPost(s.port, { imageBase64: 'nope', mimeType: 'image/jpeg' });
      assert.equal((await jsonPost(s.port, goodBody())).status, 200);
    }, { config: { ratePerMinute: 1 } });
  });

  it('allows only the configured number of simultaneous recognitions (the rest get 503 busy)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await withApp(async (s) => {
      const first = jsonPost(s.port, goodBody());
      let _w = 0;
      while (s.groq.calls.length < 1 && _w++ < 200) await new Promise((r) => setTimeout(r, 5));
      const second = await jsonPost(s.port, goodBody());
      assert.equal(second.status, 503);
      assert.equal(second.json.error.code, 'busy');
      assert.equal(s.groq.calls.length, 1, 'the second request never reached Groq');
      release();
      assert.equal((await first).status, 200);
      assert.equal((await jsonPost(s.port, goodBody())).status, 200, 'free again afterwards');
    }, { groq: async () => (await gate, groqAnswer(GOOD_ANSWER)), config: { maxConcurrent: 1 } });
  });
});

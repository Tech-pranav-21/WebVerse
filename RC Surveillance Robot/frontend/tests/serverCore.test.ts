/**
 * AI backend: configuration, key redaction, image validation, output normalization, limiters.
 * MOCKED: no network and no Groq. Test keys are obvious fakes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_GROQ_BASE_URL,
  DEFAULT_MODEL,
  isOfficialGroqUrl,
  loadConfig,
  loadEnvFile,
  parseEnvText,
} from '../server/config';
import { redactSecrets } from '../server/redact';
import { MAX_DIMENSION, readJpegSize, validateJpegBase64 } from '../server/image';
import { MAX_OBJECTS, MalformedOutputError, normalizeModelOutput } from '../server/normalize';
import { ConcurrencyGate, RollingLimiter } from '../server/limits';
import { FAKE_KEY, jpegBase64, jpegBuffer } from './serverFakes';

describe('configuration', () => {
  it('is "not configured" without a key, and blank or whitespace keys count as missing', () => {
    assert.equal(loadConfig({}).apiKey, undefined);
    assert.equal(loadConfig({ GROQ_API_KEY: '' }).apiKey, undefined);
    assert.equal(loadConfig({ GROQ_API_KEY: '   ' }).apiKey, undefined);
    assert.equal(loadConfig({ GROQ_API_KEY: ` ${FAKE_KEY} ` }).apiKey, FAKE_KEY);
  });

  it('has safe, conservative defaults', () => {
    const c = loadConfig({});
    assert.equal(c.model, DEFAULT_MODEL);
    assert.equal(c.model, 'qwen/qwen3.8-27b');
    assert.equal(c.groqBaseUrl, DEFAULT_GROQ_BASE_URL);
    assert.equal(c.host, '127.0.0.1', 'listens on this machine only by default');
    assert.equal(c.port, 8787);
    assert.equal(c.maxImageBytes, 1_500_000);
    assert.equal(c.ratePerMinute, 6);
    assert.equal(c.maxPerDay, 100);
    assert.equal(c.maxConcurrent, 1);
    assert.equal(c.requestTimeoutMs, 20_000);
    assert.equal(c.maxRetries, 1);
  });

  it('applies overrides, clamps absurd values and falls back for garbage', () => {
    const c = loadConfig({
      GROQ_MODEL: 'some/other-model',
      AI_SERVER_PORT: '99999',
      AI_MAX_IMAGE_BYTES: '999999999',
      AI_RATE_PER_MINUTE: '-4',
      AI_MAX_PER_DAY: 'lots',
      AI_MAX_RETRIES: '50',
      GROQ_API_BASE_URL: 'http://localhost:8790/openai/v1///',
      AI_ALLOWED_ORIGINS: 'http://192.168.1.20:3000/, ,https://dash.example',
    });
    assert.equal(c.model, 'some/other-model');
    assert.equal(c.port, 65535);
    assert.equal(c.maxImageBytes, 4_000_000, 'never above Groq\'s own 4 MB base64 limit');
    assert.equal(c.ratePerMinute, 1);
    assert.equal(c.maxPerDay, 100);
    assert.equal(c.maxRetries, 3);
    assert.equal(c.groqBaseUrl, 'http://localhost:8790/openai/v1');
    assert.deepEqual(c.allowedOrigins, ['http://192.168.1.20:3000', 'https://dash.example']);
  });

  it('recognises the official Groq URL and flags any other (test-only) one', () => {
    assert.equal(isOfficialGroqUrl(DEFAULT_GROQ_BASE_URL), true);
    assert.equal(isOfficialGroqUrl('http://localhost:8790/openai/v1'), false);
    assert.equal(isOfficialGroqUrl('https://api.groq.com.evil.example/openai/v1'), false);
    assert.equal(isOfficialGroqUrl('not a url'), false);
  });
});

describe('.env parsing', () => {
  it('reads KEY=VALUE lines, quotes and comments, and ignores anything odd', () => {
    const env = parseEnvText(
      ['# a comment', 'GROQ_API_KEY="abc 123"', "GROQ_MODEL='m/x'", 'AI_SERVER_PORT=9000 # trailing', 'export AI_MAX_RETRIES=2', 'bad line', '=novalue', '1BAD=x', ''].join('\n'),
    );
    assert.deepEqual(env, { GROQ_API_KEY: 'abc 123', GROQ_MODEL: 'm/x', AI_SERVER_PORT: '9000', AI_MAX_RETRIES: '2' });
  });

  it('loads a file without overriding variables that are already set, and tolerates a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-env-'));
    try {
      const file = join(dir, '.env');
      writeFileSync(file, `GROQ_API_KEY=${FAKE_KEY}\nGROQ_MODEL=from-file\n`);
      const env: Record<string, string | undefined> = { GROQ_MODEL: 'already-set' };
      assert.equal(loadEnvFile(file, env), true);
      assert.equal(env.GROQ_API_KEY, FAKE_KEY);
      assert.equal(env.GROQ_MODEL, 'already-set');
      assert.equal(loadEnvFile(join(dir, 'missing.env'), env), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('secret redaction', () => {
  it('removes the configured key, Groq-style keys and bearer tokens from any text', () => {
    const text = `failed with key ${FAKE_KEY} and Authorization: Bearer abcdefgh12345678 plus gsk_ANOTHER_KEY_VALUE_9999`;
    const out = redactSecrets(text, FAKE_KEY);
    assert.ok(!out.includes(FAKE_KEY));
    assert.ok(!out.includes('abcdefgh12345678'));
    assert.ok(!out.includes('gsk_ANOTHER'));
    assert.match(out, /\[redacted\]/);
  });

  it('leaves ordinary text alone and does not choke on a missing key', () => {
    assert.equal(redactSecrets('rate limit reached', undefined), 'rate limit reached');
  });
});

describe('image validation', () => {
  const MAX = 200_000;

  it('accepts a complete JPEG and reports its real size', () => {
    const check = validateJpegBase64(jpegBase64(640, 480), 'image/jpeg', MAX);
    assert.equal(check.ok, true);
    if (check.ok) {
      assert.equal(check.width, 640);
      assert.equal(check.height, 480);
      assert.equal(check.bytes, 600);
    }
  });

  it('accepts a data: URL prefix and strips it', () => {
    const check = validateJpegBase64(`data:image/jpeg;base64,${jpegBase64()}`, 'image/jpeg', MAX);
    assert.equal(check.ok, true);
    if (check.ok) assert.ok(!check.base64.startsWith('data:'));
  });

  it('rejects the wrong declared type, and anything that is not a non-empty string', () => {
    const wrong = validateJpegBase64(jpegBase64(), 'image/png', MAX);
    assert.equal(wrong.ok === false && wrong.problem, 'wrong_type');
    for (const bad of [undefined, null, 42, {}, '']) {
      const r = validateJpegBase64(bad, 'image/jpeg', MAX);
      assert.equal(r.ok, false, `input ${JSON.stringify(bad)} must be rejected`);
    }
  });

  it('rejects text that is not base64', () => {
    for (const bad of ['not base64!!', 'abc', '@@@@', `${jpegBase64()}%%`]) {
      const r = validateJpegBase64(bad, 'image/jpeg', MAX);
      assert.equal(r.ok === false && r.problem, 'not_base64', bad.slice(0, 12));
    }
  });

  it('rejects data that is base64 but not a JPEG, or a JPEG that is cut off', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]).toString('base64');
    assert.equal(validateJpegBase64(png, 'image/jpeg', MAX).ok, false);
    const truncated = jpegBuffer().subarray(0, 400).toString('base64');
    const r = validateJpegBase64(truncated, 'image/jpeg', MAX);
    assert.equal(r.ok === false && r.problem, 'not_jpeg');
    assert.match(r.ok === false ? r.message : '', /incomplete/);
    assert.equal(validateJpegBase64(Buffer.alloc(50, 0xff).toString('base64'), 'image/jpeg', MAX).ok, false, 'too small to be a picture');
  });

  it('enforces the size limit from the encoded length, before decoding', () => {
    const big = jpegBase64(640, 480, 50_000);
    const r = validateJpegBase64(big, 'image/jpeg', 10_000);
    assert.equal(r.ok === false && r.problem, 'too_large');
    assert.equal(validateJpegBase64(big, 'image/jpeg', 50_000).ok, true, 'exactly at the limit is fine');
    assert.equal(validateJpegBase64(big, 'image/jpeg', 49_999).ok, false);
  });

  it('rejects absurd or tiny picture sizes', () => {
    assert.equal(validateJpegBase64(jpegBase64(MAX_DIMENSION + 1, 480), 'image/jpeg', MAX).ok, false);
    assert.equal(validateJpegBase64(jpegBase64(640, 8), 'image/jpeg', MAX).ok, false);
    assert.equal(validateJpegBase64(jpegBase64(MAX_DIMENSION, MAX_DIMENSION), 'image/jpeg', MAX).ok, true);
  });

  it('readJpegSize finds the frame header, and gives up on data without one', () => {
    assert.deepEqual(readJpegSize(jpegBuffer(320, 240)), { width: 320, height: 240 });
    assert.equal(readJpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
  });
});

describe('model output normalization', () => {
  const norm = (value: unknown) => normalizeModelOutput(typeof value === 'string' ? value : JSON.stringify(value));

  it('keeps label, category, description and the uncertainty flag, plus the summary', () => {
    const r = norm({
      summary: 'A dog in a yard.',
      objects: [{ label: 'dog', category: 'animal', description: 'A brown dog.', uncertain: false }],
    });
    assert.deepEqual(r, {
      summary: 'A dog in a yard.',
      objects: [{ label: 'dog', category: 'animal', description: 'A brown dog.', uncertain: false }],
    });
  });

  it('never invents or passes on confidence scores or boxes: extra keys are dropped', () => {
    const r = norm({
      summary: 's',
      objects: [{ label: 'person', category: 'person', description: 'd', uncertain: false, confidence: 0.99, bbox: [1, 2, 3, 4], class_id: 7 }],
    });
    assert.deepEqual(Object.keys(r.objects[0]).sort(), ['category', 'description', 'label', 'uncertain']);
    assert.ok(!JSON.stringify(r).includes('0.99'));
  });

  it('turns an unknown category into "unknown" and marks it uncertain', () => {
    const r = norm({ summary: '', objects: [{ label: 'thing', category: 'spaceship', description: 'x', uncertain: false }] });
    assert.equal(r.objects[0].category, 'unknown');
    assert.equal(r.objects[0].uncertain, true);
    assert.equal(norm({ summary: '', objects: [{ label: 'x', category: 'Person', description: '', uncertain: false }] }).objects[0].category, 'person', 'case is forgiven');
  });

  it('treats a missing or non-boolean uncertainty flag as a guess', () => {
    const r = norm({ summary: '', objects: [{ label: 'a', category: 'person', description: '' }, { label: 'b', category: 'person', description: '', uncertain: 'no' }] });
    assert.deepEqual(r.objects.map((o) => o.uncertain), [true, true]);
  });

  it('accepts an empty object list (nothing recognised)', () => {
    assert.deepEqual(norm({ summary: 'An empty room.', objects: [] }), { summary: 'An empty room.', objects: [] });
  });

  it('copes with a markdown fence or surrounding prose', () => {
    const body = JSON.stringify({ summary: 's', objects: [] });
    assert.equal(norm('```json\n' + body + '\n```').summary, 's');
    assert.equal(norm('Here you go: ' + body + ' Hope that helps.').summary, 's');
  });

  it('caps the number of objects and the length of every text, and strips control characters', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ label: `o${i}`, category: 'other', description: 'x'.repeat(900), uncertain: false }));
    const r = norm({ summary: 'y'.repeat(900), objects: many });
    assert.equal(r.objects.length, MAX_OBJECTS);
    assert.ok(r.objects[0].description.length <= 200);
    assert.ok(r.summary.length <= 240);
    const dirty = norm({ summary: 'a\u0000b\nc\td', objects: [{ label: 'x\u0007y', category: 'other', description: '', uncertain: false }] });
    assert.equal(dirty.summary, 'a b c d');
    assert.equal(dirty.objects[0].label, 'x y');
  });

  it('skips objects without a usable label or that are not objects', () => {
    const r = norm({ summary: '', objects: [null, 'str', 5, [], { label: '', category: 'person' }, { label: '  ', category: 'person' }, { label: 'ok', category: 'person', description: '', uncertain: false }] });
    assert.deepEqual(r.objects.map((o) => o.label), ['ok']);
  });

  it('keeps HTML as inert text (it is shown as text, never as markup)', () => {
    const r = norm({ summary: '<img src=x onerror=alert(1)>', objects: [] });
    assert.equal(r.summary, '<img src=x onerror=alert(1)>');
  });

  for (const [name, input] of [
    ['empty text', ''],
    ['not JSON', 'I see a person.'],
    ['a JSON array', '[]'],
    ['a JSON string', '"hi"'],
    ['no objects list', '{"summary":"s"}'],
    ['objects not a list', '{"summary":"s","objects":"person"}'],
    ['non-string input', 42],
  ] as Array<[string, unknown]>) {
    it(`rejects malformed output: ${name}`, () => {
      assert.throws(() => normalizeModelOutput(input), MalformedOutputError);
    });
  }
});

describe('RollingLimiter', () => {
  const clock = (start = 1_000_000) => {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('allows up to the per-minute limit, then says how long to wait', () => {
    const c = clock();
    const limiter = new RollingLimiter(3, 100, c);
    for (let i = 0; i < 3; i++) assert.equal(limiter.tryAcquire().ok, true);
    c.advance(20_000);
    const blocked = limiter.tryAcquire();
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.reason, 'minute');
      assert.equal(blocked.retryAfterSec, 40);
    }
    c.advance(40_000);
    assert.equal(limiter.tryAcquire().ok, true, 'the window has rolled on');
  });

  it('enforces the daily cap and reports the time until the oldest request expires', () => {
    const c = clock();
    const limiter = new RollingLimiter(1000, 5, c);
    for (let i = 0; i < 5; i++) {
      assert.equal(limiter.tryAcquire().ok, true);
      c.advance(60_000);
    }
    const blocked = limiter.tryAcquire();
    assert.equal(blocked.ok === false && blocked.reason, 'day');
    assert.equal(limiter.remainingToday(), 0);
    c.advance(24 * 3_600_000);
    assert.equal(limiter.tryAcquire().ok, true);
    assert.equal(limiter.remainingToday(), 4);
  });

  it('a refused request does not use up any budget', () => {
    const c = clock();
    const limiter = new RollingLimiter(1, 10, c);
    limiter.tryAcquire();
    for (let i = 0; i < 20; i++) limiter.tryAcquire();
    assert.equal(limiter.remainingToday(), 9);
  });
});

describe('ConcurrencyGate', () => {
  it('lets only `max` requests in at once and frees a slot exactly once', () => {
    const gate = new ConcurrencyGate(2);
    const a = gate.tryEnter();
    const b = gate.tryEnter();
    assert.ok(a && b);
    assert.equal(gate.tryEnter(), null);
    a!();
    a!(); // a double release must not free a second slot
    assert.equal(gate.inFlight, 1);
    assert.ok(gate.tryEnter());
    assert.equal(gate.tryEnter(), null);
  });
});

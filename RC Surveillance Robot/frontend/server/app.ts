/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_MODEL, ServerConfig } from './config.js';
import { ProviderError, callGroq } from './groqClient.js';
import { validateJpegBase64 } from './image.js';
import { Clock, ConcurrencyGate, RollingLimiter, systemClock } from './limits.js';
import { MalformedOutputError, normalizeModelOutput } from './normalize.js';
import {
  AiBackendStatus,
  AiErrorCode,
  ApiError,
  RECOGNIZE_PATH,
  RecognizeSuccess,
  STATUS_PATH,
} from './protocol.js';
import { redactSecrets } from './redact.js';

export interface AppDeps {
  config: ServerConfig;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: Clock;
  /** One line per request: method, path, status, time. Never a body, an image or a key. */
  log?: (line: string) => void;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Only pages served from this machine (any port), or origins listed in AI_ALLOWED_ORIGINS, may call the API from a browser. */
export function isOriginAllowed(origin: string, config: Pick<ServerConfig, 'allowedOrigins'>): boolean {
  if (config.allowedOrigins.includes(origin.replace(/\/+$/, ''))) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function errorBody(code: AiErrorCode, message: string, retryAfterSec?: number): ApiError {
  return { ok: false, error: { code, message, ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) } };
}

function statusFor(code: AiErrorCode): number {
  switch (code) {
    case 'not_configured':
    case 'busy':
      return 503;
    case 'origin_not_allowed':
      return 403;
    case 'method_not_allowed':
      return 405;
    case 'not_found':
      return 404;
    case 'unsupported_media_type':
      return 415;
    case 'payload_too_large':
      return 413;
    case 'rate_limited':
    case 'quota_exhausted':
      return 429;
    case 'provider_timeout':
      return 504;
    case 'cancelled':
      return 499; // the browser went away; nobody receives this, it only makes the log honest
    case 'bad_request':
    case 'invalid_image':
      return 400;
    default:
      return 502;
  }
}

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? (() => {});
  const limiter = new RollingLimiter(config.ratePerMinute, config.maxPerDay, clock);
  const gate = new ConcurrencyGate(config.maxConcurrent);
  /** Base64 inflates by 4/3; a little room for the JSON around it. */
  const maxBodyBytes = Math.ceil((config.maxImageBytes * 4) / 3) + 2048;

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    if (res.headersSent) return;
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(json);
  }

  function fail(res: ServerResponse, code: AiErrorCode, message: string, retryAfterSec?: number): number {
    const status = statusFor(code);
    send(res, status, errorBody(code, message, retryAfterSec), retryAfterSec !== undefined ? { 'Retry-After': String(retryAfterSec) } : {});
    return status;
  }

  function readBody(req: IncomingMessage): Promise<{ ok: true; text: string } | { ok: false }> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      req.on('data', (chunk: Buffer) => {
        if (done) return;
        size += chunk.length;
        if (size > maxBodyBytes) {
          done = true;
          chunks.length = 0;
          resolve({ ok: false });
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!done) {
          done = true;
          resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
        }
      });
      req.on('error', () => {
        if (!done) {
          done = true;
          resolve({ ok: false });
        }
      });
    });
  }

  function status(res: ServerResponse): number {
    const body: AiBackendStatus = {
      ok: true,
      provider: 'groq',
      configured: Boolean(config.apiKey),
      model: config.model,
      preview: config.model === DEFAULT_MODEL,
      maxImageBytes: config.maxImageBytes,
      mimeTypes: ['image/jpeg'],
      limits: { perMinute: config.ratePerMinute, perDay: config.maxPerDay, remainingToday: limiter.remainingToday() },
    };
    send(res, 200, body);
    return 200;
  }

  async function recognize(req: IncomingMessage, res: ServerResponse): Promise<number> {
    if (!config.apiKey) {
      return fail(res, 'not_configured', 'AI recognition is not configured: GROQ_API_KEY is not set on the server.');
    }
    const contentType = String(req.headers['content-type'] ?? '');
    if (!/^application\/json\b/i.test(contentType)) {
      return fail(res, 'unsupported_media_type', 'Send the request as application/json.');
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      return fail(res, 'payload_too_large', 'The request is too large.');
    }

    const body = await readBody(req);
    if (!body.ok) return fail(res, 'payload_too_large', 'The request is too large.');

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return fail(res, 'bad_request', 'The request body is not valid JSON.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail(res, 'bad_request', 'The request body must be a JSON object.');
    }
    const { imageBase64, mimeType } = parsed as Record<string, unknown>;
    if (typeof imageBase64 !== 'string' || typeof mimeType !== 'string') {
      return fail(res, 'invalid_image', 'The request needs "imageBase64" and "mimeType" as text.');
    }

    const check = validateJpegBase64(imageBase64, mimeType, config.maxImageBytes);
    if (!check.ok) {
      const code: AiErrorCode =
        check.problem === 'too_large' ? 'payload_too_large' : check.problem === 'wrong_type' ? 'unsupported_media_type' : 'invalid_image';
      return fail(res, code, check.message);
    }

    const allowed = limiter.tryAcquire();
    if (!allowed.ok) {
      return allowed.reason === 'day'
        ? fail(res, 'quota_exhausted', `This server's limit of ${config.maxPerDay} AI requests per day has been reached.`, allowed.retryAfterSec)
        : fail(res, 'rate_limited', `Too many AI requests: at most ${config.ratePerMinute} per minute are forwarded.`, allowed.retryAfterSec);
    }
    const release = gate.tryEnter();
    if (!release) return fail(res, 'busy', 'Another recognition is still in progress. Try again in a moment.');

    const aborter = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) aborter.abort(); // the browser gave up: stop waiting for Groq
    };
    res.on('close', onClose);
    const started = clock.now();
    try {
      const reply = await callGroq({ config, fetchImpl: deps.fetchImpl, sleep: deps.sleep, signal: aborter.signal }, check.base64);
      const result = normalizeModelOutput(reply.content);
      const success: RecognizeSuccess = {
        ok: true,
        requestId: randomUUID(),
        model: reply.model,
        result,
        ...(reply.usage ? { usage: reply.usage } : {}),
        latencyMs: Math.max(0, clock.now() - started),
      };
      send(res, 200, success);
      return 200;
    } catch (err) {
      if (err instanceof ProviderError) return fail(res, err.code, err.message, err.retryAfterSec);
      if (err instanceof MalformedOutputError) {
        return fail(res, 'malformed_output', `The model's answer could not be understood (${err.message}). Try again.`);
      }
      log(`unexpected error: ${redactSecrets(err instanceof Error ? err.name : 'unknown', config.apiKey)}`);
      return fail(res, 'internal_error', 'Something went wrong on the server.');
    } finally {
      res.off('close', onClose);
      release();
    }
  }

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = clock.now();
    let statusCode = 500;
    let path = '(unparsed)';
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const origin = req.headers.origin;
      if (path !== RECOGNIZE_PATH && path !== STATUS_PATH) {
        statusCode = fail(res, 'not_found', 'Not found.');
      } else if (typeof origin === 'string' && !isOriginAllowed(origin, config)) {
        statusCode = fail(res, 'origin_not_allowed', 'This origin is not allowed to use the AI backend.');
      } else if (path === STATUS_PATH) {
        statusCode = req.method === 'GET' ? status(res) : fail(res, 'method_not_allowed', 'Use GET.');
      } else {
        statusCode = req.method === 'POST' ? await recognize(req, res) : fail(res, 'method_not_allowed', 'Use POST.');
      }
    } catch (err) {
      log(`handler error: ${redactSecrets(err instanceof Error ? err.name : 'unknown', config.apiKey)}`);
      statusCode = fail(res, 'internal_error', 'Something went wrong on the server.');
    } finally {
      log(`${req.method ?? '?'} ${path} -> ${statusCode} ${Math.max(0, clock.now() - started)}ms`);
    }
  }

  return { handler, limiter, gate };
}

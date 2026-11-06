/**
 * Test doubles for the AI backend. Groq is NEVER contacted: every upstream call goes to a fake
 * `fetch` that records what it was given and returns what the test says. The API key used here is
 * an obvious fake. Results from these tests prove the backend's logic; they say nothing about what
 * the real model returns.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { ServerConfig, loadConfig } from '../server/config';

export const FAKE_KEY = 'gsk_THIS_IS_A_FAKE_TEST_KEY_0123456789';

/**
 * Build a ServerConfig for tests. Accepts the same flat overrides that the old tests used
 * (apiKey, model, groqBaseUrl) as well as new-style overrides. The base config uses
 * FAKE_KEY for Groq, with sane test defaults for all limits.
 */
export function testConfig(overrides: Partial<ServerConfig> & {
  apiKey?: string | undefined;
  model?: string;
  groqBaseUrl?: string;
} = {}): ServerConfig {
  const { apiKey, model, groqBaseUrl, ...rest } = overrides;

  const env: Record<string, string | undefined> = {
    GROQ_API_KEY: Object.prototype.hasOwnProperty.call(overrides, 'apiKey') ? apiKey : FAKE_KEY,
    GROQ_MODEL: model ?? 'qwen/qwen3.8-27b',
    GROQ_API_BASE_URL: groqBaseUrl ?? 'https://api.groq.test/openai/v1',
    AI_MAX_IMAGE_BYTES: String(rest.maxImageBytes ?? 200_000),
    AI_RATE_PER_MINUTE: String(rest.ratePerMinute ?? 60),
    AI_MAX_PER_DAY: String(rest.maxPerDay ?? 1000),
    AI_MAX_CONCURRENT: String(rest.maxConcurrent ?? 2),
    AI_REQUEST_TIMEOUT_MS: String(rest.requestTimeoutMs ?? 1500),
    AI_MAX_RETRIES: String(rest.maxRetries ?? 1),
    AI_ALLOWED_ORIGINS: (rest.allowedOrigins ?? []).join(','),
  };

  const cfg = loadConfig(env);

  // Apply any remaining structured overrides that loadConfig doesn't handle via env
  return Object.assign(cfg, rest);
}

/** A structurally valid JPEG (SOI, JFIF header, start-of-frame with the size, scan, EOI), `size` bytes. */
export function jpegBuffer(width = 640, height = 480, size = 600): Buffer {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const fill = Math.max(0, size - head.length - sof.length - sos.length - 2);
  return Buffer.concat([head, sof, sos, Buffer.alloc(fill, 0x55), Buffer.from([0xff, 0xd9])]);
}

export const jpegBase64 = (width = 640, height = 480, size = 600) => jpegBuffer(width, height, size).toString('base64');

// ------------------------------------------------------------------ Groq fake --

export interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: any;
  rawBody: string;
}

export type UpstreamHandler = (call: UpstreamCall, signal: AbortSignal | undefined, attempt: number) => Response | Promise<Response>;

/** Records every upstream request; the handler decides the answer (it receives the attempt number, from 0). */
export function fakeGroq(handler: UpstreamHandler) {
  const calls: UpstreamCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawBody = String(init?.body ?? '');
    const call: UpstreamCall = {
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: rawBody ? JSON.parse(rawBody) : undefined,
      rawBody,
    };
    calls.push(call);
    return handler(call, init?.signal as AbortSignal | undefined, calls.length - 1);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

export const groqJson = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export function groqAnswer(content: string, usage = { prompt_tokens: 2400, completion_tokens: 120 }) {
  return groqJson({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage });
}

export const groqError = (status: number, message: string, headers: Record<string, string> = {}, code?: string) =>
  groqJson({ error: { message, type: 'error', ...(code ? { code } : {}) } }, status, headers);

export const GOOD_ANSWER = JSON.stringify({
  summary: 'A person stands near a parked car.',
  objects: [
    { label: 'person', category: 'person', description: 'An adult standing on the left.', uncertain: false },
    { label: 'car', category: 'vehicle', description: 'A parked grey car.', uncertain: false },
  ],
});

/** Never resolves until the request is aborted (the timeout or a disconnect). */
export const hangingFetch: UpstreamHandler = (_call, signal) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

// ------------------------------------------------------------- real HTTP server --

export async function startApp(config: ServerConfig, fetchImpl: typeof fetch, extra: { sleep?: (ms: number) => Promise<void> } = {}) {
  const logs: string[] = [];
  const app = createApp({ config, fetchImpl, sleep: extra.sleep ?? (async () => {}), log: (l) => logs.push(l) });
  const server = http.createServer((req, res) => void app.handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    logs,
    app,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    request: (opts: RawOptions) => rawRequest(port, opts),
  };
}

export interface RawOptions {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

/** A plain http.request, so tests control every header (including Origin) and the exact bytes sent. */
export function rawRequest(port: number, opts: RawOptions): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body);
    const req = http.request(
      { host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers: { ...(body ? { 'Content-Length': String(body.length) } : {}), ...opts.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export const jsonPost = (port: number, body: unknown, headers: Record<string, string> = {}) =>
  rawRequest(port, {
    method: 'POST',
    path: '/api/ai/recognize',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

export const goodBody = (width = 640, height = 480) => ({ imageBase64: jpegBase64(width, height), mimeType: 'image/jpeg' });

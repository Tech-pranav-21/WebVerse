/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';

/**
 * Server configuration, read from environment variables (and an optional .env file).
 *
 * GROQ_API_KEY lives only here, on the server. It is never returned by any endpoint, never logged,
 * never put in a response, and the browser bundle does not contain it: Vite only exposes variables
 * that start with VITE_, and this one deliberately does not.
 */

/** Groq lists this model as "Preview". The default can be replaced with GROQ_MODEL. */
export const DEFAULT_MODEL = 'qwen/qwen3.8-27b';
export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export interface ServerConfig {
  /** undefined = not configured (the endpoint answers "not_configured"). */
  apiKey: string | undefined;
  model: string;
  groqBaseUrl: string;
  port: number;
  host: string;
  /** Largest decoded JPEG accepted. Camera frames are typically 20 to 60 kB. */
  maxImageBytes: number;
  /** Requests this server forwards to Groq per rolling minute / per rolling 24 h (all clients together). */
  ratePerMinute: number;
  maxPerDay: number;
  /** Simultaneous requests to Groq. */
  maxConcurrent: number;
  requestTimeoutMs: number;
  /** Extra retries for a transient failure (429 with a short Retry-After, 5xx, network error). Timeouts are never retried. */
  maxRetries: number;
  /** Browser origins allowed in addition to any http(s)://localhost, 127.0.0.1 or [::1] page. */
  allowedOrigins: string[];
}

function intIn(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const key = env.GROQ_API_KEY?.trim();
  return {
    apiKey: key ? key : undefined,
    model: env.GROQ_MODEL?.trim() || DEFAULT_MODEL,
    groqBaseUrl: (env.GROQ_API_BASE_URL?.trim() || DEFAULT_GROQ_BASE_URL).replace(/\/+$/, ''),
    port: intIn(env.AI_SERVER_PORT, 8787, 1, 65535),
    host: env.AI_SERVER_HOST?.trim() || '127.0.0.1',
    maxImageBytes: intIn(env.AI_MAX_IMAGE_BYTES, 1_500_000, 10_000, 4_000_000),
    ratePerMinute: intIn(env.AI_RATE_PER_MINUTE, 6, 1, 60),
    maxPerDay: intIn(env.AI_MAX_PER_DAY, 100, 1, 10_000),
    maxConcurrent: intIn(env.AI_MAX_CONCURRENT, 1, 1, 5),
    requestTimeoutMs: intIn(env.AI_REQUEST_TIMEOUT_MS, 20_000, 2_000, 120_000),
    maxRetries: intIn(env.AI_MAX_RETRIES, 1, 0, 3),
    allowedOrigins: (env.AI_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  };
}

/** Parse the text of a .env file: KEY=VALUE lines, # comments, optional quotes. Never evaluates anything. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[name] = value;
  }
  return out;
}

/** Load a .env file into `env` without overriding variables that are already set. Missing file is fine. */
export function loadEnvFile(path: string, env: Record<string, string | undefined>): boolean {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  for (const [name, value] of Object.entries(parseEnvText(text))) {
    if (env[name] === undefined) env[name] = value;
  }
  return true;
}

/** Whether a base URL still points at Groq. A different one is for testing only (see tools/mock-groq). */
export function isOfficialGroqUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).origin === 'https://api.groq.com';
  } catch {
    return false;
  }
}

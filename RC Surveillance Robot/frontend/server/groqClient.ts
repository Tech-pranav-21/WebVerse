/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ServerConfig } from './config.js';
import { buildGroqRequest } from './prompt.js';
import type { AiErrorCode, TokenUsage } from './protocol.js';
import { redactSecrets } from './redact.js';

/** A Retry-After longer than this is reported to the caller instead of being waited out here. */
export const MAX_RETRY_WAIT_SEC = 5;

export class ProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface GroqReply {
  content: string;
  model: string;
  usage?: TokenUsage;
}

export interface GroqDeps {
  config: ServerConfig;
  fetchImpl?: typeof fetch;
  /** Replaced in tests so retries do not really wait. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ProviderErrorBody {
  message: string;
  code?: string;
}

async function readErrorBody(response: Response, apiKey: string | undefined): Promise<ProviderErrorBody> {
  try {
    const text = await response.text();
    const parsed = JSON.parse(text) as { error?: { message?: unknown; code?: unknown } };
    const message = typeof parsed?.error?.message === 'string' ? parsed.error.message : text;
    return {
      message: redactSecrets(String(message), apiKey).replace(/\s+/g, ' ').slice(0, 300),
      code: typeof parsed?.error?.code === 'string' ? parsed.error.code : undefined,
    };
  } catch {
    return { message: '' };
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

function extractContent(body: unknown): string {
  const message = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

function extractUsage(body: unknown): TokenUsage | undefined {
  const usage = (body as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })?.usage;
  if (typeof usage?.prompt_tokens === 'number' && typeof usage?.completion_tokens === 'number') {
    return { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
  }
  return undefined;
}

/** Map a non-success HTTP status to a ProviderError (never includes the key). */
function classify(status: number, body: ProviderErrorBody, retryAfterSec: number | undefined): ProviderError {
  const detail = body.message ? ` (${body.message})` : '';
  if (status === 401 || status === 403) {
    return new ProviderError('provider_auth', 'Groq rejected the API key. Check GROQ_API_KEY on the server.', 502);
  }
  if (status === 404 || body.code === 'model_not_found') {
    return new ProviderError(
      'provider_rejected',
      'Groq does not know this model. Check GROQ_MODEL: preview models can be renamed or withdrawn without notice.',
      502,
    );
  }
  if (status === 413) {
    return new ProviderError('payload_too_large', 'Groq says the image is too large.', 413);
  }
  if (status === 429) {
    const daily = /per day|tokens per day|requests per day|\bTPD\b|\bRPD\b|daily/i.test(body.message);
    return daily
      ? new ProviderError('quota_exhausted', 'The Groq daily quota is used up. Try again later or check your Groq plan limits.', 429, retryAfterSec)
      : new ProviderError('rate_limited', 'Groq is rate limiting requests. Wait a little and try again.', 429, retryAfterSec);
  }
  if (status === 400) {
    if (/generated json|does not match|schema/i.test(body.message)) {
      return new ProviderError('malformed_output', 'The model did not produce output in the expected format.', 502);
    }
    return new ProviderError('provider_rejected', `Groq rejected the request${detail}.`, 502);
  }
  if (status >= 500) return new ProviderError('provider_error', `Groq had a problem (HTTP ${status}). Try again shortly.`, 502);
  return new ProviderError('provider_rejected', `Groq rejected the request (HTTP ${status})${detail}.`, 502);
}

/**
 * Ask Groq about one image. Retries only transient failures (a 429 whose Retry-After is short, a
 * 5xx, a network error), at most config.maxRetries times. A timeout is never retried (the request
 * may still have been processed and billed), and nor is any other client error.
 */
export async function callGroq(deps: GroqDeps, imageBase64: string): Promise<GroqReply> {
  const { config } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const request = buildGroqRequest(config, imageBase64);

  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < config.maxRetries;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.requestTimeoutMs);
    const onOuterAbort = () => controller.abort();
    deps.signal?.addEventListener('abort', onOuterAbort);

    let response: Response;
    try {
      response = await fetchImpl(request.url, { ...request.init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      deps.signal?.removeEventListener('abort', onOuterAbort);
      if (timedOut) {
        throw new ProviderError('provider_timeout', `Groq did not answer within ${Math.round(config.requestTimeoutMs / 1000)} seconds.`, 504);
      }
      if (deps.signal?.aborted) throw new ProviderError('cancelled', 'The request was cancelled.', 499);
      if (canRetry) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw new ProviderError('provider_unreachable', 'Could not reach Groq. Check the internet connection of the machine running the server.', 502);
    }
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onOuterAbort);

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ProviderError('provider_error', 'Groq sent a reply that could not be read.', 502);
      }
      return { content: extractContent(body), model: config.model, usage: extractUsage(body) };
    }

    const errorBody = await readErrorBody(response, config.apiKey);
    const retryAfterSec = response.status === 429 ? retryAfterSeconds(response) : undefined;
    const error = classify(response.status, errorBody, retryAfterSec);

    const transient =
      response.status >= 500 ||
      (response.status === 429 && error.code === 'rate_limited' && retryAfterSec !== undefined && retryAfterSec <= MAX_RETRY_WAIT_SEC);
    if (transient && canRetry) {
      await sleep(response.status === 429 ? Math.max(1, retryAfterSec ?? 1) * 1000 : 400 * (attempt + 1));
      continue;
    }
    throw error;
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildGroqRequest } from '../prompt.js';
import { redactSecrets } from '../redact.js';
import { MAX_RETRY_WAIT_SEC, ProviderError } from '../groqClient.js';
import type {
  AiProviderAdapter,
  ProviderAdapterDeps,
  ProviderVisionRequest,
  ProviderVisionResponse,
  TestConnectionResult,
} from './types.js';

export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';
export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  const seconds = Number(raw);
  return raw !== null && Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

export class GroqAdapter implements AiProviderAdapter {
  readonly id = 'groq' as const;
  readonly name = 'Groq';
  readonly defaultModel = DEFAULT_GROQ_MODEL;
  readonly availableModels = [
    'qwen/qwen3.8-27b',
    'llama-3.2-11b-vision-preview',
    'llama-3.2-90b-vision-preview',
  ];

  async callVision(req: ProviderVisionRequest, deps?: ProviderAdapterDeps): Promise<ProviderVisionResponse> {
    const fetchImpl = deps?.fetchImpl ?? fetch;
    const sleep = deps?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const baseUrl = (req.baseUrl || DEFAULT_GROQ_BASE_URL).replace(/\/+$/, '');

    const dummyConfig: any = {
      apiKey: req.apiKey,
      model: req.model,
      groqBaseUrl: baseUrl,
      requestTimeoutMs: req.timeoutMs,
      maxRetries: 1,
    };

    const groqReq = buildGroqRequest(dummyConfig, req.imageBase64);

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < dummyConfig.maxRetries;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, req.timeoutMs);

      const onOuterAbort = () => controller.abort();
      deps?.signal?.addEventListener('abort', onOuterAbort);

      let response: Response;
      try {
        response = await fetchImpl(groqReq.url, { ...groqReq.init, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        deps?.signal?.removeEventListener('abort', onOuterAbort);
        if (timedOut) {
          throw new ProviderError(
            'provider_timeout',
            `Groq did not answer within ${Math.round(req.timeoutMs / 1000)} seconds.`,
            504,
          );
        }
        if (deps?.signal?.aborted) throw new ProviderError('cancelled', 'The request was cancelled.', 499);
        if (canRetry) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw new ProviderError(
          'provider_unreachable',
          'Could not reach Groq. Check the internet connection of the machine running the server.',
          502,
        );
      }
      clearTimeout(timer);
      deps?.signal?.removeEventListener('abort', onOuterAbort);

      if (response.ok) {
        let body: any;
        try {
          body = await response.json();
        } catch {
          throw new ProviderError('provider_error', 'Groq sent a reply that could not be read.', 502);
        }

        const choice = body?.choices?.[0]?.message;
        let content = '';
        if (typeof choice?.content === 'string') {
          content = choice.content;
        } else if (Array.isArray(choice?.content)) {
          content = choice.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
        }

        const usage =
          typeof body?.usage?.prompt_tokens === 'number' && typeof body?.usage?.completion_tokens === 'number'
            ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens }
            : undefined;

        return { content, model: req.model, provider: 'groq', usage };
      }

      let errorMsg = '';
      try {
        const text = await response.text();
        const parsed = JSON.parse(text);
        errorMsg = typeof parsed?.error?.message === 'string' ? parsed.error.message : text;
      } catch {
        /* empty */
      }
      errorMsg = redactSecrets(errorMsg, req.apiKey).replace(/\s+/g, ' ').slice(0, 300);

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError('provider_auth', 'Groq rejected the API key. Check GROQ_API_KEY on the server.', 502);
      }
      if (response.status === 404) {
        throw new ProviderError(
          'provider_rejected',
          'Groq does not know this model. Check GROQ_MODEL: preview models can be renamed or withdrawn without notice.',
          502,
        );
      }
      if (response.status === 413) {
        throw new ProviderError('payload_too_large', 'Groq says the image is too large.', 413);
      }
      if (response.status === 429) {
        const retryAfterSec = retryAfterSeconds(response);
        const daily = /per day|tokens per day|requests per day|\bTPD\b|\bRPD\b|daily/i.test(errorMsg);
        const error = daily
          ? new ProviderError('quota_exhausted', 'The Groq daily quota is used up. Try again later or check your Groq plan limits.', 429, retryAfterSec)
          : new ProviderError('rate_limited', 'Groq is rate limiting requests. Wait a little and try again.', 429, retryAfterSec);
        if (!daily && canRetry && retryAfterSec !== undefined && retryAfterSec <= MAX_RETRY_WAIT_SEC) {
          await sleep(Math.max(1, retryAfterSec) * 1000);
          continue;
        }
        throw error;
      }
      if (response.status >= 500 && canRetry) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw new ProviderError('provider_error', `Groq returned HTTP ${response.status}: ${errorMsg}`, 502);
    }
  }

  async testConnection(
    apiKey: string | undefined,
    model: string,
    baseUrl?: string,
    deps?: ProviderAdapterDeps,
  ): Promise<TestConnectionResult> {
    const start = Date.now();
    if (!apiKey || apiKey.trim() === '') {
      return {
        ok: false,
        provider: 'groq',
        model,
        status: 'not_configured',
        message: 'GROQ_API_KEY is not configured on the server.',
      };
    }

    const fetchImpl = deps?.fetchImpl ?? fetch;
    const base = (baseUrl || DEFAULT_GROQ_BASE_URL).replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(model)}`;

    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: deps?.signal,
      });

      const latencyMs = Date.now() - start;

      if (res.ok) {
        return {
          ok: true,
          provider: 'groq',
          model,
          status: 'connected',
          message: `Successfully connected to Groq (${model}).`,
          latencyMs,
        };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          provider: 'groq',
          model,
          status: 'invalid_key',
          message: 'Groq rejected the API key. Check GROQ_API_KEY on the server.',
          latencyMs,
        };
      }

      if (res.status === 404) {
        return {
          ok: false,
          provider: 'groq',
          model,
          status: 'model_unavailable',
          message: `Model "${model}" not found or not accessible on Groq.`,
          latencyMs,
        };
      }

      return {
        ok: false,
        provider: 'groq',
        model,
        status: 'failed',
        message: `Groq connection check returned HTTP ${res.status}.`,
        latencyMs,
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'groq',
        model,
        status: 'provider_unavailable',
        message: 'Could not reach Groq API. Check network connectivity.',
        latencyMs: Date.now() - start,
      };
    }
  }
}

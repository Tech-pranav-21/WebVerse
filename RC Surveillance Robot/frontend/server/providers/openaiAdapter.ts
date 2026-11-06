/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PROMPT, RESPONSE_SCHEMA } from '../prompt.js';
import { redactSecrets } from '../redact.js';
import { ProviderError } from '../groqClient.js';
import type {
  AiProviderAdapter,
  ProviderAdapterDeps,
  ProviderVisionRequest,
  ProviderVisionResponse,
  TestConnectionResult,
} from './types.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

export class OpenAiAdapter implements AiProviderAdapter {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI';
  readonly defaultModel = DEFAULT_OPENAI_MODEL;
  readonly availableModels = [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4-turbo',
  ];

  async callVision(req: ProviderVisionRequest, deps?: ProviderAdapterDeps): Promise<ProviderVisionResponse> {
    const fetchImpl = deps?.fetchImpl ?? fetch;
    const sleep = deps?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const baseUrl = (req.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');

    const url = `${baseUrl}/v1/chat/completions`;

    const body = {
      model: req.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.imageBase64}` } },
          ],
        },
      ],
      temperature: 0.4,
      max_tokens: 700,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'camera_frame_recognition',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    };

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < 1;
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
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${req.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        deps?.signal?.removeEventListener('abort', onOuterAbort);
        if (timedOut) {
          throw new ProviderError(
            'provider_timeout',
            `OpenAI did not answer within ${Math.round(req.timeoutMs / 1000)} seconds.`,
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
          'Could not reach OpenAI API. Check network connectivity.',
          502,
        );
      }
      clearTimeout(timer);
      deps?.signal?.removeEventListener('abort', onOuterAbort);

      if (response.ok) {
        let json: any;
        try {
          json = await response.json();
        } catch {
          throw new ProviderError('provider_error', 'OpenAI returned an unreadable response.', 502);
        }

        const choice = json?.choices?.[0]?.message;
        let content = '';
        if (typeof choice?.content === 'string') {
          content = choice.content;
        } else if (Array.isArray(choice?.content)) {
          content = choice.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
        }

        const usage =
          typeof json?.usage?.prompt_tokens === 'number' && typeof json?.usage?.completion_tokens === 'number'
            ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
            : undefined;

        return { content, model: req.model, provider: 'openai', usage };
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
        throw new ProviderError('provider_auth', 'OpenAI rejected the API key. Check OPENAI_API_KEY on the server.', 502);
      }
      if (response.status === 404) {
        throw new ProviderError(
          'provider_rejected',
          `OpenAI does not recognize model "${req.model}". Check OPENAI_MODEL.`,
          502,
        );
      }
      if (response.status === 413) {
        throw new ProviderError('payload_too_large', 'OpenAI says the image is too large.', 413);
      }
      if (response.status === 429) {
        const quota = /quota|insufficient_quota/i.test(errorMsg);
        throw new ProviderError(
          quota ? 'quota_exhausted' : 'rate_limited',
          quota ? 'OpenAI quota exceeded. Check your plan billing and limits.' : 'OpenAI rate limit exceeded.',
          429,
        );
      }
      if (response.status >= 500 && canRetry) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw new ProviderError('provider_error', `OpenAI returned HTTP ${response.status}: ${errorMsg}`, 502);
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
        provider: 'openai',
        model,
        status: 'not_configured',
        message: 'OPENAI_API_KEY is not configured on the server.',
      };
    }

    const fetchImpl = deps?.fetchImpl ?? fetch;
    const base = (baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
    const url = `${base}/v1/models/${encodeURIComponent(model)}`;

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
          provider: 'openai',
          model,
          status: 'connected',
          message: `Successfully connected to OpenAI (${model}).`,
          latencyMs,
        };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          provider: 'openai',
          model,
          status: 'invalid_key',
          message: 'OpenAI rejected the API key. Check OPENAI_API_KEY on the server.',
          latencyMs,
        };
      }

      if (res.status === 404) {
        return {
          ok: false,
          provider: 'openai',
          model,
          status: 'model_unavailable',
          message: `Model "${model}" not found or not accessible on OpenAI.`,
          latencyMs,
        };
      }

      return {
        ok: false,
        provider: 'openai',
        model,
        status: 'failed',
        message: `OpenAI connection check returned HTTP ${res.status}.`,
        latencyMs,
      };
    } catch {
      return {
        ok: false,
        provider: 'openai',
        model,
        status: 'provider_unavailable',
        message: 'Could not reach OpenAI API. Check network connectivity.',
        latencyMs: Date.now() - start,
      };
    }
  }
}

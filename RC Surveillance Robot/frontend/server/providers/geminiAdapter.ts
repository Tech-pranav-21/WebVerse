/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PROMPT } from '../prompt.js';
import { redactSecrets } from '../redact.js';
import { ProviderError } from '../groqClient.js';
import type {
  AiProviderAdapter,
  ProviderAdapterDeps,
  ProviderVisionRequest,
  ProviderVisionResponse,
  TestConnectionResult,
} from './types.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    objects: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          category: { type: 'STRING', enum: ['person', 'animal', 'vehicle', 'other', 'unknown'] },
          description: { type: 'STRING' },
          uncertain: { type: 'BOOLEAN' },
        },
        required: ['label', 'category', 'description', 'uncertain'],
      },
    },
  },
  required: ['summary', 'objects'],
};

export class GeminiAdapter implements AiProviderAdapter {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';
  readonly defaultModel = DEFAULT_GEMINI_MODEL;
  readonly availableModels = [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ];

  async callVision(req: ProviderVisionRequest, deps?: ProviderAdapterDeps): Promise<ProviderVisionResponse> {
    const fetchImpl = deps?.fetchImpl ?? fetch;
    const sleep = deps?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const baseUrl = (req.baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');

    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: req.imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
        maxOutputTokens: 700,
        temperature: 0.4,
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
            `Gemini did not answer within ${Math.round(req.timeoutMs / 1000)} seconds.`,
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
          'Could not reach Google Gemini API. Check network connectivity.',
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
          throw new ProviderError('provider_error', 'Gemini returned an unreadable response.', 502);
        }

        const candidate = json?.candidates?.[0];
        const part = candidate?.content?.parts?.[0];
        const content = typeof part?.text === 'string' ? part.text : '';

        const usageMetadata = json?.usageMetadata;
        const usage =
          typeof usageMetadata?.promptTokenCount === 'number' && typeof usageMetadata?.candidatesTokenCount === 'number'
            ? {
                promptTokens: usageMetadata.promptTokenCount,
                completionTokens: usageMetadata.candidatesTokenCount,
              }
            : undefined;

        return {
          content,
          model: req.model,
          provider: 'gemini',
          usage,
        };
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

      if (response.status === 400 && /API_KEY_INVALID|key not valid/i.test(errorMsg)) {
        throw new ProviderError('provider_auth', 'Google rejected the Gemini API key. Check GEMINI_API_KEY.', 502);
      }
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError('provider_auth', 'Google rejected the Gemini API key. Check GEMINI_API_KEY.', 502);
      }
      if (response.status === 404) {
        throw new ProviderError('provider_rejected', `Gemini model "${req.model}" not found. Check GEMINI_MODEL.`, 502);
      }
      if (response.status === 429) {
        throw new ProviderError('rate_limited', 'Gemini rate limit exceeded. Please wait a moment.', 429);
      }
      if (response.status >= 500 && canRetry) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw new ProviderError('provider_error', `Gemini returned HTTP ${response.status}: ${errorMsg}`, 502);
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
        provider: 'gemini',
        model,
        status: 'not_configured',
        message: 'GEMINI_API_KEY is not configured on the server.',
      };
    }

    const fetchImpl = deps?.fetchImpl ?? fetch;
    const base = (baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
    const url = `${base}/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`;

    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        signal: deps?.signal,
      });

      const latencyMs = Date.now() - start;

      if (res.ok) {
        return {
          ok: true,
          provider: 'gemini',
          model,
          status: 'connected',
          message: `Successfully connected to Google Gemini (${model}).`,
          latencyMs,
        };
      }

      let errorMsg = '';
      try {
        const text = await res.text();
        const parsed = JSON.parse(text);
        errorMsg = typeof parsed?.error?.message === 'string' ? parsed.error.message : text;
      } catch {
        /* empty */
      }
      errorMsg = redactSecrets(errorMsg, apiKey);

      if (res.status === 400 && /API_KEY_INVALID|key not valid/i.test(errorMsg)) {
        return {
          ok: false,
          provider: 'gemini',
          model,
          status: 'invalid_key',
          message: 'Google rejected the Gemini API key. Check GEMINI_API_KEY on the server.',
          latencyMs,
        };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          provider: 'gemini',
          model,
          status: 'invalid_key',
          message: 'Google rejected the Gemini API key. Check GEMINI_API_KEY on the server.',
          latencyMs,
        };
      }

      if (res.status === 404) {
        return {
          ok: false,
          provider: 'gemini',
          model,
          status: 'model_unavailable',
          message: `Model "${model}" not found on Google Gemini API.`,
          latencyMs,
        };
      }

      return {
        ok: false,
        provider: 'gemini',
        model,
        status: 'failed',
        message: `Gemini connection check returned HTTP ${res.status}.`,
        latencyMs,
      };
    } catch {
      return {
        ok: false,
        provider: 'gemini',
        model,
        status: 'provider_unavailable',
        message: 'Could not reach Google Gemini API. Check network connectivity.',
        latencyMs: Date.now() - start,
      };
    }
  }
}

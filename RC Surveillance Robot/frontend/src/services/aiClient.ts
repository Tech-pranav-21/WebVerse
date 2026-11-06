/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiBackendStatus,
  AiErrorCode,
  AiProviderId,
  CONFIG_PATH,
  RECOGNIZE_PATH,
  RecognizeRequest,
  RecognizeSuccess,
  STATUS_PATH,
  TEST_CONNECTION_PATH,
  TestConnectionResponse,
  UpdateAiConfigResponse,
} from '../../server/protocol';

/**
 * Browser side of the AI backend. The browser only ever talks to this app's own backend
 * (/api/ai/..., proxied by Vite); the backend holds the provider keys and calls upstream APIs.
 * Nothing here can leak keys, and nothing in the frontend knows them.
 */

export class AiClientError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly retryAfterSec?: number,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}

export interface AiClientOptions {
  fetchImpl?: typeof fetch;
  /** Prefix for the API paths (empty = same origin). */
  baseUrl?: string;
  recognizeTimeoutMs?: number;
  statusTimeoutMs?: number;
}

export interface RecognizeOptions {
  provider?: AiProviderId;
  model?: string;
}

export interface AiClient {
  status(signal?: AbortSignal): Promise<AiBackendStatus>;
  recognize(
    frame: Blob,
    optionsOrSignal?: RecognizeOptions | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<RecognizeSuccess>;
  testConnection(
    provider: AiProviderId,
    model?: string,
    signal?: AbortSignal,
  ): Promise<TestConnectionResponse>;
  updateConfig(
    activeProvider?: AiProviderId,
    model?: string,
    signal?: AbortSignal,
  ): Promise<UpdateAiConfigResponse>;
}

const BACKEND_DOWN_MESSAGE =
  'The AI backend is not reachable. Start it with "npm run server" and ensure provider credentials are configured on the server.';

/** Base64 of the blob's bytes, without allocating one giant string at once. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function createAiClient(options: AiClientOptions = {}): AiClient {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const base = options.baseUrl ?? '';
  const recognizeTimeoutMs = options.recognizeTimeoutMs ?? 30_000;
  const statusTimeoutMs = options.statusTimeoutMs ?? 5_000;

  async function call(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    outer?: AbortSignal,
  ): Promise<{ response: Response; json: any }> {
    if (outer?.aborted) throw new AiClientError('cancelled', 'The request was cancelled.');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    outer?.addEventListener('abort', onOuterAbort);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${base}${path}`, { ...init, signal: controller.signal, cache: 'no-store' });
      } catch {
        if (timedOut) throw new AiClientError('timeout', `The AI backend did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
        if (outer?.aborted) throw new AiClientError('cancelled', 'The request was cancelled.');
        throw new AiClientError('backend_unreachable', BACKEND_DOWN_MESSAGE);
      }
      let json: any = null;
      try {
        json = await response.json();
      } catch {
        throw new AiClientError('backend_unreachable', BACKEND_DOWN_MESSAGE, undefined, response.status);
      }
      return { response, json };
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    }
  }

  function toError(json: any, status: number): AiClientError {
    const err = json?.error;
    if (json && json.ok === false && typeof err?.code === 'string' && typeof err?.message === 'string') {
      return new AiClientError(err.code as AiErrorCode, err.message, typeof err.retryAfterSec === 'number' ? err.retryAfterSec : undefined, status);
    }
    return new AiClientError('internal_error', 'The AI backend sent an unexpected answer.', undefined, status);
  }

  return {
    async status(signal) {
      const { response, json } = await call(STATUS_PATH, { method: 'GET' }, statusTimeoutMs, signal);
      if (!response.ok || !json || json.ok !== true || typeof json.configured !== 'boolean' || typeof json.model !== 'string') {
        throw toError(json, response.status);
      }
      return json as AiBackendStatus;
    },

    async recognize(frame, optionsOrSignal, maybeSignal) {
      let opts: RecognizeOptions = {};
      let signal: AbortSignal | undefined;

      if (optionsOrSignal && 'aborted' in optionsOrSignal) {
        signal = optionsOrSignal as AbortSignal;
      } else {
        opts = (optionsOrSignal as RecognizeOptions) || {};
        signal = maybeSignal;
      }

      const body: RecognizeRequest = {
        imageBase64: await blobToBase64(frame),
        mimeType: 'image/jpeg',
        ...(opts.provider ? { provider: opts.provider } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      };

      const { response, json } = await call(
        RECOGNIZE_PATH,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        recognizeTimeoutMs,
        signal,
      );
      const result = json?.result;
      if (!response.ok || !json || json.ok !== true || !result || !Array.isArray(result.objects) || typeof result.summary !== 'string') {
        throw toError(json, response.status);
      }
      return json as RecognizeSuccess;
    },

    async testConnection(provider, model, signal) {
      const { response, json } = await call(
        TEST_CONNECTION_PATH,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, model }),
        },
        15_000,
        signal,
      );
      if (!response.ok || !json) {
        throw toError(json, response.status);
      }
      return json as TestConnectionResponse;
    },

    async updateConfig(activeProvider, model, signal) {
      const { response, json } = await call(
        CONFIG_PATH,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeProvider, model }),
        },
        5_000,
        signal,
      );
      if (!response.ok || !json) {
        throw toError(json, response.status);
      }
      return json as UpdateAiConfigResponse;
    },
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiErrorCode, TokenUsage } from '../protocol.js';

export type AiProviderId = 'groq' | 'gemini' | 'openai';

export interface ProviderVisionRequest {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  imageBase64: string;
  timeoutMs: number;
}

export interface ProviderVisionResponse {
  content: string;
  model: string;
  provider: AiProviderId;
  usage?: TokenUsage;
}

export type ConnectionStatus =
  | 'connected'
  | 'invalid_key'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'not_configured'
  | 'failed';

export interface TestConnectionResult {
  ok: boolean;
  provider: AiProviderId;
  model: string;
  status: ConnectionStatus;
  message: string;
  latencyMs?: number;
}

export interface ProviderAdapterDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export interface AiProviderAdapter {
  readonly id: AiProviderId;
  readonly name: string;
  readonly defaultModel: string;
  readonly availableModels: string[];
  callVision(req: ProviderVisionRequest, deps?: ProviderAdapterDeps): Promise<ProviderVisionResponse>;
  testConnection(
    apiKey: string | undefined,
    model: string,
    baseUrl?: string,
    deps?: ProviderAdapterDeps,
  ): Promise<TestConnectionResult>;
}

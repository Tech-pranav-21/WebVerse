/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The contract between the browser and the AI backend (server/). Pure types and constants, no
 * Node or browser APIs, so both sides import this one file and cannot drift apart.
 */

export const AI_PROVIDERS = ['groq', 'gemini', 'openai'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_CATEGORIES = ['person', 'animal', 'vehicle', 'other', 'unknown'] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

/** The categories the user can switch on or off as event triggers ('unknown' never triggers). */
export const FILTERABLE_CATEGORIES = ['person', 'animal', 'vehicle', 'other'] as const;
export type FilterableCategory = (typeof FILTERABLE_CATEGORIES)[number];

/** One thing the model says it sees. */
export interface RecognizedObject {
  /** Short name, e.g. "person", "delivery van". */
  label: string;
  category: AiCategory;
  /** One short sentence. */
  description: string;
  /** The model itself flagged this as a guess (or the output was too vague to trust). */
  uncertain: boolean;
  /** Optional confidence score (0-1) when provided by model; null if not provided. Never fabricated. */
  confidence?: number | null;
}

export interface RecognitionResult {
  /** One sentence about the scene. */
  summary: string;
  objects: RecognizedObject[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export type AiErrorCode =
  | 'not_configured'
  | 'origin_not_allowed'
  | 'method_not_allowed'
  | 'not_found'
  | 'bad_request'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'invalid_image'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'busy'
  | 'provider_auth'
  | 'provider_rejected'
  | 'provider_error'
  | 'provider_timeout'
  | 'provider_unreachable'
  | 'malformed_output'
  | 'internal_error'
  // browser-side only
  | 'backend_unreachable'
  | 'timeout'
  | 'cancelled'
  | 'frame_unavailable'
  | 'frame_blocked'
  | 'image_too_large';

export interface RecognizeRequest {
  /** Base64 of a JPEG (no "data:" prefix). */
  imageBase64: string;
  mimeType: 'image/jpeg';
  /** Optional provider selection override. */
  provider?: AiProviderId;
  /** Optional model override. */
  model?: string;
}

export interface RecognizeSuccess {
  ok: true;
  requestId: string;
  provider: AiProviderId;
  model: string;
  result: RecognitionResult;
  usage?: TokenUsage;
  latencyMs: number;
}

export interface ApiError {
  ok: false;
  error: {
    code: AiErrorCode;
    /** Safe to show to the user: never contains a secret or a stack trace. */
    message: string;
    retryAfterSec?: number;
  };
}

export type RecognizeResponse = RecognizeSuccess | ApiError;

export interface ProviderInfo {
  id: AiProviderId;
  name: string;
  configured: boolean;
  model: string;
  availableModels: string[];
}

export interface AiBackendStatus {
  ok: true;
  provider: AiProviderId;
  activeProvider: AiProviderId;
  /** Whether the active provider is configured with an API key. Key is never returned. */
  configured: boolean;
  model: string;
  /** For backwards compatibility with single-model display. */
  preview: boolean;
  providers: Record<AiProviderId, ProviderInfo>;
  maxImageBytes: number;
  mimeTypes: ['image/jpeg'];
  limits: { perMinute: number; perDay: number; remainingToday: number };
}

export interface TestConnectionRequest {
  provider: AiProviderId;
  model?: string;
}

export type ConnectionStatus =
  | 'connected'
  | 'invalid_key'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'not_configured'
  | 'failed';

export interface TestConnectionResponse {
  ok: boolean;
  provider: AiProviderId;
  model: string;
  status: ConnectionStatus;
  message: string;
  latencyMs?: number;
}

export interface UpdateAiConfigRequest {
  activeProvider?: AiProviderId;
  model?: string;
}

export interface UpdateAiConfigResponse {
  ok: boolean;
  activeProvider: AiProviderId;
  model: string;
  message: string;
}

export const RECOGNIZE_PATH = '/api/ai/recognize';
export const STATUS_PATH = '/api/ai/status';
export const TEST_CONNECTION_PATH = '/api/ai/test-connection';
export const CONFIG_PATH = '/api/ai/config';

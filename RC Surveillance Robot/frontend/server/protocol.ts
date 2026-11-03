/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The contract between the browser and the AI backend (server/). Pure types and constants, no
 * Node or browser APIs, so both sides import this one file and cannot drift apart.
 */

export const AI_CATEGORIES = ['person', 'animal', 'vehicle', 'other', 'unknown'] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

/** The categories the user can switch on or off as event triggers ('unknown' never triggers). */
export const FILTERABLE_CATEGORIES = ['person', 'animal', 'vehicle', 'other'] as const;
export type FilterableCategory = (typeof FILTERABLE_CATEGORIES)[number];

/** One thing the model says it sees. There is deliberately no confidence number and no bounding box. */
export interface RecognizedObject {
  /** Short name, e.g. "person", "delivery van". */
  label: string;
  category: AiCategory;
  /** One short sentence. */
  description: string;
  /** The model itself flagged this as a guess (or the output was too vague to trust). */
  uncertain: boolean;
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
}

export interface RecognizeSuccess {
  ok: true;
  requestId: string;
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

export interface AiBackendStatus {
  ok: true;
  provider: 'groq';
  /** A GROQ_API_KEY is set on the server. The key itself is never returned. */
  configured: boolean;
  model: string;
  /** Groq labels this model "Preview": it may change or be withdrawn at short notice. */
  preview: boolean;
  maxImageBytes: number;
  mimeTypes: ['image/jpeg'];
  limits: { perMinute: number; perDay: number; remainingToday: number };
}

export const RECOGNIZE_PATH = '/api/ai/recognize';
export const STATUS_PATH = '/api/ai/status';

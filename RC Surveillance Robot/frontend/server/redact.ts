/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const GROQ_KEY_RE = /gsk_[A-Za-z0-9_-]{8,}/g;
const OPENAI_KEY_RE = /sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g;
const GEMINI_KEY_RE = /AIza[0-9A-Za-z-_]{35}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * Remove anything that looks like an API key from text before it is logged or returned: the
 * configured key itself, provider-specific keys (gsk_..., sk-..., AIza...) and Authorization bearer tokens.
 */
export function redactSecrets(text: string, apiKey?: string | string[]): string {
  let out = text;
  if (typeof apiKey === 'string' && apiKey.length >= 8) {
    out = out.split(apiKey).join('[redacted]');
  } else if (Array.isArray(apiKey)) {
    for (const key of apiKey) {
      if (typeof key === 'string' && key.length >= 8) {
        out = out.split(key).join('[redacted]');
      }
    }
  }
  return out
    .replace(GROQ_KEY_RE, '[redacted]')
    .replace(OPENAI_KEY_RE, '[redacted]')
    .replace(GEMINI_KEY_RE, '[redacted]')
    .replace(BEARER_RE, 'Bearer [redacted]');
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const GROQ_KEY_RE = /gsk_[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * Remove anything that looks like an API key from text before it is logged or returned: the
 * configured key itself, Groq-style keys (gsk_...) and Authorization bearer tokens.
 */
export function redactSecrets(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join('[redacted]');
  return out.replace(GROQ_KEY_RE, '[redacted]').replace(BEARER_RE, 'Bearer [redacted]');
}

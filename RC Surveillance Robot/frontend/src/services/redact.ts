/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Helpers that keep secrets out of anything the dashboard stores or lets the user copy
 * (connection history, diagnostic report).
 *
 * What is removed: credentials in a URL (user:password@), the whole query string and fragment
 * (where tokens usually live), and "password=...", "token=...", "Authorization: ..." style pairs
 * inside free text such as browser error messages.
 *
 * What is NOT removed: the host name / IP address and the path. The camera address is the thing a
 * person troubleshooting needs to see. A secret placed in a URL *path* cannot be recognised
 * and would be copied as is; the dashboard never builds such URLs itself.
 */

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * "http://admin:secret@192.168.1.5:81/stream?token=abc#x" -> "http://192.168.1.5:81/stream".
 * Accepts bare hosts ("192.168.1.5") and returns them without inventing a scheme.
 * Returns '' for empty input.
 */
export function sanitizeUrl(input: string | null | undefined): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const hasScheme = SCHEME_RE.test(raw);
  try {
    const url = new URL(hasScheme ? raw : `http://${raw}`);
    const path = url.pathname === '/' ? '' : url.pathname;
    const origin = hasScheme ? url.origin : url.host;
    // Non-special schemes can have the opaque origin "null"; fall back to the text form then.
    if (origin === 'null') return stripUrlSecrets(raw);
    return `${origin}${path}`;
  } catch {
    // Not a parsable URL. Strip what can be stripped without calling redactText (which would
    // call back into this function for anything URL-shaped).
    return maskSecrets(stripUrlSecrets(raw)).slice(0, 200);
  }
}

/** Last-resort string-based cleanup for something that is not a parsable URL. */
function stripUrlSecrets(raw: string): string {
  return raw.replace(/\/\/[^/@\s]*@/, '//').replace(/[?#].*$/, '');
}

const URL_IN_TEXT_RE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'<>)\]]+/g;
const SECRET_PAIR_RE =
  /\b(password|passwd|pwd|token|access[_-]?token|secret|api[_-]?key|apikey|authorization|auth)(\s*[=:]\s*)(?:Bearer\s+|Basic\s+)?[^\s&;,"')]+/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g;
const BARE_CREDENTIALS_RE = /\b[\w.~-]+:[^\s/@:]+@(?=[\w-]+(?:\.[\w-]+)*(?::\d+)?(?:[/\s]|$))/g;

/** Secret-looking pairs and tokens in text; does not look at URLs. */
function maskSecrets(text: string): string {
  return text
    .replace(BARE_CREDENTIALS_RE, '')
    .replace(SECRET_PAIR_RE, (_m, key: string, sep: string) => `${key}${sep}[redacted]`)
    .replace(BEARER_RE, (_m, scheme: string) => `${scheme} [redacted]`);
}

/** Redact URLs and secret-looking pairs inside free text. */
export function redactText(text: string | null | undefined): string {
  if (!text) return '';
  return maskSecrets(text.replace(URL_IN_TEXT_RE, (m) => sanitizeUrl(m)));
}

/** Redact, collapse whitespace and cap the length (used before storing a message). */
export function cleanMessage(text: string | null | undefined, maxLength = 240): string {
  const redacted = redactText(text).replace(/\s+/g, ' ').trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1)}…` : redacted;
}

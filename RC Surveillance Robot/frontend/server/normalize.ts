/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AI_CATEGORIES, AiCategory, RecognitionResult, RecognizedObject } from './protocol.js';

export const MAX_OBJECTS = 10;
const MAX_LABEL = 60;
const MAX_DESCRIPTION = 200;
const MAX_SUMMARY = 240;

export class MalformedOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedOutputError';
  }
}

const CATEGORY_SET: ReadonlySet<string> = new Set(AI_CATEGORIES);

/** Plain text only: control characters and runs of whitespace removed, length capped. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Take the JSON text out of a reply that may be wrapped in a markdown fence or surrounded by prose. */
function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) return fenced[1];
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

/**
 * Turn the model's text into a RecognitionResult, or throw MalformedOutputError.
 *
 * Nothing is invented: only label, category, description and uncertain are kept, everything else
 * the model may have written (probabilities, boxes, extra keys) is dropped, an unknown category
 * becomes "unknown", and anything whose type is wrong makes the object uncertain.
 */
export function normalizeModelOutput(content: unknown): RecognitionResult {
  if (typeof content !== 'string' || content.trim() === '') throw new MalformedOutputError('The model returned no text.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    throw new MalformedOutputError('The model reply was not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MalformedOutputError('The model reply was not a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.objects)) throw new MalformedOutputError('The model reply has no "objects" list.');

  const objects: RecognizedObject[] = [];
  for (const raw of record.objects) {
    if (objects.length >= MAX_OBJECTS) break;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const label = cleanText(o.label, MAX_LABEL);
    if (!label) continue;
    const categoryText = typeof o.category === 'string' ? o.category.trim().toLowerCase() : '';
    const known = CATEGORY_SET.has(categoryText);
    const category: AiCategory = known ? (categoryText as AiCategory) : 'unknown';
    objects.push({
      label,
      category,
      description: cleanText(o.description, MAX_DESCRIPTION),
      // A missing or non-boolean flag, or an unrecognised category, is treated as a guess.
      uncertain: o.uncertain === true || typeof o.uncertain !== 'boolean' || !known || category === 'unknown',
    });
  }
  return { summary: cleanText(record.summary, MAX_SUMMARY), objects };
}

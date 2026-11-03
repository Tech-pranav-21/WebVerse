/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Copy text to the clipboard and say honestly whether it worked.
 *
 * navigator.clipboard only exists in a secure context (HTTPS or localhost). This dashboard is
 * often opened over plain HTTP from a phone (http://192.168.x.x:3000), where that API is simply
 * missing, so there is a fallback that selects the text in a hidden textarea and asks the
 * browser to copy the selection. If both fail the caller gets a reason it can show, and the UI
 * offers the text for manual copying instead of pretending it worked.
 */

export type CopyFailureReason = 'empty' | 'denied' | 'unavailable' | 'failed';

export type CopyResult =
  | { ok: true; method: 'clipboard-api' | 'selection' }
  | { ok: false; reason: CopyFailureReason; message: string };

interface TextareaLike {
  value: string;
  readOnly: boolean;
  style: Record<string, string> & { cssText?: string };
  setAttribute(name: string, value: string): void;
  select(): void;
  setSelectionRange?(start: number, end: number): void;
  focus?(): void;
}

export interface DocumentLike {
  body: { appendChild(node: unknown): unknown; removeChild(node: unknown): unknown } | null;
  createElement(tag: string): unknown;
  execCommand(command: string): boolean;
  activeElement?: { focus?: () => void } | null;
}

export interface ClipboardEnv {
  clipboard?: { writeText(text: string): Promise<void> } | null;
  document?: DocumentLike | null;
}

export function browserClipboardEnv(): ClipboardEnv {
  return {
    clipboard: typeof navigator !== 'undefined' ? (navigator.clipboard ?? null) : null,
    document: typeof document !== 'undefined' ? (document as unknown as DocumentLike) : null,
  };
}

const MANUAL = 'Select the report text below and copy it manually (Ctrl+C, or Cmd+C on a Mac).';

export async function copyText(text: string, env: ClipboardEnv = browserClipboardEnv()): Promise<CopyResult> {
  if (!text) return { ok: false, reason: 'empty', message: 'There is nothing to copy.' };

  let denied = false;
  if (env.clipboard && typeof env.clipboard.writeText === 'function') {
    try {
      await env.clipboard.writeText(text);
      return { ok: true, method: 'clipboard-api' };
    } catch (err) {
      denied = isPermissionError(err);
      // Fall through: the selection fallback sometimes works where the async API is refused.
    }
  }

  if (env.document && copyViaSelection(text, env.document)) {
    return { ok: true, method: 'selection' };
  }

  if (denied) {
    return { ok: false, reason: 'denied', message: `The browser blocked clipboard access. ${MANUAL}` };
  }
  if (!env.clipboard && !env.document) {
    return { ok: false, reason: 'unavailable', message: `Clipboard access is not available here. ${MANUAL}` };
  }
  return {
    ok: false,
    reason: env.clipboard ? 'failed' : 'unavailable',
    message: env.clipboard
      ? `Copying failed. ${MANUAL}`
      : `This page cannot use the clipboard API (it needs HTTPS or localhost) and the fallback did not work. ${MANUAL}`,
  };
}

function isPermissionError(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

function copyViaSelection(text: string, doc: DocumentLike): boolean {
  if (!doc.body) return false;
  const previouslyFocused = doc.activeElement ?? null;
  let area: TextareaLike | null = null;
  try {
    area = doc.createElement('textarea') as TextareaLike;
    area.value = text;
    area.readOnly = true;
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    area.select();
    area.setSelectionRange?.(0, text.length);
    return doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    try {
      if (area && doc.body) doc.body.removeChild(area);
    } catch {
      // already detached
    }
    try {
      previouslyFocused?.focus?.();
    } catch {
      // focus restoration is best effort
    }
  }
}

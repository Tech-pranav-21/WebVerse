/**
 * Clipboard helper. MOCKED clipboard API and document: this proves the decision logic and the
 * cleanup, not that any particular browser grants access. Real-browser behaviour (permission
 * prompts, insecure-context availability) is described in the README and report.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyText, type ClipboardEnv, type DocumentLike } from '../src/services/clipboard';

class FakeTextarea {
  value = '';
  readOnly = false;
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  selected = false;
  setAttribute(n: string, v: string) { this.attrs[n] = v; }
  select() { this.selected = true; }
  setSelectionRange() {}
}

function fakeDocument(opts: { exec?: boolean | Error; createThrows?: boolean } = {}) {
  const body = { children: [] as unknown[], appendChild(n: unknown) { this.children.push(n); }, removeChild(n: unknown) { this.children = this.children.filter((c) => c !== n); } };
  const focused = { focusCalls: 0, focus() { this.focusCalls++; } };
  const doc = {
    body,
    activeElement: focused,
    copied: null as string | null,
    createElement(): unknown {
      if (opts.createThrows) throw new Error('no dom');
      return new FakeTextarea();
    },
    execCommand(cmd: string): boolean {
      assert.equal(cmd, 'copy');
      const area = body.children[0] as FakeTextarea | undefined;
      assert.ok(area && area.selected, 'the text must be selected before copying');
      if (opts.exec instanceof Error) throw opts.exec;
      if (opts.exec === false) return false;
      doc.copied = area.value;
      return true;
    },
  };
  return { doc: doc as unknown as DocumentLike, raw: doc, body, focused };
}

const permissionError = () => Object.assign(new Error('denied'), { name: 'NotAllowedError' });

describe('clipboard API available', () => {
  it('writes the exact text and reports success', async () => {
    let written = '';
    const env: ClipboardEnv = { clipboard: { writeText: async (t) => { written = t; } } };
    const r = await copyText('report text', env);
    assert.deepEqual(r, { ok: true, method: 'clipboard-api' });
    assert.equal(written, 'report text');
  });

  it('falls back to selection-copy when the API is refused, and then succeeds', async () => {
    const { doc, raw, body, focused } = fakeDocument();
    const env: ClipboardEnv = { clipboard: { writeText: async () => { throw permissionError(); } }, document: doc };
    const r = await copyText('abc', env);
    assert.deepEqual(r, { ok: true, method: 'selection' });
    assert.equal(raw.copied, 'abc');
    assert.equal(body.children.length, 0, 'the temporary textarea must be removed');
    assert.equal(focused.focusCalls, 1, 'focus goes back where it was');
  });

  it('reports a permission failure with manual-copy advice when nothing else works', async () => {
    const env: ClipboardEnv = { clipboard: { writeText: async () => { throw permissionError(); } }, document: null };
    const r = await copyText('abc', env);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'denied');
      assert.match(r.message, /blocked clipboard access/);
      assert.match(r.message, /copy it manually/);
    }
  });

  it('reports a generic failure for a non-permission error', async () => {
    const env: ClipboardEnv = { clipboard: { writeText: async () => { throw new Error('disk on fire'); } }, document: fakeDocument({ exec: false }).doc };
    const r = await copyText('abc', env);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'failed');
  });
});

describe('clipboard API missing (plain-HTTP page)', () => {
  it('uses the selection fallback', async () => {
    const { doc, raw, body } = fakeDocument();
    const r = await copyText('line1\nline2', { clipboard: undefined, document: doc });
    assert.deepEqual(r, { ok: true, method: 'selection' });
    assert.equal(raw.copied, 'line1\nline2');
    assert.equal(body.children.length, 0);
  });

  it('says what is missing when the fallback fails too', async () => {
    const { doc, body } = fakeDocument({ exec: false });
    const r = await copyText('abc', { clipboard: null, document: doc });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'unavailable');
      assert.match(r.message, /HTTPS or localhost/);
      assert.match(r.message, /copy it manually/);
    }
    assert.equal(body.children.length, 0, 'cleans up even on failure');
  });

  it('survives execCommand throwing and createElement throwing', async () => {
    const a = await copyText('abc', { document: fakeDocument({ exec: new Error('SecurityError') }).doc });
    assert.equal(a.ok, false);
    const b = await copyText('abc', { document: fakeDocument({ createThrows: true }).doc });
    assert.equal(b.ok, false);
  });

  it('reports "unavailable" when there is no clipboard and no document at all', async () => {
    const r = await copyText('abc', {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'unavailable');
  });

  it('does not touch a document that has no body', async () => {
    const doc = { ...fakeDocument().doc, body: null } as unknown as DocumentLike;
    const r = await copyText('abc', { document: doc });
    assert.equal(r.ok, false);
  });
});

describe('input checks', () => {
  it('refuses to "copy" nothing and does not call the API', async () => {
    let called = false;
    const r = await copyText('', { clipboard: { writeText: async () => { called = true; } } });
    assert.equal(called, false);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'empty');
  });
});

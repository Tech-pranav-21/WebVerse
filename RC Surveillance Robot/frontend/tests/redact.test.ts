/**
 * Redaction helpers (pure; no browser needed). What these pin down: nothing that looks like a
 * credential survives into stored history or into the copyable report, while the camera's host
 * and path stay readable because a person debugging needs them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessage, redactText, sanitizeUrl } from '../src/services/redact';

describe('sanitizeUrl', () => {
  it('keeps scheme, host, port and path', () => {
    assert.equal(sanitizeUrl('http://192.168.1.100'), 'http://192.168.1.100');
    assert.equal(sanitizeUrl('http://192.168.1.100:81/stream'), 'http://192.168.1.100:81/stream');
  });

  it('removes credentials, query string and fragment', () => {
    assert.equal(
      sanitizeUrl('http://admin:hunter2@192.168.1.100:81/stream?token=abc123&x=1#frag'),
      'http://192.168.1.100:81/stream',
    );
    assert.ok(!sanitizeUrl('http://admin:hunter2@cam.local/').includes('hunter2'));
    assert.ok(!sanitizeUrl('http://admin:hunter2@cam.local/').includes('admin'));
  });

  it('accepts a bare host without inventing a scheme and still drops credentials', () => {
    assert.equal(sanitizeUrl('192.168.1.100'), '192.168.1.100');
    assert.equal(sanitizeUrl('192.168.1.100:8080/x'), '192.168.1.100:8080/x');
    assert.equal(sanitizeUrl('admin:pw@192.168.1.100'), '192.168.1.100');
  });

  it('returns an empty string for empty input and never throws on garbage', () => {
    assert.equal(sanitizeUrl(''), '');
    assert.equal(sanitizeUrl(null), '');
    assert.equal(sanitizeUrl(undefined), '');
    assert.doesNotThrow(() => sanitizeUrl('http://[bad'));
    assert.ok(!sanitizeUrl('http://[bad?password=hunter2').includes('hunter2'));
  });
});

describe('redactText', () => {
  it('cleans URLs embedded in a message', () => {
    const out = redactText('Failed to load http://u:p@10.0.0.5:81/stream?key=SECRET1 right now');
    assert.equal(out, 'Failed to load http://10.0.0.5:81/stream right now');
  });

  it('masks password/token style pairs', () => {
    assert.match(redactText('login failed password=hunter2 for user'), /password=\[redacted\] for user/);
    assert.ok(!redactText('token: abcdef123456').includes('abcdef'));
    assert.ok(!redactText('api_key=XYZ789').includes('XYZ789'));
    assert.ok(!redactText('Authorization: Bearer abc.def.ghi').includes('abc.def'));
  });

  it('masks bearer tokens and bare user:password@host', () => {
    assert.ok(!redactText('sent Bearer eyJhbGciOi.payload.sig').includes('eyJhbGciOi'));
    assert.ok(!redactText('connect admin:hunter2@192.168.1.5 failed').includes('hunter2'));
  });

  it('leaves ordinary diagnostic text alone', () => {
    const text = 'No frame received within 8s of opening the stream.';
    assert.equal(redactText(text), text);
    assert.equal(redactText(''), '');
    assert.equal(redactText(null), '');
  });
});

describe('cleanMessage', () => {
  it('collapses whitespace and caps the length', () => {
    assert.equal(cleanMessage('a \n  b\t c'), 'a b c');
    const long = cleanMessage('x'.repeat(1000), 50);
    assert.equal(long.length, 50);
    assert.ok(long.endsWith('…'));
  });
});

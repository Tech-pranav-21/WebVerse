/**
 * The Groq API key must never reach the browser. These tests read the project's own files: they
 * cannot prove a deployed bundle is clean (check `dist/` after a build, see the README), but they
 * stop the usual mistakes (a VITE_ variable, a hardcoded key, the server's variable name in client
 * code) from being committed unnoticed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|html|css|json)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => path.slice(ROOT.length + 1).replace(/\\/g, '/');

describe('the Groq API key stays on the server', () => {
  const clientFiles = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html')].filter((f) => existsSync(f));

  it('the browser code never mentions the key variable and contains no Groq-style key', () => {
    assert.ok(clientFiles.length > 20, 'the scan found the client files');
    for (const file of clientFiles) {
      const text = read(file);
      assert.ok(!/GROQ_API_KEY/.test(text), `${rel(file)} must not mention GROQ_API_KEY`);
      assert.ok(!/gsk_[A-Za-z0-9]{8,}/.test(text), `${rel(file)} must not contain a Groq key`);
      assert.ok(!/api\.groq\.com/.test(text), `${rel(file)} must not call Groq directly`);
    }
  });

  it('no VITE_ variable carries the key (only VITE_ variables are exposed to the browser)', () => {
    for (const file of [...clientFiles, join(ROOT, '.env.example'), join(ROOT, 'vite.config.ts'), join(ROOT, 'package.json')]) {
      if (!existsSync(file)) continue;
      assert.ok(!/VITE_[A-Z_]*GROQ/i.test(read(file)), `${rel(file)} must not define a VITE_ Groq variable`);
    }
  });

  it('the server side reads the key from GROQ_API_KEY and the browser talks to the local API only', () => {
    assert.match(read(join(ROOT, 'server', 'config.ts')), /env\.GROQ_API_KEY/);
    const client = read(join(ROOT, 'src', 'services', 'aiClient.ts'));
    assert.match(client, /\/api\/ai\//, 'the browser calls the local backend');
  });

  it('.env.example documents GROQ_API_KEY with a placeholder only, and .env files are git-ignored', () => {
    const example = read(join(ROOT, '.env.example'));
    assert.match(example, /^GROQ_API_KEY=\s*$/m, 'the key line is empty');
    assert.ok(!/gsk_/.test(example));
    const ignore = read(join(ROOT, '.gitignore'));
    assert.match(ignore, /^\.env\*$/m);
    assert.match(ignore, /^!\.env\.example$/m);
  });

  it('no file in the project (other than tests, which use an obvious fake) holds something shaped like a real key', () => {
    const files = [...walk(ROOT)].filter((f) => !rel(f).startsWith('tests/') && !rel(f).startsWith('docs/') && !rel(f).startsWith('.test-build/') && !rel(f).startsWith('server/dist/'));
    for (const file of files) {
      assert.ok(!/gsk_[A-Za-z0-9]{20,}/.test(read(file)), `${rel(file)} looks like it contains a Groq key`);
    }
  });
});

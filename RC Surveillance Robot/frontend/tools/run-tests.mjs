/**
 * Dependency-free test runner.
 *
 * The project is "type": "module" and its sources use extension-less imports (as Vite allows), which
 * Node's ESM loader cannot resolve. So: compile services + tests to CommonJS with the TypeScript
 * compiler that is already a devDependency, then run the compiled files with Node's built-in
 * test runner (`node:test`). No new packages are needed.
 *
 *   npm test            compile + run
 *   npm run test:types  type-check the tests only (no emit)
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.test-build');
const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

const typecheckOnly = process.argv.includes('--typecheck');

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n${label} failed (exit code ${result.status ?? 'none'}).`);
    process.exit(result.status ?? 1);
  }
}

if (typecheckOnly) {
  run([tscBin, '-p', 'tsconfig.test.json', '--noEmit'], 'Test type-check');
  process.exit(0);
}

rmSync(outDir, { recursive: true, force: true });
run([tscBin, '-p', 'tsconfig.test.json'], 'Compiling the tests');

// Compiled output is CommonJS; this nested package.json overrides the project's "type": "module".
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'package.json'), '{ "type": "commonjs" }\n');

const testsDir = join(outDir, 'tests');
const files = existsSync(testsDir)
  ? readdirSync(testsDir).filter((f) => f.endsWith('.test.js')).sort().map((f) => join(testsDir, f))
  : [];
if (files.length === 0) {
  console.error('No compiled test files found.');
  process.exit(1);
}

run(['--test', ...files], 'Tests');

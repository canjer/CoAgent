import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.env.COAGENT_TEST_ROOT ?? process.cwd();
test('project includes runnable TypeScript scaffold', () => {
  assert.ok(existsSync(resolve(root, 'package.json')), 'package.json missing');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.ok(pkg.scripts.test);
  assert.ok(existsSync(resolve(root, 'packages/runtime-codex/src/client.ts')));
  assert.ok(existsSync(resolve(root, 'packages/model-gateway/src/server.ts')));
});
test('product design and roadmap preserved', () => {
  assert.ok(existsSync(resolve(root, 'PROJECT_DESIGN.md')));
  assert.ok(existsSync(resolve(root, 'V1_ROADMAP.md')));
});

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { codexLauncher } from '../packages/runtime-codex/src/environment.js';

async function files(dir: string): Promise<string[]> {
  const output: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}
const root = resolve('.');
const pkg = JSON.parse(await readFile(join(root, 'node_modules/@openai/codex/package.json'), 'utf8'));
const expected = JSON.parse(await readFile('package.json', 'utf8')).dependencies['@openai/codex'];
if (pkg.version !== expected) throw new Error('Installed Codex does not match pinned dependency');
const platformPackage = `@openai/codex-${process.platform}-${process.arch}`;
const binary = (await files(resolve('node_modules', platformPackage))).find(path => /[\\/]codex(?:\.exe)?$/.test(path));
if (!binary) throw new Error('Pinned native Codex binary is missing');
const home = await mkdtemp(join(tmpdir(), 'coagent-schema-'));
try {
  const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: 'C', LC_ALL: 'C' };
  const version = execFileSync(process.execPath, [codexLauncher, '--version'], { env, encoding: 'utf8' }).trim();
  const generated = resolve('packages/runtime-codex/src/generated');
  await mkdir(generated, { recursive: true });
  execFileSync(process.execPath, [codexLauncher, 'app-server', 'generate-ts', '--out', generated], { env, stdio: 'pipe' });
  const paths = (await files(generated)).sort();
  const schemaHash = createHash('sha256');
  for (const path of paths) {
    const raw = await readFile(path, 'utf8');
    // Mechanical ESM normalization; preserves upstream generated type definitions.
    const normalized = raw.replace(/from "(\.[^"]+)"/g, (_match, specifier: string) => `from "${specifier.endsWith('.js') ? specifier : existsSync(resolve(dirname(path), specifier, 'index.ts')) ? specifier + '/index.js' : specifier + '.js'}"`);
    await writeFile(path, normalized);
    schemaHash.update(path.slice(generated.length)).update(normalized);
  }
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const baseline = {
    codexVersion: pkg.version, versionOutput: version, package: '@openai/codex',
    repository: pkg.repository.url, license: pkg.license,
    platform: process.platform, arch: process.arch,
    nativeBinary: binary.slice(root.length + 1),
    nativeSha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
    npmIntegrity: lock.packages['node_modules/@openai/codex'].integrity,
    nativeNpmIntegrity: lock.packages[`node_modules/${platformPackage}`].integrity,
    generatedFiles: paths.length, generatedSha256: schemaHash.digest('hex'),
    generator: 'codex app-server generate-ts; normalize relative type import suffixes to .js',
    node: process.version,
  };
  await mkdir('docs', { recursive: true });
  await writeFile('docs/runtime-baseline.json', JSON.stringify(baseline, null, 2) + '\n');
  console.log(JSON.stringify(baseline, null, 2));
} finally { await rm(home, { recursive: true, force: true }); }

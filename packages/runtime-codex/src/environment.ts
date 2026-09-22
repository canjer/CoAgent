import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const codexLauncher = resolve('node_modules/@openai/codex/bin/codex.js');

export async function isolatedEnvironment(baseUrl: string, token: string, model = 'coagent-test') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'coagent-s0-')));
  const cwd = join(root, 'workspace');
  const home = join(root, 'home');
  const codexHome = join(root, 'codex-home');
  await Promise.all([cwd, home, codexHome].map(dir => mkdir(dir, { mode: 0o700 })));
  const tokenPath = join(codexHome, 'gateway-token');
  await writeFile(tokenPath, token, { mode: 0o600 });
  const config = [
    `model = ${JSON.stringify(model)}`,
    'model_provider = "coagent_gateway"',
    'model_supports_reasoning_summaries = false',
    'web_search = "disabled"',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    '[sandbox_workspace_write]',
    'network_access = false',
    '[shell_environment_policy]',
    'inherit = "none"',
    `set = { PATH = ${JSON.stringify(dirname(process.execPath) + ':/usr/bin:/bin:/usr/sbin:/sbin')}, HOME = ${JSON.stringify(home)} }`,
    '[model_providers.coagent_gateway]',
    'name = "coAgent isolated test"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    'wire_api = "responses"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    'stream_idle_timeout_ms = 15000',
    '[model_providers.coagent_gateway.auth]',
    `command = ${JSON.stringify(process.execPath)}`,
    `args = ${JSON.stringify(['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))', tokenPath])}`,
    '[features]',
    'multi_agent = false',
    'goals = false',
    'plugins = false',
    'apps = false',
    'skill_mcp_dependency_install = false',
    '[analytics]',
    'enabled = false',
    '[feedback]',
    'enabled = false',
  ].join('\n') + '\n';
  await writeFile(join(codexHome, 'config.toml'), config, { mode: 0o600 });
  return {
    root, cwd, codexHome,
    env: {
      PATH: dirname(process.execPath) + ':/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: home, CODEX_HOME: codexHome, TMPDIR: root,
      LANG: 'C', LC_ALL: 'C', NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
    } satisfies NodeJS.ProcessEnv,
    async cleanup() { await rm(root, { recursive: true, force: true, maxRetries:10, retryDelay:100 }); },
  };
}

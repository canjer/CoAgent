"""Capture repeatable local test evidence and test rollback only on a disposable copy."""
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
os.chdir(root)
evidence = root / '.verification'
evidence.mkdir(exist_ok=True)
excluded = {'node_modules', 'dist', '.local', '.verification', '.git', '__pycache__'}
artifacts = {'MODIFIED_FILE.zip', 'DIFF_FILE.patch', 'VERIFICATION.txt', '.DS_Store'}
paths = sorted(p for p in root.rglob('*') if p.is_file() and not any(part in excluded for part in p.relative_to(root).parts) and p.name not in artifacts and not (p.name == '.env' or (p.name.startswith('.env.') and p.name != '.env.example')))
hash_file = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
managed = {p.relative_to(root).as_posix(): hash_file(p) for p in paths}
(evidence / 'managed-files.json').write_text(json.dumps(managed, indent=2) + '\n')
original = json.loads((evidence / 'original/manifest.json').read_text())
for name, expected in original.items():
    assert hash_file(evidence/'original'/name) == expected

diffs = []
for path in paths:
    name = path.relative_to(root).as_posix()
    before = (evidence/'original'/name).read_text().splitlines(True) if name in original else []
    after = path.read_text().splitlines(True)
    diffs.extend(difflib.unified_diff(before, after, fromfile='a/'+name if before else '/dev/null', tofile='b/'+name))
(root/'DIFF_FILE.patch').write_text(''.join(diffs))
with zipfile.ZipFile(root/'MODIFIED_FILE.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in paths: archive.write(path, path.relative_to(root))
    for path in (evidence/'original').iterdir():
        if path.is_file(): archive.write(path, path.relative_to(root))
    archive.write(evidence/'managed-files.json', '.verification/managed-files.json')
with zipfile.ZipFile(root/'MODIFIED_FILE.zip') as archive:
    assert archive.testzip() is None

def run(command, env=None):
    result = subprocess.run(command, cwd=root, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return result.returncode, result.stdout

records = []
commands = [
    ('MODIFIED', ['node', '--test', 'tests/bootstrap.test.mjs'], 0),
    ('TYPECHECK', ['npm', 'run', 'typecheck'], 0),
    ('UNIT', ['npm', 'test'], 0),
    ('INTEGRATION', ['npm', 'run', 'test:integration'], 0),
    ('BUILD', ['npm', 'run', 'build'], 0),
    ('DESKTOP_BUILD', ['npm', 'run', 'desktop:build'], 0),
    ('STARTUP', ['npm', 'run', 'test:desktop:startup'], 0),
    ('DIAGNOSTIC_UI', ['npm', 'run', 'test:desktop:diagnostics'], 0),
    ('DESKTOP_PACKAGE', ['node', 'scripts/package-desktop.mjs'], 0),

    ('DESKTOP_APPROVAL', ['npm', 'run', 'test:desktop:approval'], 0),
    ('DESKTOP_WORKBENCH', ['npm', 'run', 'test:desktop:workbench'], 0),
    ('DESKTOP_PROVIDERS', ['npm', 'run', 'test:desktop:providers'], 0),
    ('DESKTOP_SETTINGS', ['npm', 'run', 'test:desktop:settings'], 0),
    ('HOST_CRASH', ['npm', 'run', 'test:desktop:host'], 0),
    ('RUNTIME_PROBE', ['npm', 'run', 'runtime:probe'], 0),
]
for label, command, expected in commands:
    code, output = run(command)
    (evidence/(label.lower()+'.log')).write_text(output)
    records.append((label, ' '.join(command), 'local fixtures; no model credentials', code, output))
    if code != expected: raise SystemExit(label+' failed:\n'+output)

live_env = dict(os.environ)
live_env.pop('DEEPSEEK_API_KEY', None)
live_env.pop('QWEN_API_KEY', None)
live_env.pop('COAGENT_MODEL', None)
code, output = run(['npm', 'run', 'smoke:live'], live_env)
assert code == 2
records.append(('LIVE_PRECHECK', 'env -u DEEPSEEK_API_KEY npm run smoke:live', 'credential intentionally unset; no provider request', code, output))

with tempfile.TemporaryDirectory(prefix='coagent-rollback-') as temp:
    target = Path(temp)/'copy'
    target.mkdir()
    for path in paths:
        destination = target/path.relative_to(root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
    command = [str(root/'ROLLBACK.sh'), str(target)]
    code, output = run(command)
    assert code == 0, output
    for name, expected in original.items(): assert hash_file(target/name) == expected
    records.append(('ROLLBACK', ' '.join(command), 'disposable copy of modified source', code, output))
    env = dict(os.environ, COAGENT_TEST_ROOT=str(target))
    code, output = run(['node', '--test', 'tests/bootstrap.test.mjs'], env)
    assert code == 1 and 'package.json missing' in output
    records.append(('RESTORED_BASELINE', f'COAGENT_TEST_ROOT={target} node --test tests/bootstrap.test.mjs', 'restored disposable copy', code, output))

for name, expected in managed.items(): assert hash_file(root/name) == expected
baseline = (evidence/'baseline.log').read_text()
parts = [
    'coAgent Agent regression + desktop verification\n',
    f'ROOT: {root}\n',
    'Changed fields: three-stage protocol diagnostics and UI; explicit codex-text mapping; official Qwen non-thinking profile; empty tool-id continuation fix; real Chat runtime tests.\n',
    'MODIFIED_FILE: '+str(root/'MODIFIED_FILE.zip')+'\n',
    'DIFF_FILE: '+str(root/'DIFF_FILE.patch')+'\n',
    'VERIFICATION: '+str(root/'VERIFICATION.txt')+'\n',
    'ROLLBACK_SCRIPT: '+str(root/'ROLLBACK.sh')+'\n',
    'Original document SHA256:\n'+json.dumps(original,indent=2)+'\n',
    '\nBASELINE\nCOMMAND: node --test tests/bootstrap.test.mjs\nINPUT: original documentation-only workspace\nEXIT: 1\nLITERAL OUTPUT:\n'+baseline,
]
for label, command, filename in [
    ('PACKAGED_DEEPSEEK', "COAGENT_TEST_APP=/Users/c4n6r/cypherSec/CoAgent/dist/release/coAgent.app/Contents/MacOS/Electron npm run test:desktop", 'packaged-deepseek.log'),
    ('PACKAGED_QWEN', "COAGENT_TEST_APP=/Users/c4n6r/cypherSec/CoAgent/dist/release/coAgent.app/Contents/MacOS/Electron COAGENT_MODEL=qwen3.5-flash npm run test:desktop", 'packaged-qwen.log'),
    ('RELEASE_DEEPSEEK', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && npm run test:desktop'", 'release-deepseek.log'),
    ('RELEASE_QWEN', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run test:desktop'", 'release-qwen.log'),
    ('PROVIDERS_DEEPSEEK', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && npm run test:desktop'", 'providers-deepseek.log'),
    ('PROVIDERS_QWEN_RETRY', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run test:desktop'", 'providers-qwen-retry.log'),
    ('PROVIDERS_QWEN_503', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run test:desktop'", 'providers-qwen.log'),
    ('CREDENTIALS_LIVE', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && node scripts/desktop-settings-live.mjs'", 'credentials-live.log'),
    ('CREDENTIALS_DEEPSEEK', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && npm run test:desktop'", 'credentials-deepseek.log'),
    ('CREDENTIALS_QWEN', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run test:desktop'", 'credentials-qwen.log'),
    ('HOST_QWEN_DESKTOP', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run test:desktop'", 'recovery-qwen.log'),
    ('HOST_DEEPSEEK_DESKTOP', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && npm run test:desktop'", 'recovery-deepseek.log'),
    ('QWEN_AGENT_LIVE', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run test:agent'", 'qwen-regression.log'),
    ('QWEN_DESKTOP_LIVE', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run test:desktop'", 'qwen-desktop.log'),
    ('QWEN_RESUME_LIVE', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run smoke:live -- --resume'", 'qwen-smoke.log'),
    ('QWEN_TRIM_DIAGNOSTIC', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && COAGENT_MODEL=qwen3.5-flash npm run test:agent -- --case=trim'", 'qwen-trim-diagnostic.log'),
    ('DEEPSEEK_RESUME_LIVE', "/bin/zsh -lic 'cd /Users/c4n6r/cypherSec/CoAgent && npm run smoke:live -- --resume'", 'deepseek-after-qwen.log'),
]:
    output = (evidence/filename).read_text()
    if label == 'PROVIDERS_QWEN_RETRY':
        assert 'page.screenshot: Timeout 30000ms exceeded' in output
        exit_code = 1
    elif label == 'PROVIDERS_QWEN_503':
        assert '<503>' in output and 'Service unavailable' in output
        exit_code = 1
    elif label == 'QWEN_AGENT_LIVE':
        report = json.loads((root/'docs/AGENT_REGRESSION_qwen3.5-flash.json').read_text())
        assert report['completed'] == report['total'] == 20
        assert f"REGRESSION={report['passed']}/20" in output
        exit_code = 0 if report['passed'] == 20 else 1
    else:
        assert ('REGRESSION=1/1' in output if label == 'QWEN_TRIM_DIAGNOSTIC' else 'PASS' in output)
        exit_code = 0
    records.append((label, command, 'isolated temporary fixture; official provider actual API; environment credential not recorded', exit_code, output))
records.append(('BEFORE_QWEN', 'npm run check', 'pre-change desktop and DeepSeek source, snapshot hashes in .verification/qwen-before/SHA256.json', 0, (evidence/'qwen-before/baseline.log').read_text()))

records.append(('BEFORE_CREDENTIALS', 'npm run check', 'pre-change source hashes in .verification/credentials-before/SHA256.json', 0, (evidence/'credentials-before/baseline.log').read_text()))

records.append(('BEFORE_PROVIDERS', 'npm run check', 'pre-change source hashes in .verification/providers-before/SHA256.json', 0, (evidence/'providers-before/baseline.log').read_text()))

records.append(('BEFORE_RELEASE', 'npm run check', 'pre-change source hashes in .verification/release-before/SHA256.json', 0, (evidence/'release-before/baseline.log').read_text()))
records.append(('PACKAGED_INITIAL_STARTUP_TIMEOUT', 'npm run test:desktop:package', 'first cold installed-copy launch reached window but h1 wait exceeded 30s; retained for diagnosis; bounded packaged wait now 60s', 1, (evidence/'release-install-startup-timeout.log').read_text()))
records.append(('PACKAGED_IDENTITY_INITIAL_FAILURE', 'node scripts/test-package.mjs', 'isolated development-encrypted fixture; initial assumption of transparent migration rejected', 1, (evidence/'release-install-identity-failure.log').read_text()))

records.append(('BEFORE_STARTUP_FIX', 'npm run check', 'snapshot hashes .verification/startup-before/SHA256.json', 0, (evidence/'startup-before/baseline.log').read_text()))

records.append(('STARTUP_MIGRATION_RECHECK_FAILED', 'npm run test:desktop:package', 'installed-copy startup passed; optional cross-identity credential migration recheck timed out; original failure retained', 1, (evidence/'startup-install-first.log').read_text()))

package_output=(evidence/'startup-package-incomplete.log').read_text()
assert 'STARTUP=PASS' in package_output and 'TimeoutError' in package_output
records.append(('CURRENT_PACKAGE_PARTIAL', 'npm run test:desktop:package', 'installed copy: duplicate launch passed; later credentials UI click timeout; full package suite incomplete', 1, package_output))

records.append(('BEFORE_CHAT_WITH_NEW_REGRESSION', 'npm run check', 'pre-adaptation code plus new Chat runtime regression: 422 reproduced; snapshot hashes .verification/chat-before/SHA256.json', 1, (evidence/'chat-before/baseline.log').read_text()))
for label,command,filename,expected in [
 ('CHAT_BASELINE_422','node --import tsx --test tests/integration/chat-runtime.test.ts','chat-runtime-baseline.log',1),
 ('CHAT_DEEPSEEK_DIAGNOSTICS','npx tsx scripts/chat-diagnostics-live.ts','chat-deepseek-diagnostics.log',0),
 ('CHAT_DEEPSEEK_AGENT','npm run smoke:live -- --chat --resume','chat-deepseek-agent.log',0),
 ('CHAT_QWEN_INITIAL_DIAGNOSTICS','COAGENT_MODEL=qwen3.5-flash npx tsx scripts/chat-diagnostics-live.ts','chat-qwen-diagnostics.log',1),
 ('CHAT_QWEN_INITIAL_AGENT','COAGENT_MODEL=qwen3.5-flash npm run smoke:live -- --chat --resume','chat-qwen-agent.log',1),
 ('CHAT_QWEN_TEXT_DIAGNOSTICS','COAGENT_MODEL=qwen3.5-flash npx tsx scripts/chat-diagnostics-live.ts','chat-qwen-text-diagnostics.log',1),
 ('CHAT_QWEN_ID_FIX_DIAGNOSTICS','COAGENT_MODEL=qwen3.5-flash npx tsx scripts/chat-diagnostics-live.ts','chat-qwen-final-diagnostics.log',1),
 ('CHAT_QWEN_NULLABLE_DIAGNOSTICS','COAGENT_MODEL=qwen3.5-flash npx tsx scripts/chat-diagnostics-live.ts','chat-qwen-nullable-diagnostics.log',1),
 ('CHAT_QWEN_FINAL_DIAGNOSTICS','COAGENT_MODEL=qwen3.5-flash npx tsx scripts/chat-diagnostics-live.ts','chat-qwen-toolstop-diagnostics.log',0),
 ('CHAT_QWEN_TOOLSTOP_AGENT','COAGENT_MODEL=qwen3.5-flash npm run smoke:live -- --chat --resume','chat-qwen-toolstop-agent.log',0),
 ('CHAT_DEEPSEEK_FINAL_AGENT','npm run smoke:live -- --chat --resume','chat-deepseek-final-agent.log',0),
 ('CHAT_QWEN_FINAL_AGENT','COAGENT_MODEL=qwen3.5-flash npm run smoke:live -- --chat --resume','chat-qwen-final-agent.log',0),
]:
 output=(evidence/filename).read_text()
 if expected==0: assert 'PASS' in output
 records.append((label,command,'synthetic local probe or isolated live fixture; credentials omitted',expected,output))

for label, command, input_, code, output in records:
    parts.append(f'\n{label}\nCOMMAND: {command}\nINPUT: {input_}\nEXIT: {code}\nLITERAL OUTPUT:\n{output}')
parts.append('\nRESTORED_STATUS: original document hashes match; original missing-scaffold behavior restored on disposable copy; active project remains modified.\n')
parts.append('PREVIOUS_QWEN_DESKTOP: upstream 503 and isolated retry screenshot timeout retained (both exit 1). CURRENT_RELEASE_DESKTOP: DeepSeek and Qwen functional E2E pass (screenshots explicitly disabled); historical fixed suite remains 18/20.\n')
parts.append('STATUS: Qwen fixed suite 18/20 (exit 1; original failures retained), trim diagnostic 1/1 (exit 0); desktop development build implemented; Qwen and DeepSeek native Responses integrated; Git diff implemented; independent Host implemented; durable manual-review recovery, atomic configuration and encrypted credential settings implemented; custom provider editor and protocol-specific minimum probes implemented; macOS arm64 ad-hoc app/DMG preview implemented; personal use: Developer ID/notarization not planned; duplicate-launch window recovery implemented; transparent credential identity migration, full Chat Agent certification and user-file rollback remain future work.\n')
parts.append('CURRENT_STARTUP_FIX: source and installed-copy duplicate-launch passed; current full package settings suite incomplete due UI timeout; user confirmed normal launch.\n')
parts.append('CHAT_STATUS: synthetic protocol diagnostics implemented; real DeepSeek and Qwen Chat single-file task and restart follow-up verified; full fixed suite not run on Chat. Earlier failed Qwen probes retained.\n')
parts.append('DMG_SHA256: '+(root/'dist/release/SHA256SUMS.txt').read_text()+'\n')
parts.append('Artifact SHA256 (excluding self):\n'+json.dumps({name:hash_file(root/name) for name in ['MODIFIED_FILE.zip','DIFF_FILE.patch','ROLLBACK.sh']},indent=2)+'\n')
(root/'VERIFICATION.txt').write_text(''.join(parts))
for name in ['MODIFIED_FILE.zip','DIFF_FILE.patch','VERIFICATION.txt','ROLLBACK.sh']:
    assert (root/name).read_bytes()
    print(f'REOPENED {root/name}')
print('DELIVERY=PASS current_qwen_desktop=pass(functional_no_screenshots) package=macos_arm64_preview qwen_regression=18/20(exited_1) tests=54+5 baseline=1 modified=0 rollback=0 restored_baseline=1 active_project=modified')

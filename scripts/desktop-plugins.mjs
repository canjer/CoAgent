import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const user=await mkdtemp(join(tmpdir(),'coagent-plugin-ui-'));let app;
const env={...process.env,COAGENT_TEST_USER_DATA:user};delete env.DEEPSEEK_API_KEY;delete env.QWEN_API_KEY;
try{
 app=await electron.launch({...(process.env.COAGENT_TEST_APP?{executablePath:resolve(process.env.COAGENT_TEST_APP),args:[],cwd:tmpdir()}:{args:[resolve('dist/desktop/main.mjs')]}),env});const page=await app.firstWindow();await page.waitForSelector('h1');
 await page.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),1);
 await page.getByRole('button',{name:'新增模型服务',exact:true}).click();await page.getByLabel('服务名称',{exact:true}).fill('Personal DeepSeek');await page.getByLabel('API 类型',{exact:true}).selectOption('deepseek');await page.getByLabel('模型 ID',{exact:true}).fill('deepseek-chat');await page.getByLabel('服务 API Key',{exact:true}).fill('fixture-ui-key-not-real');await page.getByRole('button',{name:'保存服务',exact:true}).click();await page.getByText('服务配置已保存，请配置密钥后选择模型',{exact:true}).waitFor();
 const stored=JSON.parse(await readFile(join(user,'providers.json'),'utf8'));assert.equal(stored.models[0].apiStyle,'deepseek');assert.equal(stored.models[0].protocol,'chat-completions');assert.ok(!JSON.stringify(stored).includes('fixture-ui-key'));await readFile(join(user,'credentials',stored.models[0].id+'.sealed'));
 await page.getByRole('button',{name:'插件与 MCP',exact:true}).click();await page.locator('.settings-dialog').getByRole('button',{name:'浏览器',exact:true}).click();await page.getByRole('button',{name:'启用浏览器插件',exact:true}).click();await page.getByRole('button',{name:'停用浏览器插件',exact:true}).waitFor();await page.getByRole('button',{name:'插件与 MCP',exact:true}).click();
 await page.getByRole('button',{name:'添加 MCP 服务',exact:true}).click();await page.getByLabel('MCP 服务标识').fill('fixture');await page.getByLabel('MCP 命令').fill(process.execPath);await page.getByLabel('MCP 参数').fill(JSON.stringify([resolve('tests/helpers/mcp-fixture.mjs')]));await page.getByRole('button',{name:'保存 MCP 服务',exact:true}).click();await page.getByRole('button',{name:'启用 fixture',exact:true}).click();await page.getByRole('button',{name:'停用 fixture',exact:true}).waitFor();
 await mkdir('.verification',{recursive:true});await page.screenshot({path:'.verification/plugins-settings.png'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 const area=page.getByLabel('任务描述');await area.fill('First');await area.press('Shift+Enter');await area.type('Second');assert.match(await area.inputValue(),/\n/);await page.screenshot({path:'.verification/plugins-composer.png'});
 await app.close();app=await electron.launch({...(process.env.COAGENT_TEST_APP?{executablePath:resolve(process.env.COAGENT_TEST_APP),args:[],cwd:tmpdir()}:{args:[resolve('dist/desktop/main.mjs')]}),env});const next=await app.firstWindow();await next.waitForSelector('h1');await next.getByRole('button',{name:'设置',exact:true}).click();await next.getByRole('button',{name:'插件与 MCP',exact:true}).click();await next.getByRole('button',{name:'停用 fixture',exact:true}).waitFor();await next.getByRole('button',{name:'删除 fixture',exact:true}).click();await next.locator('.settings-dialog').getByRole('button',{name:'浏览器',exact:true}).click();await next.getByRole('button',{name:'停用浏览器插件',exact:true}).click();await next.getByRole('button',{name:'启用浏览器插件',exact:true}).waitFor();assert.deepEqual(JSON.parse(await readFile(join(user,'plugins.json'),'utf8')).servers,[]);
 console.log('PLUGIN_UI=PASS modal=true menus=3 model_key_url=true encrypted_key=true browser_toggle=true mcp_crud_restart=true composer_newline=true');
}finally{await app?.close();await rm(user,{recursive:true,force:true});}

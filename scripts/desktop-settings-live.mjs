import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const user=await mkdtemp(join(tmpdir(),'coagent-settings-live-'));let app;
try{app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env:{...process.env,COAGENT_TEST_USER_DATA:user}});const page=await app.firstWindow();await page.waitForSelector('h1');await page.getByRole('button',{name:'设置',exact:true}).click();for(const id of ['deepseek-chat','qwen3.5-flash']){await page.getByRole('button',{name:`测试 ${id}`,exact:true}).click();await page.getByText(new RegExp(`${id}：HTTP`)).waitFor({timeout:25000});const result=await page.getByText(new RegExp(`${id}：HTTP`)).innerText();console.log(result);assert.match(result,/HTTP 200/);}console.log('SETTINGS_LIVE=PASS official_requests=2 credentials_saved=0');}finally{await app?.close();await rm(user,{recursive:true,force:true});}

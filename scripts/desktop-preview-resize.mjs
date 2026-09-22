import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
const root=await mkdtemp(join(tmpdir(),'preview-resize-')),workspace=join(root,'project');await mkdir(workspace);await writeFile(join(workspace,'README.md'),'# Preview heading\n\n## Section\n\n- **bold** and `code`\n\n<script>window.PWNED=true</script>');
const app=await electron.launch({args:[resolve('dist/desktop/main.mjs')],env:{...process.env,COAGENT_TEST_USER_DATA:join(root,'user')}});
try{const p=await app.firstWindow();await p.waitForSelector('h1');await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);await p.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
 await p.getByRole('button',{name:'浏览器',exact:true}).click();await p.getByRole('button',{name:'关闭网页',exact:true}).click();assert.equal(await p.getByText('当前工作目录不是 Git 仓库',{exact:false}).count(),0);assert.equal(await p.locator('.diff-panel').count(),0);
 await p.getByRole('button',{name:'工作文件',exact:true}).click();await p.locator('.tree-entry').filter({hasText:'README.md'}).click();await p.getByRole('heading',{name:'Preview heading',exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.PWNED),undefined);
 await p.getByRole('button',{name:'View source',exact:true}).click();assert.match(await p.getByLabel('文件内容').innerText(),/# Preview heading/);await p.getByRole('button',{name:'预览',exact:true}).click();await p.getByLabel('筛选文件').fill('missing');assert.equal(await p.locator('.tree-entry').filter({hasText:'README.md'}).count(),0);await p.getByLabel('筛选文件').fill('');
 const before=await p.locator('.activity').boundingBox();const handle=await p.getByRole('separator').boundingBox();await p.mouse.move(handle.x+4,handle.y+150);await p.mouse.down();await p.mouse.move(handle.x-120,handle.y+150,{steps:10});await p.mouse.up();const after=await p.locator('.activity').boundingBox();assert.ok(after.width>before.width+70);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));await p.waitForTimeout(150);const width=await p.evaluate(()=>innerWidth);const box=await p.locator('.activity').boundingBox();assert.ok(box.x+box.width<=width+1);await p.screenshot({path:'.verification/preview-resize.png'});
 await p.getByRole('button',{name:'变更',exact:true}).click();await p.getByText('当前工作目录不是 Git 仓库',{exact:false}).waitFor();
 console.log('PREVIEW_RESIZE=PASS drag responsive markdown source filter inert_html git_only_on_diff');
}catch(e){console.error(await (await app.firstWindow()).locator('body').innerText());throw e;}finally{await app.close();await rm(root,{recursive:true,force:true});}

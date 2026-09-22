import assert from 'node:assert/strict';
import {_electron as electron,type ElectronApplication,type Page} from 'playwright';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {testServer,sendResponse,assistant} from '../tests/helpers/http.js';
const root=await mkdtemp(join(tmpdir(),'coagent-providers-')),user=join(root,'user'),workspace=join(root,'workspace');await mkdir(user);await mkdir(workspace);await writeFile(join(user,'settings.json'),JSON.stringify({workspace}));
let step=0,release:()=>void=()=>{},arrived:()=>void=()=>{};
const requestArrived=new Promise<void>(r=>arrived=r),gate=new Promise<void>(r=>release=r);
const seen:{path:string|undefined;model:unknown;key:boolean}[]=[];
const upstream=await testServer(async(body,req,res)=>{
 seen.push({path:req.url,model:body.model,key:req.headers.authorization==='Bearer fixture-custom-key'});
 if(body.stream===false){assert.equal(body.model,'fixture/model');assert.equal(req.headers.authorization,'Bearer fixture-custom-key');assert.ok(req.url==='/v1/responses'||(req.url==='/v1/chat/completions'&&Array.isArray(body.messages)));res.writeHead(200,{'content-type':'application/json'});res.end('{}');return;}
 assert.equal(body.model,'fixture/model');assert.equal(req.url,'/v1/responses');assert.equal(req.headers.authorization,'Bearer fixture-custom-key');
 if(step++===0){arrived();await gate;sendResponse(res,{type:'function_call',id:'fc_custom',call_id:'call_custom',name:'exec_command',arguments:JSON.stringify({cmd:"printf 'CUSTOM_OK\\n' > custom-proof.txt; test -z \"$(env | grep '^COAGENT_KEY_')\" && cat custom-proof.txt"}),status:'completed'});}
 else{assert.match(JSON.stringify(body.input),/CUSTOM_OK/);sendResponse(res,assistant('CUSTOM_OK'));}
});
let app:ElectronApplication|undefined;
async function launch(){const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>typeof e[1]==='string'));Object.assign(env,{DEEPSEEK_API_KEY:'fixture-builtin-key',QWEN_API_KEY:'',COAGENT_TEST_USER_DATA:user});delete env.COAGENT_MODEL;delete env.COAGENT_TEST_BASE_URL;app=await electron.launch({...process.env.COAGENT_TEST_APP?{executablePath:resolve(process.env.COAGENT_TEST_APP),args:[],cwd:tmpdir()}:{args:[resolve('dist/desktop/main.mjs')]},env});const page=await app.firstWindow();await page.waitForSelector('h1',{timeout:process.env.COAGENT_TEST_APP?60000:30000});await page.evaluate(()=>(window as any).coagent.call('list'));return page;}
async function selected(page:Page,id:string){for(let n=0;n<200;n++){const state=await page.evaluate(()=>(window as any).coagent.call('state'));if(state.model===id&&!state.configurationBusy)return;await new Promise(r=>setTimeout(r,50));}throw new Error('Model selection did not settle');}
async function settings(page:Page){await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('deepseek-chat API Key').waitFor();}
async function create(page:Page,label:string,protocol:string){await page.getByRole('button',{name:'新增模型服务',exact:true}).click();await page.getByLabel('服务名称',{exact:true}).fill(label);await page.getByLabel('Base URL',{exact:true}).fill(upstream.baseUrl);await page.getByLabel('模型 ID',{exact:true}).fill('fixture/model');await page.getByLabel('服务协议',{exact:true}).selectOption(protocol);await page.getByRole('button',{name:'保存服务',exact:true}).click();await page.getByText('服务配置已保存，请配置密钥后选择模型',{exact:true}).waitFor();await page.getByLabel(label+' API Key').fill('fixture-custom-key');await page.getByRole('button',{name:'保存 '+label,exact:true}).click();await page.getByText('凭据已加密保存',{exact:true}).waitFor();}
try{
 let page=await launch();await settings(page);await create(page,'Fixture Responses','responses');
 const profile=await page.evaluate(async()=> (await (window as any).coagent.call('credentials:status')).models.find((m:any)=>m.custom));
 await page.getByRole('button',{name:'测试 Fixture Responses',exact:true}).click();await page.getByText(new RegExp(profile.id+'：HTTP 200')).waitFor();
 await assert.rejects(page.evaluate(p=>(window as any).coagent.call('providers:save',{...p,baseUrl:'https://other.example/v1'}),profile),/先删除/);
 await page.getByRole('button',{name:'编辑服务 Fixture Responses',exact:true}).click();await page.getByLabel('服务名称',{exact:true}).fill('Renamed Responses');await page.getByRole('button',{name:'保存服务',exact:true}).click();await page.getByText('服务配置已保存，请配置密钥后选择模型',{exact:true}).waitFor();
 await create(page,'Fixture Chat','chat-completions');await page.getByRole('button',{name:'测试 Fixture Chat',exact:true}).click();await page.getByText(/HTTP 200/).waitFor();assert.ok(seen.some(r=>r.path==='/v1/chat/completions'));
 await page.screenshot({path:'.verification/desktop-providers.png'});
 await page.getByRole('button',{name:'删除服务 Fixture Chat',exact:true}).click();await page.getByRole('button',{name:'确认删除服务',exact:true}).click();await page.getByText('服务与本机凭据已删除',{exact:true}).waitFor();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByLabel('模型',{exact:true}).selectOption(profile.id);await selected(page,profile.id);
 await page.evaluate(()=>(window as any).coagent.call('list'));
 await assert.rejects(page.evaluate(id=>(window as any).coagent.call('providers:delete',{id}),profile.id),/切换/);
 await app!.close();app=undefined;page=await launch();await selected(page,profile.id);
 await page.getByLabel('任务描述').fill('Execute the local fixture.');await page.getByRole('button',{name:'开始任务 ↑'}).click();await Promise.race([requestArrived,new Promise<never>((_,reject)=>{setTimeout(()=>reject(new Error('Custom provider request timeout')),30000).unref();})]);
 await assert.rejects(page.evaluate(p=>(window as any).coagent.call('providers:save',{...p,label:'Busy edit'}),profile),/请等待/);release();
 await page.getByRole('button',{name:'开始任务 ↑'}).waitFor({timeout:30000});assert.equal(await readFile(join(workspace,'custom-proof.txt'),'utf8'),'CUSTOM_OK\n');assert.equal(await page.getByRole('alert').count(),0);
 assert.equal(JSON.parse(await readFile(join(user,'task-state.json'),'utf8')).model,profile.id);
 await page.getByLabel('模型',{exact:true}).selectOption('deepseek-chat');await selected(page,'deepseek-chat');await settings(page);await page.getByRole('button',{name:'删除 Renamed Responses',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByText('已删除本机凭据；存在环境变量时自动使用环境变量',{exact:true}).waitFor();await page.getByRole('button',{name:'编辑服务 Renamed Responses',exact:true}).click();await page.getByLabel('服务协议',{exact:true}).selectOption('chat-completions');await page.getByRole('button',{name:'保存服务',exact:true}).click();await page.getByText('服务配置已保存，请配置密钥后选择模型',{exact:true}).waitFor();assert.equal(JSON.parse(await readFile(join(user,'providers.json'),'utf8')).models[0].protocol,'chat-completions');await page.getByRole('button',{name:'删除服务 Renamed Responses',exact:true}).click();await page.getByRole('button',{name:'确认删除服务',exact:true}).click();await page.getByText('服务与本机凭据已删除',{exact:true}).waitFor();assert.equal(JSON.parse(await readFile(join(user,'providers.json'),'utf8')).models.length,0);await assert.rejects(readFile(join(user,'credentials',profile.id+'.sealed')));
 console.log('PROVIDERS=PASS CRUD=true restart=true protocols=2 routing_key_guard=true active_mutation_blocked=true custom_responses_tool_loop=true credential_isolation=true real_provider=false');
}finally{release();await app?.close();await upstream.close();await rm(root,{recursive:true,force:true});}

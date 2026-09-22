import {SecurityService} from './security/service.mjs';
import {CommandApprovalScope,commandApprovalKey,proposedCommandPrefix} from './command-approvals.mjs';
import {browserInstructions as baseBrowserInstructions,browserRiskInstructions} from './browser-policy.mjs';
import {TaskPrefixRules} from './task-prefix-rules.mjs';
import {commandRiskInstructions} from './command-policy.mjs';
const browserInstructions=baseBrowserInstructions+'\n'+browserRiskInstructions+'\n'+commandRiskInstructions;
import {PluginRegistry,mcpConfig} from './plugins.mjs';
import {ProjectRegistry} from './projects.mjs';
import {ProviderRegistry} from './providers.mjs';
import {JsonStore,settingsSchema} from './storage.mjs';
import {RecoveryJournal} from './recovery.mjs';
import { providerFor } from '../../packages/model-gateway/src/profiles.ts';
import { workspaceDiff } from './diff.mjs';
import { listFiles, previewFile } from './files.mjs';

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexClient } from '../../packages/runtime-codex/src/client.ts';
import { CodexRuntime } from '../../packages/runtime-codex/src/runtime.ts';
import { isolatedEnvironment } from '../../packages/runtime-codex/src/environment.ts';
import { startGateway } from '../../packages/model-gateway/src/server.ts';
const userData=process.argv[2];
const providers=new ProviderRegistry(userData);
const security=new SecurityService(userData);
const plugins=new PluginRegistry(userData);
const projects=new ProjectRegistry(userData);
const settings=new JsonStore(join(userData,'settings.json'),settingsSchema,{version:1,workspace:'',model:'deepseek-chat'});
const journal=new RecoveryJournal(join(userData,'task-state.json'));
let persistenceError=null;
function recoveryState(){return {recovery:journal.value,storageWarning:[settings.warning,providers.store.warning].filter(Boolean).join('; '),persistenceError};}
function persistError(){persistenceError='执行记录保存失败，请核对文件与历史后重新启动';publish('recovery/state',recoveryState());}
let selectedModel=process.env.COAGENT_MODEL||'deepseek-chat', switching=false;
let browserSockets;
let client,runtime,gateway,isolated,workspace='',active=null,starting=false,stopRequested=false;
const completedTurns=new Set();
const interruptedTurns=new Set();
async function stopActive(){
 const turn=active;if(!turn||interruptedTurns.has(turn.turnId))return;
 interruptedTurns.add(turn.turnId);
 try{
  for(let attempt=0;attempt<10;attempt++){
   if(completedTurns.has(turn.turnId))return;
   try{await runtime.interruptTurn(turn.threadId,turn.turnId);return;}
   catch(error){
    // app-server may acknowledge turn/start before registering the active turn.
    if(error.message!=='no active turn to interrupt'||attempt===9)throw error;
    await new Promise(resolve=>setTimeout(resolve,100));
   }
  }
 }catch(error){if(!completedTurns.has(turn.turnId)){interruptedTurns.delete(turn.turnId);throw error;}}
}
const taskPrefixRules=new TaskPrefixRules(join(userData,'runtime'));
let prefixGranted=false;
const commandScope=new CommandApprovalScope();const approvals=new Map(); const sessions=new Set();
const publish=(method,params)=>process.parentPort.postMessage({event:{method,params}});
let disconnecting=null;
async function disconnect(){
 prefixGranted=false;commandScope.clear();
 if(disconnecting)return disconnecting;
 const oldClient=client,oldGateway=gateway,oldIsolated=isolated,oldSockets=browserSockets;browserSockets=null;
 client=null;runtime=null;gateway=null;isolated=null;
 disconnecting=(async()=>{
  try{await oldClient?.close();await taskPrefixRules.restore();process.parentPort.postMessage({runtimePid:null});}finally{try{await oldGateway?.close();}finally{await oldIsolated?.cleanup();if(oldSockets)await rm(oldSockets,{recursive:true,force:true,maxRetries:10,retryDelay:100});}}
 })().finally(()=>{disconnecting=null;});
 await disconnecting;
}
let connecting=null;
async function connect(){
 if(switching)throw new Error('模型切换中，请稍后重试');
 if(runtime)return;
 if(!connecting)connecting=openRuntime().finally(()=>{connecting=null;});
 await connecting;
}
async function openRuntime(){
 if(runtime)return;
 if(client||disconnecting)await disconnect();
 await taskPrefixRules.restore();
 const profile=providers.get(selectedModel);const provider=providerFor(profile);
 if(process.env.COAGENT_TEST_BASE_URL)provider.baseUrl=process.env.COAGENT_TEST_BASE_URL;
 const token=randomBytes(32).toString('hex');
 gateway=await startGateway({token,timeoutMs:90000,provider});
 isolated=await isolatedEnvironment(gateway.baseUrl,token,selectedModel);
 const home=join(userData,'runtime');await mkdir(home,{recursive:true,mode:0o700});
 await writeFile(join(home,'gateway-token'),token,{mode:0o600});
 let config=await readFile(join(isolated.codexHome,'config.toml'),'utf8');
 config=config.replace(/command = .*\nargs = .*\n/,`command = "/bin/cat"\nargs = ${JSON.stringify([join(home,'gateway-token')])}\n`);
 browserSockets=await mkdtemp('/tmp/coagent-b-');
 config+='\n'+mcpConfig(await plugins.read(),{browserUrl:process.env.COAGENT_BROWSER_URL,socketDir:browserSockets,executable:process.execPath,cli:join(dirname(fileURLToPath(import.meta.url)),'browser-mcp/node_modules/@playwright/mcp/cli.js')});
 await writeFile(join(home,'config.toml'),config,{mode:0o600});
 const binary=join(dirname(fileURLToPath(import.meta.url)),'runtime/bin/codex');
 client=new CodexClient({command:binary,args:['app-server'],cwd:workspace,env:{...isolated.env,CODEX_HOME:home,...(process.env.COAGENT_BROWSER_TOKEN?{COAGENT_BROWSER_TOKEN:process.env.COAGENT_BROWSER_TOKEN}:{})}});
 client.on('notification',m=>{
  if(m.method==='turn/started')active={threadId:m.params.threadId,turnId:m.params.turn.id};
  if(m.method==='turn/completed'){
   completedTurns.add(m.params.turn.id);active=null;approvals.clear();commandScope.clear();
   void journal.finish(m.params.threadId,m.params.turn.id,m.params.turn.status).then(()=>{publish(m.method,m.params);publish('recovery/state',recoveryState());}).catch(()=>{persistError();publish(m.method,m.params);});return;
  }
  publish(m.method,m.params);
 });
 const connection=client;
 client.on('closed',()=>{if(client!==connection)return;runtime=null;active=null;approvals.clear();commandScope.clear();void journal.uncertain().then(()=>publish('recovery/state',recoveryState())).catch(persistError);if(!switching)publish('connection/closed',{});});
 client.on('serverRequest',m=>{
  if(!stopRequested&&active&&m.params?.threadId===active.threadId&&m.params?.turnId===active.turnId&&commandScope.matches(m)){
   client.respond(m.id,{decision:'accept'});publish('command/auto-approved',{threadId:active.threadId,turnId:active.turnId});return;
  }
  if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(m.method)){approvals.set(m.id,m);publish('approval',{id:m.id,method:m.method,...m.params,commandSimilarAvailable:!!commandApprovalKey(m),commandPrefix:proposedCommandPrefix(m)});}
  else if(m.method==='mcpServer/elicitation/request'&&m.params?._meta?.codex_approval_kind==='mcp_tool_call'){approvals.set(m.id,m);publish('approval',{id:m.id,method:m.method,...m.params,reason:m.params.message});}
  else if(m.method==='mcpServer/elicitation/request')client.respond(m.id,{action:'decline',content:null,_meta:null});
  else client.respond(m.id,m.method==='item/tool/requestUserInput'?{answers:{}}:{decision:'decline'});
 });
 process.parentPort.postMessage({runtimePid:client.pid});
 await client.initialize();runtime=new CodexRuntime(client);
}
function text(value,max=20000){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('输入格式错误');return value;}
async function dispatch(method,args={}){
 switch(method){
 case 'security:config':return security.config(workspace);
 case 'security:save':if(active||starting)throw new Error('请先停止当前 Agent 任务');return security.save(workspace,args);
 case 'security:state':return security.state(workspace);
 case 'security:start':if(active||starting||switching)throw new Error('请先停止当前 Agent 任务');return security.start(workspace,args);
 case 'security:stop':return security.stop();
 case 'plugins:status':return {config:await plugins.read(),warning:plugins.store.warning};
 case 'plugins:save':{
  if(active||starting||connecting||switching)throw new Error('请等待当前任务或连接完成');
  switching=true;try{await disconnect();return {config:await plugins.save(args),warning:plugins.store.warning};}finally{switching=false;}
 }
 case 'plugins:discover':{
  if(active||starting||switching)throw new Error('请等待当前任务完成');
  await connect();const result=await client.request('mcpServerStatus/list',{limit:100});
  return result.data.map(s=>({name:s.name,status:s.runtimeStatus,tools:Object.keys(s.tools),error:s.toolsError?'工具发现失败，请检查服务配置':null}));
 }
 case 'credentials:pause':if(active||starting||connecting||switching)throw new Error('请等待当前任务或连接完成');switching=true;try{await disconnect();return true;}catch(error){switching=false;throw error;}
 case 'credentials:apply':try{const old=providers.all();await providers.init();for(const p of old)delete process.env[p.apiKeyEnv];for(const p of providers.all()){const key=p.apiKeyEnv;if(typeof args.env?.[key]==='string'&&args.env[key])process.env[key]=args.env[key];else delete process.env[key];}return true;}finally{switching=false;}
 case 'shutdown':await security.stop();await connecting;await disconnect();await journal.uncertain();await journal.tail;return true;
 case 'recovery:ack':if(active||starting)throw new Error('任务尚未结束');await journal.acknowledge(text(args.id));publish('recovery/state',recoveryState());return recoveryState();
 case 'recovery:history':{if(!journal.value.threadId)return null;await connect();return (await runtime.readSession(journal.value.threadId)).thread;}
 case 'files':if(!workspace)throw new Error('请先选择工作目录');return listFiles(workspace,args.path??'');
 case 'preview':if(!workspace)throw new Error('请先选择工作目录');return previewFile(workspace,text(args.path,4096));
 case 'diff':if(!workspace)throw new Error('请先选择工作目录');return workspaceDiff(workspace,args.staged===true);
 case 'projects:list':{
  const result=[];
  for(const project of projects.list()){
   let tasks=[];if(workspace&&process.env[providers.get(selectedModel).apiKeyEnv]){await connect();const list=await runtime.listSessions(project.path);tasks=list.data;for(const t of tasks)sessions.add(t.id);}
   result.push({...project,selected:project.path===workspace,tasks});
  }
  return result;
 }
 case 'project:select':{
  if(security.active||security.pending)throw new Error('请先停止安全测试');
  if(active||starting||switching)throw new Error('请先停止当前任务');
  const nextWorkspace=text(args.path,4096);if(!projects.list().some(p=>p.path===nextWorkspace))throw new Error('项目不存在');
  await projects.touch(nextWorkspace);await settings.write({workspace:nextWorkspace,model:selectedModel});workspace=nextWorkspace;return workspace;
 }
 case 'state':return {...recoveryState(),configurationBusy:!!(switching||connecting||starting),hostPid:process.pid,workspace,model:selectedModel,models:providers.all().map(p=>({id:p.id,label:p.label,keyConfigured:!!process.env[p.apiKeyEnv]}))};
 case 'model':{
  if(active||starting||connecting||switching)throw new Error('请等待当前任务或连接完成');
  const profile=providers.get(text(args.id));providerFor(profile);
  switching=true;
  try{
   await disconnect();
   await settings.write({workspace,model:profile.id});selectedModel=profile.id;
   return {model:selectedModel};
  }finally{switching=false;}
 }
 case 'choose':{
  if(security.active||security.pending)throw new Error('请先停止安全测试');
  if(active||starting||switching)throw new Error('请先停止当前任务');
  const nextWorkspace=await projects.touch(text(args.path,4096));await settings.write({workspace:nextWorkspace,model:selectedModel});workspace=nextWorkspace;return workspace;
 }
 case 'list':{if(!workspace)return [];await connect();const list=await runtime.listSessions(workspace);for(const t of list.data)sessions.add(t.id);return list.data;}
 case 'history':{text(args.id);if(!sessions.has(args.id))throw new Error('会话不存在');await connect();return (await runtime.readSession(args.id)).thread;}
 case 'run':{
  if(security.active||security.pending)throw new Error('请先停止安全测试');
  await journal.tail;if(persistenceError)throw new Error(persistenceError);if(journal.blocked)throw new Error('存在待核对任务，请先核对文件与历史');
  if(active||starting||switching)throw new Error('已有任务运行中');if(!workspace)throw new Error('请先选择工作目录');text(args.prompt);
  commandScope.clear();starting=true;stopRequested=false;completedTurns.clear();interruptedTurns.clear();
  try{if(prefixGranted)await disconnect();await connect();let id=args.id;
   if(id){if(!sessions.has(id))throw new Error('会话不存在');await runtime.resumeSession(id,selectedModel,browserInstructions,workspace);}
   else {id=(await runtime.createSession({cwd:workspace,model:selectedModel,sandbox:'workspace-write',approvalPolicy:'on-request',developerInstructions:browserInstructions})).thread.id;sessions.add(id);}
   await journal.begin(workspace,selectedModel,id);
   const {turn}=await runtime.startTurn({threadId:id,input:[{type:'text',text_elements:[],text:args.prompt}]});await journal.bind(turn.id);if(!completedTurns.has(turn.id))active={threadId:id,turnId:turn.id};if(stopRequested)await stopActive();return {id};
  }catch(error){await journal.uncertain().catch(persistError);publish('recovery/state',recoveryState());throw error;}finally{starting=false;}
 }
 case 'stop':await security.stop();commandScope.clear();stopRequested=true;await stopActive();if(prefixGranted)await disconnect();return true;
 case 'approve':{let decision=args.decision;const req=approvals.get(args.id);if(!req||!['accept','decline'].includes(args.decision))throw new Error('审批已过期');if(args.scope==='task-command-similar'){
 if(args.decision!=='accept'||stopRequested||!active||req.params?.threadId!==active.threadId||req.params?.turnId!==active.turnId)throw new Error('命令审批已过期');commandScope.allow(req);
 }else if(args.scope==='task-command-prefix'){
 const prefix=proposedCommandPrefix(req);if(args.decision!=='accept'||!prefix||stopRequested||!active||req.params?.threadId!==active.threadId||req.params?.turnId!==active.turnId)throw new Error('命令前缀审批已过期');
 await taskPrefixRules.begin();if(stopRequested||!active||req.params?.turnId!==active.turnId)throw new Error('命令前缀审批已过期');
 decision={acceptWithExecpolicyAmendment:{execpolicy_amendment:prefix}};prefixGranted=true;
 }else if(args.scope&&!['once','task-browser','task-similar'].includes(args.scope))throw new Error('未知审批范围');
 if(req.method==='mcpServer/elicitation/request')client.respond(args.id,{action:args.decision==='accept'?'accept':'decline',content:args.decision==='accept'?{}:null,_meta:null});else client.respond(args.id,{decision});approvals.delete(args.id);return true;}
 default:throw new Error('Unknown operation');
 }
}
await mkdir(userData,{recursive:true});
await providers.init();
const saved=await settings.read();workspace=saved.workspace;
await projects.init(workspace);
const requested=process.env.COAGENT_MODEL||saved.model;
selectedModel=providers.all().some(p=>p.id===requested)?requested:'deepseek-chat';
if(selectedModel!==requested){await settings.write({workspace,model:selectedModel});settings.warning='原模型配置已缺失，已回退到 DeepSeek；不会重放任务';}
await journal.init();
let shuttingDown=false;
process.parentPort.on('message',async({data})=>{
 if(!data||!Number.isSafeInteger(data.id)||typeof data.method!=='string')return;
 try{
  if(shuttingDown)throw new Error('Host 正在退出');
  if(data.method==='shutdown')shuttingDown=true;
  const result=await dispatch(data.method,data.args);
  process.parentPort.postMessage({id:data.id,result});
 }catch(error){process.parentPort.postMessage({id:data.id,error:error instanceof Error?error.message:'Host error'});}
});
process.parentPort.postMessage({ready:true});

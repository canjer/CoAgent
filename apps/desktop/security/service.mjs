import {createHash,randomUUID} from 'node:crypto';import {join,resolve} from 'node:path';import {mkdir,readdir,readFile,open} from 'node:fs/promises';import {setTimeout as sleep} from 'node:timers/promises';
import {JsonStore,atomicWrite} from '../storage.mjs';import {engagementSchema,defaultEngagement,checkScope} from './scope.mjs';import {headProbe,toolRegistry} from './executor.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export class SecurityService{
 constructor(userData){this.root=join(userData,'security');this.active=null;this.pending=false;this.saving=false;this.stores=new Map();}
 directory(workspace){if(!workspace)throw new Error('请先选择项目文件夹');return join(this.root,hash(resolve(workspace)));}
 store(workspace){const path=join(this.directory(workspace),'engagement.json');if(!this.stores.has(path))this.stores.set(path,new JsonStore(path,engagementSchema,defaultEngagement()));return this.stores.get(path);}
 async config(workspace){const store=this.store(workspace);let config=await store.read();if(store.warning&&config.enabled)config=await store.write({...config,enabled:false});return {config,warning:store.warning,directory:this.directory(workspace),tools:Object.values(toolRegistry)};}
 async save(workspace,value){if(this.active||this.pending||this.saving)throw new Error('请等待安全测试或配置保存结束');this.saving=true;try{const store=this.store(workspace);const result=await store.write(value);store.warning=null;return result;}finally{this.saving=false;}}
 async state(workspace){const directory=this.directory(workspace);let names=[];try{names=await readdir(join(directory,'runs'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const runs=[];for(const name of names.sort().reverse().slice(0,30)){
  try{const path=join(directory,'runs',name,'run.json');const r=JSON.parse(await readFile(path,'utf8'));if(r.status==='running'&&this.active?.id!==r.id&&!this.pending){r.status='interrupted';r.error='Host 重启或异常退出；保留已有证据，不自动重放';await atomicWrite(path,JSON.stringify(r,null,2));}runs.push(r);}catch{runs.push({id:name,status:'unreadable',error:'运行记录读取失败，请核对证据目录'});}
 }return {running:!!this.active||this.pending,activeId:this.active?.id??null,runs};}
 async start(workspace,args,approvedDraft){
 if(this.active||this.pending||this.saving)throw new Error('已有安全测试或配置保存执行中');this.pending=true;const controller=new AbortController();this.startController=controller;
 try{
  if(args?.confirmed!==true||!Object.hasOwn(toolRegistry,args?.tool)||!Array.isArray(args?.urls)||!args.urls.length||args.urls.length>100||args.urls.some(u=>typeof u!=='string'))throw new Error('请明确确认工具、目标与预算');
  const loaded=approvedDraft?{config:engagementSchema(approvedDraft.config),warning:null}:await this.config(workspace);if(loaded.warning)throw new Error('配置从备份恢复，请核对并重新保存后执行');const config=loaded.config;if(!config.tools.includes(args.tool))throw new Error('工具未在项目中启用');
  for(const url of args.urls)checkScope(config,url);if(args.urls.length>config.budget.maxRequests)throw new Error('计划超出请求预算');
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();const dir=join(this.directory(workspace),'runs',id);await mkdir(join(dir,'evidence'),{recursive:true,mode:0o700});
  const plan={version:1,tool:toolRegistry[args.tool],urls:args.urls,config,configHash:hash(JSON.stringify(config)),workspace:resolve(workspace),confirmedAt:new Date().toISOString(),...(approvedDraft?{draftId:approvedDraft.id,objective:approvedDraft.objective,profile:approvedDraft.profile}:{})};await atomicWrite(join(dir,'plan.json'),JSON.stringify(plan,null,2));
  const state={id,status:'running',tool:args.tool,requests:0,evidenceCount:0,startedAt:plan.confirmedAt,directory:dir};await atomicWrite(join(dir,'run.json'),JSON.stringify(state,null,2));
  this.active={id,controller,state};this.active.done=this.execute(plan,state,controller).finally(()=>{if(this.active?.id===id)this.active=null;});return {id};
 }finally{this.pending=false;this.startController=null;}
 }
 async execute(plan,state,controller){
 const dir=state.directory;const signal=controller.signal;const persist=()=>atomicWrite(join(dir,'run.json'),JSON.stringify(state,null,2));
 async function event(type,data={}){const handle=await open(join(dir,'events.jsonl'),'a',0o600);try{await handle.writeFile(JSON.stringify({time:new Date().toISOString(),type,...data})+'\n');await handle.sync();}finally{await handle.close();}}
 let next=0;const timer=setTimeout(()=>controller.abort(new Error('任务时长预算耗尽')),plan.config.budget.maxDurationMs);
 try{await event('started',{tool:plan.tool.id,configHash:plan.configHash});
  for(const url of plan.urls){signal.throwIfAborted();await headProbe({url,config:plan.config,signal,
   beforeSend:async request=>{const name=String(state.requests).padStart(4,'0')+'.json';const data=JSON.stringify({time:new Date().toISOString(),runId:state.id,requestId:state.id+':'+state.requests,tool:plan.tool,...request},null,2);await atomicWrite(join(dir,'requests',name),data);await event('request-intent',{requestId:state.id+':'+state.requests,file:'requests/'+name,sha256:hash(data)});},
   reserve:async()=>{if(state.requests>=plan.config.budget.maxRequests)throw new Error('请求预算耗尽');const wait=next-Date.now();if(wait>0)await sleep(wait,undefined,{signal});signal.throwIfAborted();state.requests++;next=Date.now()+1000/plan.config.budget.requestsPerSecond;await event('request-reserved',{request:state.requests});await persist();},
   record:async value=>{const name=String(state.evidenceCount+1).padStart(4,'0')+'.json';const data=JSON.stringify({time:new Date().toISOString(),tool:plan.tool,requestId:state.id+':'+state.requests,...value},null,2);await atomicWrite(join(dir,'evidence',name),data);state.evidenceCount++;await event('evidence',{file:'evidence/'+name,sha256:hash(data)});await persist();}
  });}state.status='completed';
 }catch(error){state.status=signal.aborted?'interrupted':'failed';state.error=signal.aborted?String(signal.reason?.message||'已停止'):String(error.message).slice(0,500);}
 finally{clearTimeout(timer);state.endedAt=new Date().toISOString();try{await event(state.status,{requests:state.requests,evidenceCount:state.evidenceCount});await persist();}catch{state.status='failed';state.error='证据持久化失败，请检查磁盘';try{await persist();}catch{}}}
 }
 async stop(){this.startController?.abort(new Error('用户停止'));if(this.active){this.active.controller.abort(new Error('用户停止'));await this.active.done;}return true;}
}

import {utilityProcess} from 'electron';
export class HostClient {
 constructor(path,userData,onEvent,credentials=async()=>({})){this.credentials=credentials;this.path=path;this.userData=userData;this.onEvent=onEvent;this.pending=new Map();this.nextId=0;this.child=null;this.runtimePid=null;this.closed=false;}
 ensure(){
  if(!this.ready)this.ready=this.start().catch(error=>{this.ready=null;throw error;});
  return this.ready;
 }
 async start(){
  if(this.closed)throw new Error('应用正在退出');
  const env={};for(const key of ['PATH','HOME','TMPDIR','LANG','LC_ALL','DEEPSEEK_API_KEY','QWEN_API_KEY','COAGENT_MODEL','COAGENT_TEST_BASE_URL'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,await this.credentials());
  const child=utilityProcess.fork(this.path,[this.userData],{env,stdio:'ignore',serviceName:'coAgent Host'});this.child=child;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(new Error('Host 启动超时'));child.kill();},15000);
   child.on('message',message=>{
    if(child!==this.child)return;
    if(message.ready){clearTimeout(timer);resolve();return;}
    if(Object.hasOwn(message,'runtimePid')){this.runtimePid=message.runtimePid;return;}
    if(message.event){this.onEvent(message.event);return;}
    const pending=this.pending.get(message.id);if(!pending)return;
    clearTimeout(pending.timer);this.pending.delete(message.id);
    if(message.error)pending.reject(new Error(message.error));else pending.resolve(message.result);
   });
   child.once('exit',()=>{
    clearTimeout(timer);reject(new Error('Host 已退出'));
    if(child!==this.child)return;
    this.killRuntime();this.child=null;this.ready=null;
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Host 已退出；任务结果需核对，不会自动重放'));}this.pending.clear();
    if(!this.closed)this.onEvent({method:'connection/closed',params:{reason:'host-exit',requiresReview:true}});
   });
  });
 }
 killRuntime(){const pid=this.runtimePid;this.runtimePid=null;if(pid){try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')console.error('Runtime cleanup failed');}}}
 async call(method,args={}){
  await this.ensure();
  return new Promise((resolve,reject)=>{
   const id=++this.nextId;
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Host 请求超时；结果需核对'));this.child?.kill();},30000);
   this.pending.set(id,{resolve,reject,timer});
   try{this.child.postMessage({id,method,args});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }
 async close(){
  if(this.closed)return;
  try{if(this.child)await this.call('shutdown');}finally{this.closed=true;this.killRuntime();this.child?.kill();}
 }
}

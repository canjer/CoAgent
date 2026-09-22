import {mkdir,readFile,open,rename,rm,copyFile} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
const models={has:id=>['deepseek-chat','qwen3.5-flash'].includes(id)||(typeof id==='string'&&/^custom-[a-f0-9]{32}$/.test(id))};
export function settingsSchema(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('配置格式错误');
 if(value.version!==undefined&&value.version!==1)throw new Error('不支持的配置版本');
 if(typeof value.workspace!=='string'||value.workspace.length>4096||(value.workspace!==''&&!isAbsolute(value.workspace))||value.workspace.includes('\0'))throw new Error('工作目录格式错误');
 const model=value.model??'deepseek-chat';if(!models.has(model))throw new Error('未知模型');
 return {version:1,workspace:value.workspace,model};
}
export function taskSchema(v){
 if(!v||v.version!==1||!['idle','running','needs-review','completed','failed','interrupted','reviewed'].includes(v.status))throw new Error('任务记录格式错误');
 if(v.status==='idle')return {version:1,status:'idle'};
 for(const key of ['id','workspace','model','updatedAt'])if(typeof v[key]!=='string'||!v[key])throw new Error('任务记录字段错误');
 if(!models.has(v.model)||!isAbsolute(v.workspace))throw new Error('任务记录配置错误');
 for(const key of ['threadId','turnId'])if(v[key]!==null&&typeof v[key]!=='string')throw new Error('任务标识错误');
 return {version:1,status:v.status,id:v.id,workspace:v.workspace,model:v.model,threadId:v.threadId,turnId:v.turnId,updatedAt:v.updatedAt};
}
/** Temp file in same directory, fsync before rename. Backup is never overwritten with invalid JSON. */
export async function atomicWrite(path,data,beforeRename){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const temp=path+'.tmp-'+randomUUID();let handle;
 try{handle=await open(temp,'wx',0o600);await handle.writeFile(data);await handle.sync();await handle.close();handle=null;await beforeRename?.();await rename(temp,path);
 const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}
 }finally{await handle?.close();await rm(temp,{force:true});}
}
export class JsonStore {
 constructor(path,validate,defaults){this.path=path;this.validate=validate;this.defaults=defaults;this.tail=Promise.resolve();this.warning=null;}
 async read(){
  let primaryError;
  try{return this.validate(JSON.parse(await readFile(this.path,'utf8')));}catch(e){primaryError=e;}
  // Future versions belong to a newer application: never silently downgrade them.
  if(primaryError.message==='不支持的配置版本')throw primaryError;
  try{
   const backup=this.validate(JSON.parse(await readFile(this.path+'.bak','utf8')));
   if(primaryError.code!=='ENOENT')await copyFile(this.path,this.path+'.corrupt-'+randomUUID());
   await atomicWrite(this.path,JSON.stringify(backup,null,2)+'\n');this.warning='已从备份恢复 '+this.path.split('/').at(-1);return backup;
  }catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError)&&!['配置格式错误','工作目录格式错误','未知模型','任务记录格式错误','任务记录字段错误','任务记录配置错误','任务标识错误'].includes(e.message))throw e;}
  if(primaryError.code!=='ENOENT')throw new Error('配置或任务记录损坏且没有有效备份，请保留原文件并人工恢复');
  return this.validate(this.defaults);
 }
 write(value){
  const validated=this.validate(value);
  const next=this.tail.then(async()=>{
   let previous,raw;
   try{raw=JSON.parse(await readFile(this.path,'utf8'));previous=this.validate(raw);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(previous&&raw.version===validated.version&&JSON.stringify(previous)===JSON.stringify(validated))return validated;
   if(previous)await atomicWrite(this.path+'.bak',JSON.stringify(previous,null,2)+'\n');
   await atomicWrite(this.path,JSON.stringify(validated,null,2)+'\n');return validated;
  });this.tail=next.catch(()=>{});return next;
 }
}

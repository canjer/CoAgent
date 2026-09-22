import {readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {atomicWrite} from './storage.mjs';
/** Journal the private runtime's native rule file before a task-scoped amendment.
 * Restore only after the runtime exits, and before starting it after a crash. */
export class TaskPrefixRules {
 constructor(home){this.rule=join(home,'rules','default.rules');this.backup=join(home,'task-prefix-backup.json');this.tail=Promise.resolve();}
 enqueue(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
 begin(){return this.enqueue(()=>this.capture());}
 restore(){return this.enqueue(()=>this.recover());}
 async capture(){
  try{await readFile(this.backup);return;}catch(e){if(e.code!=='ENOENT')throw e;}
  let original=null;try{original=await readFile(this.rule,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  await atomicWrite(this.backup,JSON.stringify({version:1,original}));
 }
 async recover(){
  let saved;try{saved=JSON.parse(await readFile(this.backup,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
  if(saved.version!==1||(saved.original!==null&&typeof saved.original!=='string'))throw new Error('任务前缀备份损坏，请核对后恢复');
  if(saved.original===null)await rm(this.rule,{force:true});else await atomicWrite(this.rule,saved.original);
  await rm(this.backup,{force:true});
 }
}

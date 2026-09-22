import {randomUUID} from 'node:crypto';
import {JsonStore,taskSchema} from './storage.mjs';
export class RecoveryJournal {
 constructor(path){this.store=new JsonStore(path,taskSchema,{version:1,status:'idle'});this.value={version:1,status:'idle'};this.tail=Promise.resolve();}
 async init(){this.value=await this.store.read();if(this.store.warning&&this.value.status==='idle')throw new Error('任务备份缺少执行标识，请人工核对原记录');if(this.value.status==='running'||this.store.warning)await this.update(v=>({...v,status:'needs-review'}));return this.value;}
 update(fn){const op=this.tail.then(async()=>{const next=fn(this.value);this.value=await this.store.write(next);return this.value;});this.tail=op.catch(()=>{});return op;}
 get blocked(){return ['running','needs-review'].includes(this.value.status);}
 async begin(workspace,model,threadId){if(this.blocked)throw new Error('存在待核对任务，请先核对文件与历史');return this.update(()=>({version:1,id:randomUUID(),status:'running',workspace,model,threadId,turnId:null,updatedAt:new Date().toISOString()}));}
 async bind(turnId){return this.update(v=>v.status==='running'?{...v,turnId,updatedAt:new Date().toISOString()}:v);}
 async finish(threadId,turnId,status){return this.update(v=>v.status==='running'&&v.threadId===threadId&&(!v.turnId||v.turnId===turnId)?{...v,turnId,status:['completed','failed','interrupted'].includes(status)?status:'needs-review',updatedAt:new Date().toISOString()}:v);}
 async uncertain(){if(this.value.status==='running')return this.update(v=>v.status==='running'?{...v,status:'needs-review',updatedAt:new Date().toISOString()}:v);}
 async acknowledge(id){return this.update(v=>{if(v.status!=='needs-review'||v.id!==id)throw new Error('恢复记录已变化，请重新读取');return {...v,status:'reviewed',updatedAt:new Date().toISOString()};});}
}

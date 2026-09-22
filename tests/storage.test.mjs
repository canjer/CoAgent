import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JsonStore,settingsSchema,atomicWrite} from '../apps/desktop/storage.mjs';
import {RecoveryJournal} from '../apps/desktop/recovery.mjs';
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'coagent-state-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('settings migration, serialized writes, backup restore and preservation',()=>fixture(async dir=>{
 const path=join(dir,'settings.json');await writeFile(path,JSON.stringify({workspace:dir}));
 const store=new JsonStore(path,settingsSchema,{workspace:'',model:'deepseek-chat'});
 assert.equal((await store.read()).version,1);
 await Promise.all([store.write({workspace:dir,model:'deepseek-chat'}),store.write({workspace:dir,model:'qwen3.5-flash'})]);
 assert.equal((await store.read()).model,'qwen3.5-flash');
 await store.write({workspace:dir,model:'qwen3.5-flash'});assert.equal(JSON.parse(await readFile(path+'.bak','utf8')).model,'deepseek-chat');
 await writeFile(path,'{broken');assert.equal((await store.read()).model,'deepseek-chat');assert.match(store.warning,/备份/);
 const corrupt=(await readdir(dir)).find(n=>n.includes('.corrupt-'));assert.equal(await readFile(join(dir,corrupt),'utf8'),'{broken');
}));
test('atomic failure preserves destination; invalid/future configuration is not overwritten',()=>fixture(async dir=>{
 const path=join(dir,'settings.json');await writeFile(path,'original');
 await assert.rejects(atomicWrite(path,'changed',()=>{throw new Error('injected write failure');}));assert.equal(await readFile(path,'utf8'),'original');assert.deepEqual(await readdir(dir),['settings.json']);
 const store=new JsonStore(path,settingsSchema,{workspace:'',model:'deepseek-chat'});await assert.rejects(store.read(),/损坏/);
 await writeFile(path,JSON.stringify({version:99,workspace:dir,model:'deepseek-chat'}));await assert.rejects(store.read(),/版本/);
 assert.throws(()=>store.write({workspace:'relative',model:'qwen3.5-flash'}),/目录/);
}));
test('journal crash recovery blocks replay until matching explicit acknowledgement',()=>fixture(async dir=>{
 const path=join(dir,'task.json');const first=new RecoveryJournal(path);await first.init();await first.begin(dir,'deepseek-chat','thread');await first.bind('turn');
 const restarted=new RecoveryJournal(path);await restarted.init();assert.equal(restarted.value.status,'needs-review');assert.equal(restarted.blocked,true);
 await assert.rejects(restarted.begin(dir,'deepseek-chat','other'),/待核对/);await assert.rejects(restarted.acknowledge('wrong'),/变化/);
 await restarted.acknowledge(restarted.value.id);await restarted.begin(dir,'qwen3.5-flash','new');await restarted.finish('new','fast','completed');await restarted.bind('fast');assert.equal(restarted.value.status,'completed');
 const final=new RecoveryJournal(path);await final.init();assert.equal(final.blocked,false);assert.equal(final.value.status,'completed');
}));

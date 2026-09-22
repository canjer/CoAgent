import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectRegistry,projectsSchema} from '../apps/desktop/projects.mjs';
test('project registry groups by normalized folder and persists recency',async()=>{const dir=await mkdtemp(join(tmpdir(),'coagent-projects-'));try{const r=new ProjectRegistry(dir);await r.init();await r.add('/tmp/a');await r.add('/tmp/a/../a');await r.add('/tmp/b');assert.deepEqual(r.list().map(p=>p.path),['/tmp/b','/tmp/a']);await r.touch('/tmp/a');assert.deepEqual((await new ProjectRegistry(dir).init()).paths,['/tmp/a','/tmp/b']);}finally{await rm(dir,{recursive:true,force:true});}});
test('project registry rejects relative, duplicate-normalizes, and caps folders',()=>{assert.throws(()=>projectsSchema({version:1,paths:['relative']}));assert.deepEqual(projectsSchema({version:1,paths:['/tmp/a','/tmp/a/../a']}).paths,['/tmp/a']);assert.throws(()=>projectsSchema({version:1,paths:Array.from({length:101},(_,i)=>'/tmp/'+i)}));});

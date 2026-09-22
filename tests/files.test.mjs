import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listFiles,previewFile} from '../apps/desktop/files.mjs';
test('workspace files: browse, UTF-8 preview, traversal/symlink/binary/size limits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coagent-files-'));const workspace=join(root,'workspace');await mkdir(workspace);
 try{
 await mkdir(join(workspace,'nested'));await mkdir(join(workspace,'node_modules'));await writeFile(join(workspace,'中文.txt'),'你好\n');await writeFile(join(root,'outside.txt'),'outside');await symlink(join(root,'outside.txt'),join(workspace,'escape'));
 const listing=await listFiles(workspace);assert.deepEqual(listing.entries.map(e=>e.name),['nested','中文.txt']);
 assert.equal((await previewFile(workspace,'中文.txt')).text,'你好\n');
 for(const path of ['../outside.txt','escape',join(root,'outside.txt')])await assert.rejects(previewFile(workspace,path));
 await writeFile(join(workspace,'binary'),Buffer.from([0,1,2]));await assert.rejects(previewFile(workspace,'binary'),/二进制/);
 await writeFile(join(workspace,'large'),'x'.repeat(256*1024+1));await assert.rejects(previewFile(workspace,'large'),/256/);
 await writeFile(join(workspace,'invalid'),Buffer.from([255]));await assert.rejects(previewFile(workspace,'invalid'),/UTF-8/);
 }finally{await rm(root,{recursive:true,force:true});}
});

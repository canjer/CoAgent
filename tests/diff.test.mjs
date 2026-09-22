import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {workspaceDiff} from '../apps/desktop/diff.mjs';
test('read-only Git diff separates staged/unstaged and rejects parent repository',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coagent-diff-'));
 const git=(...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
 try{
 await assert.rejects(workspaceDiff(root),/不是 Git/);git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 await writeFile(join(root,'sample.txt'),'before\n');git('add','sample.txt');git('-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','commit','-qm','fixture');
 assert.equal((await workspaceDiff(root)).empty,true);
 await writeFile(join(root,'sample.txt'),'after\n');await writeFile(join(root,'new.txt'),'untracked');
 assert.match((await workspaceDiff(root)).text,/\+after/);assert.equal((await workspaceDiff(root,true)).empty,true);
 git('add','sample.txt');assert.equal((await workspaceDiff(root)).empty,true);assert.match((await workspaceDiff(root,true)).text,/\+after/);
 await mkdir(join(root,'sub'));await assert.rejects(workspaceDiff(join(root,'sub')),/根目录/);
 }finally{await rm(root,{recursive:true,force:true});}
});

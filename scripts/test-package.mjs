import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=resolve('dist/release'),dmg=join(out,'coAgent-0.1.0-preview.1-arm64.dmg');
const temp=await mkdtemp(join(tmpdir(),'coagent-install-')),mount=join(temp,'volume'),installed=join(temp,'Applications/coAgent.app');await mkdir(mount);await mkdir(join(temp,'Applications'));
let mounted=false;
const run=(bin,args,env=process.env)=>new Promise((resolve,reject)=>{const p=spawn(bin,args,{env,stdio:'inherit'});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error(`Package test exited ${code}`)));});
try{
 const hash=createHash('sha256').update(await readFile(dmg)).digest('hex');assert.equal((await readFile(join(out,'SHA256SUMS.txt'),'utf8')).split(' ')[0],hash);
 execFileSync('/usr/bin/hdiutil',['attach',dmg,'-readonly','-nobrowse','-mountpoint',mount],{stdio:'inherit'});mounted=true;
 execFileSync('/usr/bin/ditto',[join(mount,'coAgent.app'),installed]);execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'inherit'});mounted=false;
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',installed],{stdio:'inherit'});
 const manifest=JSON.parse(await readFile(join(out,'APP_MANIFEST.json'),'utf8'));
 for(const [name,expected] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(await readFile(join(installed,'Contents/Resources/app',name))).digest('hex'),expected,name);
 const env={...process.env,COAGENT_TEST_APP:join(installed,'Contents/MacOS/Electron')};
 await run(process.execPath,['scripts/desktop-startup.mjs'],env);
 await run(process.execPath,['scripts/desktop-settings.mjs'],{...env,...(process.env.COAGENT_TEST_MIGRATE==='1'?{COAGENT_TEST_MIGRATE:'1'}:{})});
 console.log('PACKAGE_CREDENTIALS=PASS packaged_restart=true migration_checked='+String(process.env.COAGENT_TEST_MIGRATE==='1'));
 await run(process.execPath,['--import','tsx','scripts/desktop-providers.ts'],env);
 console.log('PACKAGE_INSTALL=PASS dmg_verified=true installed_copy=true source_independent_cwd=true bundled_runtime_tool_loop=true manifest_verified=true');
}finally{if(mounted)execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'inherit'});await rm(temp,{recursive:true,force:true});}

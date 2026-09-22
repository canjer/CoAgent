import {execFileSync} from 'node:child_process';
import {mkdir,rm,cp,copyFile,writeFile,readFile,readdir,stat,symlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Packaging currently targets macOS arm64');
const root=resolve('.'),out=join(root,'dist/release'),bundle=join(out,'coAgent.app');
const command=(name,args)=>execFileSync(name,args,{stdio:'inherit'});
await mkdir(out,{recursive:true});await rm(bundle,{recursive:true,force:true});
command('/usr/bin/ditto',[join(root,'node_modules/electron/dist/Electron.app'),bundle]);
const resources=join(bundle,'Contents/Resources'),app=join(resources,'app');await rm(join(resources,'default_app.asar'),{force:true});await mkdir(app,{recursive:true});
await cp(join(root,'dist/desktop'),join(app,'desktop'),{recursive:true});
await writeFile(join(app,'package.json'),JSON.stringify({name:'Electron',version:'0.1.0',main:'desktop/main.mjs',type:'module',private:true},null,2)+'\n');
const licenses=join(resources,'licenses');await mkdir(licenses,{recursive:true});
for(const [source,name] of [['node_modules/electron/dist/LICENSE','ELECTRON-LICENSE.txt'],['node_modules/electron/dist/LICENSES.chromium.html','CHROMIUM-LICENSES.html'],['node_modules/react/LICENSE','REACT-LICENSE.txt'],['node_modules/react-dom/LICENSE','REACT-DOM-LICENSE.txt'],['docs/licenses/CODEX-LICENSE.txt','CODEX-LICENSE.txt'],['docs/licenses/CODEX-NOTICE.txt','CODEX-NOTICE.txt']])await copyFile(join(root,source),join(licenses,name));
const plist=join(bundle,'Contents/Info.plist');
for(const [key,value] of Object.entries({CFBundleIdentifier:'dev.coagent.desktop.preview',CFBundleName:'coAgent',CFBundleDisplayName:'coAgent',CFBundleShortVersionString:'0.1.0',CFBundleVersion:'1'})){
 try{execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,plist],{stdio:'pipe'});}catch{command('/usr/libexec/PlistBuddy',['-c',`Add :${key} string ${value}`,plist]);}
}
// Local ad-hoc identity only. Developer ID signing and notarization are separate release gates.
command('/usr/bin/codesign',['--force','--deep','--sign','-',bundle]);
command('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
const hashes={};
async function inventory(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await inventory(path);else if(entry.isFile()){const bytes=await readFile(path);hashes[path.slice(app.length+1)]=createHash('sha256').update(bytes).digest('hex');}}}
await inventory(app);await writeFile(join(out,'APP_MANIFEST.json'),JSON.stringify({version:'0.1.0-preview.1',target:'darwin-arm64',signature:'ad-hoc',notarized:false,files:hashes},null,2)+'\n');
const stage=join(out,'dmg-stage');await rm(stage,{recursive:true,force:true});await mkdir(stage);command('/usr/bin/ditto',[bundle,join(stage,'coAgent.app')]);await symlink('/Applications',join(stage,'Applications'));
const dmg=join(out,'coAgent-0.1.0-preview.1-arm64.dmg');await rm(dmg,{force:true});
try{command('/usr/bin/hdiutil',['create','-volname','coAgent Preview','-srcfolder',stage,'-format','UDZO',dmg]);}finally{await rm(stage,{recursive:true,force:true});}
command('/usr/bin/hdiutil',['verify',dmg]);
const sha=createHash('sha256').update(await readFile(dmg)).digest('hex');await writeFile(join(out,'SHA256SUMS.txt'),`${sha}  ${dmg.split('/').at(-1)}\n`);
console.log(`PACKAGE=PASS target=darwin-arm64 signature=ad-hoc notarized=false bytes=${(await stat(dmg)).size}`);console.log(dmg);

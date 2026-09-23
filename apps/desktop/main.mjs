import {attachments,skills} from './composer-context.mjs';
import {BrowserService} from './browser-service.mjs';
import {chatProfileOptions} from '../../packages/model-gateway/src/chat-profile.ts';
import {diagnoseProvider} from '../../packages/model-gateway/src/diagnostics.ts';
import {CredentialVault} from './credentials.mjs';
import {ProviderRegistry,validateProvider} from './providers.mjs';
import {app,BrowserWindow,ipcMain,dialog,safeStorage} from 'electron';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HostClient} from './host-client.mjs';
const here=dirname(fileURLToPath(import.meta.url));
let window,host,vault,providers,browser,credentialBusy=false;
const methods=new Set(['security:prepare','security:confirm','security:cancel','security:config','security:save','security:state','security:start','security:stop','plugins:status','plugins:save','plugins:discover','projects:list','project:select','recovery:ack','recovery:history','state','files','preview','diff','model','list','history','run','stop','approve']);
ipcMain.handle('agent:call',async(event,method,args={})=>{
 if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Invalid sender');
 if(method==='browser:resource-grant')return browser.resourceGrant(args);
 if(method==='browser:state')return browser.state();
 if(method==='browser:layout')return browser.setLayout(args);
 if(method==='browser:takeover')return browser.takeover(true);
 if(method==='browser:resume')return browser.takeover(false);
 if(method==='browser:navigate')return browser.manual('browser_navigate',args);
 if(method==='browser:back')return browser.manual('browser_navigate_back');
 if(method==='browser:reload')return browser.manual('browser_reload');
 if(method==='browser:close'){browser.takeover(true);return browser.manual('browser_close');}
 if(method==='stop')browser.end();
 if(method==='approve')browser.approve(args.id,args.decision,['task-command-similar','task-command-prefix'].includes(args.scope)?'once':args.scope??'once');
 if(method==='credentials:status')return {...await vault.status(),warning:providers.store.warning};
 if(['providers:save','providers:delete'].includes(method)){
  if(credentialBusy)throw new Error('凭据操作进行中');credentialBusy=true;let paused=false;
  try{
   await host.call('credentials:pause');paused=true;
   if(method==='providers:save'){
    if(args.id){const old=providers.get(args.id),next=validateProvider(args);if((await vault.stored(old.id)||process.env[old.apiKeyEnv])&&['baseUrl','protocol','upstreamModel'].some(k=>old[k]!==next[k]))throw new Error('请先删除该服务的已保存凭据，再修改地址、协议或模型');}
    const saved=await providers.save(args);
    if(typeof args.apiKey==='string'&&args.apiKey.trim()){
     try{await vault.save(saved.id,args.apiKey.trim());}catch(error){if(!args.id)await providers.remove(saved.id);throw error;}
    }
   }else{
    const state=await host.call('state');if(state.model===args.id)throw new Error('请先切换到其他模型');
    if(state.recovery?.status==='needs-review'&&state.recovery.model===args.id)throw new Error('请先核对待恢复任务');
    if(!providers.get(args.id).custom)throw new Error('内置模型不可删除');
    await vault.remove(args.id);await providers.remove(args.id);
   }
   return await vault.status();
  }finally{try{if(paused)await host.call('credentials:apply',{env:await vault.environment()});}finally{credentialBusy=false;}}
 }
 if(['credentials:save','credentials:delete','credentials:test','credentials:diagnose'].includes(method)){
  const profile=providers.get(args.id);
  if(credentialBusy)throw new Error('凭据操作进行中');credentialBusy=true;
  let paused=false;
  try{
   await host.call('credentials:pause');paused=true;
   if(method==='credentials:save')await vault.save(profile.id,args.key);
   else if(method==='credentials:delete')await vault.remove(profile.id);
   else {
    const key=await vault.key(profile.id);if(!key)throw new Error('请先配置密钥');
    if(method==='credentials:diagnose')return await diagnoseProvider({protocol:profile.protocol,baseUrl:profile.baseUrl,alias:profile.id,upstreamModel:profile.upstreamModel||profile.id,apiKey:key});
    try{
     const response=await fetch(profile.baseUrl+(profile.protocol==='responses'?'/responses':'/chat/completions'),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(profile.protocol==='responses'?{model:profile.upstreamModel||profile.id,input:'Reply OK',max_output_tokens:32,stream:false}:{model:profile.upstreamModel||profile.id,messages:[{role:'user',content:'Reply OK'}],max_tokens:32,stream:false,...chatProfileOptions(profile.baseUrl,profile.upstreamModel||profile.id)})});
     await response.body?.cancel();return {ok:response.ok,status:response.status,model:profile.id,check:'minimal-request-not-agent-certification'};
    }catch{throw new Error('连接测试失败或超时');}
   }
   return await vault.status();
  }finally{
   try{if(paused)await host.call('credentials:apply',{env:await vault.environment()});}finally{credentialBusy=false;}
  }
 }
 if(method==='composer:pick'){
  const r=await dialog.showOpenDialog(window,{properties:[args.kind==='folder'?'openDirectory':'openFile','multiSelections']});
  return r.canceled?[]:attachments(r.filePaths);
 }
 if(method==='composer:paths')return attachments(args.paths);
 if(method==='composer:catalog'){const state=await host.call('state');const p=await host.call('plugins:status');return {skills:await skills(state.workspace),plugins:[...(p.config.browserEnabled?[{id:'browser',enabled:true}]:[]),...p.config.servers.map(s=>({id:s.id,enabled:s.enabled}))]};}
 if(method==='choose'){
  const result=await dialog.showOpenDialog(window,{properties:['openDirectory']});
  if(result.canceled)return (await host.call('state')).workspace;
  return host.call('choose',{path:result.filePaths[0]});
 }
 if(method==='plugins:save'&&credentialBusy)throw new Error('配置操作进行中');
 if(!methods.has(method))throw new Error('Unknown operation');
 if(method==='run'){browser.begin();try{return await host.call(method,args);}catch(error){browser.end();throw error;}}
 try{return await host.call(method,args);}catch(error){if(method==='approve')browser.revoke();throw error;}
});
// Preserve the existing data location for this preview. A changed signing identity may require key re-entry.
app.setName('Electron');
app.setPath('userData',join(app.getPath('appData'),'Electron'));
if(process.env.COAGENT_TEST_USER_DATA)app.setPath('userData',process.env.COAGENT_TEST_USER_DATA);
function focusWindow(){if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();}
app.on('second-instance',focusWindow);
app.on('activate',focusWindow);
if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(async()=>{
 if(process.env.COAGENT_TEST_USER_DATA)app.setPath('userData',process.env.COAGENT_TEST_USER_DATA);
 providers=new ProviderRegistry(app.getPath('userData'));await providers.init();
 vault=new CredentialVault(join(app.getPath('userData'),'credentials'),safeStorage,process.env,()=>providers.all());
 
 window=new BrowserWindow({width:1280,height:860,minWidth:900,minHeight:650,title:'coAgent',backgroundColor:'#101318',webPreferences:{preload:join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const publish=event=>{if(window&&!window.isDestroyed())window.webContents.send('agent:event',event);};
 browser=new BrowserService(window,publish);await browser.start();
 host=new HostClient(join(here,'host.mjs'),app.getPath('userData'),event=>{browser.observe(event);
  if(event.method==='approval'){
   try{if(browser.autoApprove(event.params)){void host.call('approve',{id:event.params.id,decision:'accept'}).then(()=>publish({method:'browser/auto-approved',params:{tool:event.params.message}})).catch(()=>{browser.revoke();publish(event);});return;}}catch{browser.revoke();}
  }
  publish(event);},async()=>({...await vault.environment(),COAGENT_BROWSER_URL:browser.url,COAGENT_BROWSER_TOKEN:browser.token}));
 window.on('resize',()=>{browser.layout.visible=false;browser.applyLayout();});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
 let quitting=false;app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;void browser.close().then(()=>host.close()).catch(()=>{}).finally(()=>app.quit());});
 app.on('window-all-closed',()=>app.quit());
 await window.loadFile(join(here,'ui/index.html'));
}).catch(error=>{console.error('coAgent startup failed:',error.name);dialog.showErrorBox('coAgent 启动失败','初始化应用或配置时发生错误。原配置文件已保留。请检查数据目录中的 providers.json 及其备份，或联系开发者排查。\n数据目录：'+app.getPath('userData'));app.quit();});

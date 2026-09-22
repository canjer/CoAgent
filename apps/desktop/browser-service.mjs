import {BrowserApprovalScope,approvalTool,browserActionRisk,ordinaryLink} from './browser-approvals.mjs';
import {ResourceGrants} from './browser-resources.mjs';
import {redirectDestination} from './browser-redirect.mjs';
import {proxyRoute} from './browser-network.mjs';
import {BrowserDiagnostics} from './browser-diagnostics.mjs';
import {WebContentsView,session} from 'electron';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {browserTools,browserURL,publicAddress,validateBrowserArgs,canonical} from './browser-policy.mjs';
import {snapshotProgram,actionProgram} from './browser-page.mjs';
const WORLD=999;
export class BrowserService{
 constructor(window,publish){this.approvalScope=new BrowserApprovalScope();this.resources=new ResourceGrants();this.diagnostics=new BrowserDiagnostics();this.window=window;this.publish=publish;this.token=randomBytes(32).toString('hex');this.epoch=0;this.active=false;this.paused=false;this.approvals=new Map();this.grants=[];this.layout={visible:false};this.notice='临时会话 · 单标签 · 跨域资源默认阻止';}
 state(){return {approvalScope:this.approvalScope.state(),resourceGrants:this.resources.list(),diagnostics:this.diagnostics.snapshot(),open:!!this.view,url:this.view?.webContents.getURL()||'',paused:this.paused,active:this.active,notice:this.notice,visible:!!this.view?.getVisible()};}
 emit(){this.publish({method:'browser/state',params:this.state()});}
 begin(){if(this.active)throw new Error('已有任务运行中');this.active=true;this.approvalScope.clear();this.epoch++;this.grants=[];this.approvals.clear();this.emit();}
 end(){this.approvalScope.clear();this.active=false;this.invalidate();this.view?.webContents.stop();this.emit();}
 invalidate(){this.epoch++;this.grants=[];this.approvals.clear();this.snapshot=null;}
 observe(event){
  if(event.method==='approval'&&event.params.serverName==='browser')this.approvals.set(event.params.id,{...event.params,epoch:this.epoch});
  if(event.method==='turn/completed'||event.method==='connection/closed')this.end();
 }
 approve(id,decision,scope='once'){
  const request=this.approvals.get(id);if(!request){if(scope!=='once')throw new Error('审批已过期或不属于浏览器');return;}
  if(decision!=='accept'){this.approvals.delete(id);return;}
  // Pinned Codex 0.155.1 identifies the tool in this message, not a separate metadata field.
  const name=approvalTool(request);
  if(!name||!this.active||this.paused||request.epoch!==this.epoch)throw new Error('浏览器审批已过期；请重新发起操作');
  const args=validateBrowserArgs(name,request._meta?.tool_params??{});
  if(browserActionRisk(name,args)==='review'&&scope!=='once')throw new Error('此操作需要单次确认，请选择允许此次操作');
  this.approvalScope.allow(scope,name,args,this.origin);this.emit();
  this.approvals.delete(id);
  this.grants.push({name,args:canonical(args),epoch:this.epoch,expires:Date.now()+30000});
 }
 revoke(){this.approvalScope.clear();this.grants=[];this.emit();}
 autoApprove(request){const name=approvalTool(request);if(!name||!this.active||this.paused)return false;const risk=browserActionRisk(name,request._meta?.tool_params??{});const args=request._meta?.tool_params??{};const href=name==='browser_click'&&this.snapshot===args.snapshotId?this.linkTargets?.get(args.ref):null;if(risk==='review'&&!ordinaryLink(href))return false;this.approve(request.id,'accept');if(href)this.grants.at(-1).linkURL=href;return true;}
 takeover(paused){this.approvalScope.clear();this.paused=paused;this.invalidate();this.view?.webContents.stop();this.emit();return this.state();}
 async start(){
  this.server=createServer(async(req,res)=>{
   if(req.headers.authorization!=='Bearer '+this.token||req.headers.origin||req.url!=='/mcp'){res.writeHead(403).end();return;}
   if(req.method!=='POST'){res.writeHead(405).end();return;}
   let message;
   try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>65536)throw new Error('Request too large');}message=JSON.parse(body);
    let result;
    switch(message.method){
     case 'initialize':result={protocolVersion:message.params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'coagent-shared-browser',version:'1'}};break;
     case 'tools/list':result={tools:browserTools};break;
     case 'resources/list':result={resources:[]};break;
     case 'resources/templates/list':result={resourceTemplates:[]};break;
     case 'ping':result={};break;
     case 'tools/call':{
      try{const value=await this.agentCall(message.params?.name,message.params?.arguments??{});result={content:[{type:'text',text:JSON.stringify(value)}]};}
      catch(error){result={isError:true,content:[{type:'text',text:error.message}]};}break;
     }
     default:if(message.id!==undefined)throw new Error('Unknown method');
    }
    if(message.id===undefined){res.writeHead(202).end();return;}
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
   }catch{res.writeHead(400).end(JSON.stringify({error:'Invalid browser request'}));}
  });
  this.server.requestTimeout=15000;this.server.headersTimeout=10000;
  await new Promise(resolve=>this.server.listen(0,'127.0.0.1',resolve));
  this.url=`http://127.0.0.1:${this.server.address().port}/mcp`;
 }
 async agentCall(name,args){
  validateBrowserArgs(name,args);
  if(!this.active||this.paused||this.executing)throw new Error('浏览器未授权、已暂停或操作进行中');
  const index=this.grants.findIndex(g=>g.name===name&&g.args===canonical(args)&&g.epoch===this.epoch&&g.expires>Date.now());
  if(index<0)throw new Error('浏览器需要当前任务的一次性审批');
  const [grant]=this.grants.splice(index,1);
  if(grant.linkURL){
   const epoch=this.epoch;if(this.snapshot!==args.snapshotId||!this.view)throw new Error('STALE_SNAPSHOT');
   const result=await this.script(this.view.webContents,actionProgram(name,{...args,navigationOnly:true,expectedURL:grant.linkURL}));
   if(result.error)throw new Error(result.error);if(epoch!==this.epoch||!this.active||this.paused)throw new Error('操作已取消');
   return this.execute('browser_navigate',{url:grant.linkURL,allowLocal:this.local===true});
  }
  return this.execute(name,args);
 }
 async resourceGrant({origin,type,allow}){
  if(!this.view||this.executing||this.active&&!this.paused)throw new Error('请先接管并等待当前网页操作完成');
  if(typeof allow!=='boolean')throw new Error('授权参数错误');
  const u=this.resources.validate(origin,type,this.local);
  const view=this.view,epoch=this.epoch;
  if(allow){
   if(!this.diagnostics.snapshot().blocked.some(r=>r.origin===origin&&r.resourceType===type&&r.reason==='cross-origin'))throw new Error('仅可授权当前诊断列表中的资源');
   if(!this.proxyRoute&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname)){
    const addresses=await this.resolvePublic(u.hostname);if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('资源域解析为内网地址');
   }
   if(this.view!==view||this.epoch!==epoch||this.executing||this.active&&!this.paused)throw new Error('页面或控制权已变化，请重新确认');
   this.resources.allow(origin,type,this.local);
  }else this.resources.revoke(origin,type);
  this.invalidate();view.webContents.stop();
  this.notice='资源授权已更新，仅当前临时会话生效；请手动刷新。已执行脚本不会被撤销。';this.emit();return this.state();
 }
 recordBlock(url,type,reason){this.diagnostics.record(url,type,reason);if(!this.diagnosticTimer)this.diagnosticTimer=setTimeout(()=>{this.diagnosticTimer=null;this.emit();},100);}
 async ensureView(){
  if(this.view)return;
  const ses=session.fromPartition('coagent-browser-'+randomUUID(),{cache:false});this.session=ses;
  await ses.setProxy(this.proxyRoute?{mode:'fixed_servers',proxyRules:this.proxyRoute,proxyBypassRules:'<-loopback>'}:{mode:'direct'});
  ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);ses.setDevicePermissionHandler(()=>false);
  ses.on('will-download',event=>{event.preventDefault();this.notice='下载已阻止';this.emit();});
  ses.webRequest.onBeforeRequest((details,callback)=>{
   if(ses!==this.session){callback({cancel:true});return;}
   let reason='';
   try{const u=browserURL(details.url,this.local);
    if(details.uploadData?.some(d=>d.file))reason='file-upload';
    else if(details.resourceType==='webSocket')reason='websocket';
    else if(u.origin!==this.origin&&!this.resources.has(u.origin,details.resourceType))reason='cross-origin';
   }catch{reason=details.resourceType==='webSocket'?'websocket':'url-policy';}
   if(reason){this.notice='部分资源被阻止，可展开站点诊断查看';this.recordBlock(details.url,details.resourceType,reason);}
   callback({cancel:!!reason});
  });
  ses.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[...Object.entries(details.responseHeaders||{}).filter(([k])=>k.toLowerCase()==='content-security-policy').flatMap(([,v])=>v),"object-src 'none'; frame-src 'none'; worker-src 'none'; media-src 'none'; connect-src 'self'; form-action 'self'"]}}));
  const view=new WebContentsView({webPreferences:{session:ses,nodeIntegration:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,disableDialogs:true,navigateOnDragDrop:false}});this.view=view;
  this.window.contentView.addChildView(view);view.setVisible(false);
  const wc=view.webContents;
  wc.setWindowOpenHandler(({url})=>{this.recordBlock(url,'mainFrame','popup');this.notice='新窗口已阻止，请使用地址栏导航';this.emit();return {action:'deny'};});
  const gate=(event,url)=>{try{if(browserURL(url,this.local).origin===this.origin)return;}catch{}event.preventDefault();this.recordBlock(url,'mainFrame','navigation');this.notice='跨站跳转已阻止，请单独审批目标地址';this.emit();};
  wc.on('will-navigate',gate);wc.on('will-redirect',(event,url,_inPlace,isMainFrame)=>{
   if(isMainFrame===false){gate(event,url);return;}
   try{if(browserURL(url,this.local).origin===this.origin)return;}catch{}
   event.preventDefault();
   const destination=redirectDestination(this.origin,url);
   if(this.followingNavigation&&destination)this.redirectTarget=destination;
   else{this.recordBlock(url,'mainFrame','navigation');this.notice='跳转目标需要单独确认，请检查地址后手动打开';}
  });wc.on('will-attach-webview',e=>e.preventDefault());
  wc.on('did-start-navigation',()=>{this.snapshot=null;});wc.on('did-navigate-in-page',()=>{this.snapshot=null;this.emit();});
  wc.on('did-finish-load',()=>this.emit());wc.on('page-title-updated',()=>this.emit());
  wc.on('render-process-gone',()=>{this.takeover(true);this.notice='网页进程已退出，请关闭并重新打开；操作不会重放';this.emit();});
  wc.on('before-mouse-event',(event,input)=>{if(!this.paused&&input.type==='mouseDown'){event.preventDefault();this.takeover(true);this.notice='已切换为用户接管，请再次点击；Agent 操作已暂停';this.emit();}});
  wc.on('before-input-event',(event,input)=>{
   if((input.control||input.meta)&&['v','c','x'].includes(input.key.toLowerCase())){event.preventDefault();return;}
   if(!this.paused){event.preventDefault();this.takeover(true);}
  });
  await wc.loadURL('about:blank');
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Page.enable');
  await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true});
  this.applyLayout();this.emit();
 }
 setLayout(args){
  const {visible,x,y,width,height}=args;
  if(typeof visible!=='boolean'||[x,y,width,height].some(n=>!Number.isFinite(n)))throw new Error('浏览器布局错误');
  const [w,h]=this.window.getContentSize();
  this.layout={visible,x:Math.max(0,Math.min(w,Math.round(x))),y:Math.max(0,Math.min(h,Math.round(y))),width:Math.max(0,Math.min(w-Math.max(0,x),Math.round(width))),height:Math.max(0,Math.min(h-Math.max(0,y),Math.round(height)))};
  this.applyLayout();return this.state();
 }
 applyLayout(){if(this.view){const {visible,...bounds}=this.layout;if(visible){this.view.setBounds(bounds);}this.view.setVisible(!!visible&&bounds.width>0&&bounds.height>0);}}
 async manual(name,args={}){if(this.active&&!this.paused)throw new Error('请先接管浏览器');this.invalidate();return this.execute(name,args);}
 async execute(name,args){
  validateBrowserArgs(name,args);if(this.executing)throw new Error('浏览器操作进行中');
  this.executing=true;const epoch=this.epoch;
  try{
   if(name==='browser_close'){await this.closePage();return {closed:true};}
   if(name==='browser_navigate'){
    let target=args.url;const visited=new Set();
    for(let hop=0;hop<=5;hop++){
    if(visited.has(target))throw new Error('检测到循环重定向');visited.add(target);
    const u=browserURL(target,args.allowLocal===true),local=['127.0.0.1','[::1]','localhost'].includes(u.hostname);
    if(/(?:^|\.)(?:localhost|local|internal|lan)$/.test(u.hostname)&&!local)throw new Error('本地域名未开放');
    const route=local?null:proxyRoute(await session.defaultSession.resolveProxy(u.href));
    if(!local&&!route){const addresses=await this.resolvePublic(u.hostname);if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('直连 DNS 返回非公网或特殊用途地址，请检查系统 DNS 或代理配置');}
    if(epoch!==this.epoch)throw new Error('操作已取消');
    // Fresh partition across origins prevents a previous site's service workers from retaining access.
    if(this.view&&(this.origin!==u.origin||this.proxyRoute!==route))await this.closePage();
    this.proxyRoute=route;this.origin=u.origin;this.local=local;await this.ensureView();
    if(epoch!==this.epoch)throw new Error('操作已取消');
    this.publish({method:'browser/show',params:{}});
    this.redirectTarget=null;this.followingNavigation=true;
    try{await this.load(u.href);}catch(error){
     if(!this.redirectTarget)throw error;
    }finally{this.followingNavigation=false;}
    if(epoch!==this.epoch)throw new Error('操作已取消');
    if(this.redirectTarget){target=this.redirectTarget;this.redirectTarget=null;continue;}
    this.emit();return {url:this.view.webContents.getURL(),refreshSnapshot:true};
    }
    throw new Error('重定向超过 5 次，已停止');
   }
   if(!this.view)throw new Error('请先打开网页');
   const wc=this.view.webContents;
   if(name==='browser_snapshot'){
    const value=await this.script(wc,snapshotProgram);if(epoch!==this.epoch)throw new Error('操作已取消');this.snapshot=value.snapshotId;this.linkTargets=new Map(value.elements.filter(e=>e.href).map(e=>[e.ref,e.href]));return value;
   }
   if(['browser_click','browser_type'].includes(name)){
    if(!this.snapshot||this.snapshot!==args.snapshotId)throw new Error('STALE_SNAPSHOT: read a new snapshot');
    this.snapshot=null;
    const result=await this.script(wc,actionProgram(name,args));if(result.error)throw new Error(result.error);return result;
   }
   this.snapshot=null;
   if(name==='browser_reload'){await this.load(wc.getURL());return {reloaded:true};}
   if(name==='browser_navigate_back'){
    const history=wc.navigationHistory,entry=history.getAllEntries()[history.getActiveIndex()-1];
    if(!entry||browserURL(entry.url,this.local).origin!==this.origin)throw new Error('没有同站历史');
    history.goBack();return {back:true,refreshSnapshot:true};
   }
  }finally{this.executing=false;this.emit();}
 }
 async resolvePublic(host){let timer;try{return await Promise.race([lookup(host,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS 查询超时')),10000);})]);}finally{clearTimeout(timer);}}
 async script(wc,code){let timer;try{return await Promise.race([wc.executeJavaScriptInIsolatedWorld(WORLD,[{code}]),new Promise((_,reject)=>{timer=setTimeout(()=>{this.takeover(true);wc.forcefullyCrashRenderer();reject(new Error('网页操作超时，已暂停；请关闭并重新打开网页'));},10000);})]);}finally{clearTimeout(timer);}}
 async load(url){this.diagnostics.reset();this.diagnostics.status='loading';this.emit();let timer;try{await Promise.race([this.view.webContents.loadURL(url),new Promise((_,reject)=>{timer=setTimeout(()=>{this.view?.webContents.stop();reject(new Error('网页加载超时'));},20000);})]);this.diagnostics.status='loaded';}catch(error){this.diagnostics.status='failed';this.diagnostics.error=Number.isInteger(error.errno)?'NET_ERROR_'+error.errno:'LOAD_INTERRUPTED_OR_TIMEOUT';throw error;}finally{clearTimeout(timer);this.emit();}}
 async closePage(){
  const view=this.view,ses=this.session;this.view=null;this.session=null;this.snapshot=null;
  if(view){this.window.contentView.removeChildView(view);view.webContents.close({waitForBeforeUnload:false});}
  this.resources.clear();this.diagnostics.reset();clearTimeout(this.diagnosticTimer);this.diagnosticTimer=null;
  if(ses){await ses.clearStorageData();await ses.clearCache();await ses.closeAllConnections();}this.emit();
 }
 async close(){this.end();await this.closePage();if(this.server){this.server.closeAllConnections();await new Promise(resolve=>this.server.close(resolve));}}
}

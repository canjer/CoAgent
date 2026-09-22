// Electron-only isolated component regression; no real websites/provider keys.
import {app,BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserService} from '../apps/desktop/browser-service.mjs';
const dir=await mkdtemp(join(tmpdir(),'coagent-browser-unit-'));app.setPath('userData',dir);
app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{let window,browser,site,foreign;let blockedHits=0,clicks=0,slowSeen=false;
try{
 foreign=createServer((_q,r)=>{blockedHits++;r.end('foreign');});await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
 foreign.on('upgrade',(_q,socket)=>{blockedHits++;socket.destroy();});
 const foreignURL=`http://127.0.0.1:${foreign.address().port}`;
 site=createServer((q,r)=>{
  if(q.url==='/slow'){slowSeen=true;setTimeout(()=>r.end('slow'),300).unref();return;}
  if(q.url==='/blank'){r.setHeader('content-type','text/html');r.end('<title>Blank</title>');return;}
  if(q.url==='/clicked'){clicks++;r.end('ok');return;}
  if(q.url==='/redirect'){r.writeHead(302,{location:foreignURL});r.end();return;}
  r.setHeader('content-type','text/html');r.end(`<title>Browser fixture</title><h1>Shared page</h1><input aria-label="Name"><input type="password" value="secret"><input type="file"><button onclick="document.querySelector('h1').textContent='CLICKED';fetch('/clicked')">Click proof</button><img src="${foreignURL}/image"><script>localStorage.setItem('temporary','yes');window.open('${foreignURL}');fetch('${foreignURL}/fetch').catch(()=>{});new WebSocket('ws://127.0.0.1:${foreign.address().port}/ws');</script>`);
 });await new Promise(r=>site.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${site.address().port}/`;
 window=new BrowserWindow({show:false});browser=new BrowserService(window,()=>{});await browser.start();browser.setLayout({visible:true,x:0,y:0,width:600,height:400});
 const http=async(body,token=browser.token)=>{const r=await fetch(browser.url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:r.status===200?await r.json():null};};
 assert.equal((await http({method:'tools/list',id:1},'wrong')).status,403);
 assert.equal((await http({method:'tools/list',id:1})).body.result.tools.length,7);
 assert.equal((await http({method:'tools/call',id:2,params:{name:'browser_navigate',arguments:{url,allowLocal:true}}})).body.result.isError,true);
 let id=0;const grant=(name,args)=>{const approval={id:++id,serverName:'browser',message:`Allow the browser MCP server to run tool "${name}"?`,_meta:{codex_approval_kind:'mcp_tool_call',tool_params:args}};browser.observe({method:'approval',params:approval});browser.approve(id,'accept');};
 const act=async(name,args={})=>{grant(name,args);return browser.agentCall(name,args);};
 browser.begin();
 browser.observe({method:'approval',params:{id:-1,serverName:'browser',message:'Allow the browser MCP server to run tool "browser_navigate"?',_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{url,allowLocal:true}}}});browser.approve(-1,'decline');await assert.rejects(browser.agentCall('browser_navigate',{url,allowLocal:true}),/一次性审批/);assert.equal(browser.view,undefined);
 await act('browser_navigate',{url,allowLocal:true});const wc=browser.view.webContents;
 assert.equal(browser.state().visible,true);assert.equal(wc.getLastWebPreferences().nodeIntegration,false);assert.equal(wc.getLastWebPreferences().sandbox,true);
 assert.deepEqual(await wc.executeJavaScript('({node:typeof require,bridge:typeof window.coagent})'),{node:'undefined',bridge:'undefined'});
 const scoped={id:999,serverName:'browser',message:'Allow the browser MCP server to run tool "browser_snapshot"?',_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{}}};
 browser.observe({method:'approval',params:scoped});browser.approve(999,'accept','task-similar');await browser.agentCall('browser_snapshot',{});
 browser.observe({method:'approval',params:{...scoped,id:1000}});assert.equal(browser.autoApprove({...scoped,id:1000}),true);await browser.agentCall('browser_snapshot',{});
 browser.takeover(true);assert.deepEqual(browser.state().approvalScope,{all:false,similarCount:0});browser.takeover(false);
 const snap=await act('browser_snapshot');await assert.rejects(browser.agentCall('browser_snapshot',{}),/一次性审批/);assert.equal(snap.title,'Browser fixture');assert.equal(snap.elements.some(e=>e.tag==='input'&&e.label!=='Name'),false);
 const button=snap.elements.find(e=>e.label==='Click proof');await act('browser_click',{snapshotId:snap.snapshotId,ref:button.ref});
 await assert.rejects(act('browser_click',{snapshotId:snap.snapshotId,ref:button.ref}),/STALE/);
 assert.equal(await wc.executeJavaScript('document.querySelector("h1").textContent'),'CLICKED');
 let next=await act('browser_snapshot');await act('browser_type',{snapshotId:next.snapshotId,ref:next.elements.find(e=>e.label==='Name').ref,text:'shared input'});assert.equal(await wc.executeJavaScript('document.querySelector("input").value'),'shared input');
 next=await act('browser_snapshot');await wc.executeJavaScript('document.body.append(document.createElement("p"))');await assert.rejects(act('browser_click',{snapshotId:next.snapshotId,ref:next.elements.find(e=>e.label==='Click proof').ref}),/STALE/);
 grant('browser_snapshot',{});browser.takeover(true);await assert.rejects(browser.agentCall('browser_snapshot',{}),/暂停/);browser.takeover(false);await assert.rejects(browser.agentCall('browser_snapshot',{}),/一次性审批/);
 browser.setLayout({visible:false,x:0,y:0,width:0,height:0});assert.equal(browser.state().visible,false);
 grant('browser_snapshot',{});browser.end();await assert.rejects(browser.agentCall('browser_snapshot',{}),/未授权/);
 browser.begin();const pending=act('browser_navigate',{url:url+'slow',allowLocal:true});const interrupted=assert.rejects(pending,/ERR_(ABORTED|FAILED)|取消/);for(let i=0;i<50&&!slowSeen;i++)await new Promise(r=>setTimeout(r,5));assert.equal(slowSeen,true);browser.end();await interrupted;assert.equal(browser.active,false);
 await browser.manual('browser_navigate',{url:url+'redirect',allowLocal:true}).catch(()=>{});
 assert.ok(browser.state().diagnostics.totalBlocked>0);assert.ok(browser.state().diagnostics.blocked.every(r=>!r.origin.includes('/image')));assert.equal(blockedHits,0);assert.equal(clicks,1);
 await browser.manual('browser_navigate',{url,allowLocal:true});
 await assert.rejects(browser.resourceGrant({origin:foreignURL,type:'script',allow:true}),/诊断/);
 browser.begin();await assert.rejects(browser.resourceGrant({origin:foreignURL,type:'image',allow:true}),/接管/);browser.end();
 await browser.resourceGrant({origin:foreignURL,type:'image',allow:true});assert.equal(browser.state().resourceGrants.length,1);
 await browser.manual('browser_reload');assert.ok(blockedHits>0);const permittedHits=blockedHits;
 await browser.resourceGrant({origin:foreignURL,type:'image',allow:false});await browser.manual('browser_reload');assert.equal(blockedHits,permittedHits);
 await browser.resourceGrant({origin:foreignURL,type:'image',allow:true});await browser.closePage();assert.equal(browser.state().resourceGrants.length,0);
 await browser.closePage();await browser.manual('browser_navigate',{url:url+'blank',allowLocal:true});assert.equal(browser.session.isPersistent(),false);assert.equal(await browser.view.webContents.executeJavaScript('localStorage.getItem("temporary")'),null);
 await browser.closePage();
 console.log('BROWSER_SERVICE=PASS auth approval_once shared_dom click type stale_dom takeover resume stop redirect subresources popup no_node no_bridge ephemeral hidden resource_grant_revoke_exact_type');
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();window?.destroy();await Promise.all([site,foreign].filter(Boolean).map(s=>new Promise(r=>s.close(r))));await rm(dir,{recursive:true,force:true});app.exit(process.exitCode||0);}

});

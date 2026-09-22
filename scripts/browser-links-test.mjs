import {app,BrowserWindow} from 'electron';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {BrowserService} from '../apps/desktop/browser-service.mjs';
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false});const b=new BrowserService(w,()=>{});const server=createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(q.url==='/next'?'<h1>NEXT</h1>':'<a href="/next" onclick="document.body.dataset.clicked=1;return false">Read next</a><a href="/delete">Delete</a>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let code=0;
b.setLayout({visible:true,x:0,y:0,width:800,height:600});
try{await b.manual('browser_navigate',{url:`http://127.0.0.1:${server.address().port}/`,allowLocal:true});b.begin();const snap=await b.execute('browser_snapshot',{});
 const request=(id,ref)=>({id,serverName:'browser',message:'Allow the browser MCP server to run tool "browser_click"?',_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{snapshotId:snap.snapshotId,ref}}});
 const bad=request(1,snap.elements.find(e=>e.label==='Delete').ref);b.observe({method:'approval',params:bad});assert.equal(b.autoApprove(bad),false);
 const good=request(2,snap.elements.find(e=>e.label==='Read next').ref);b.observe({method:'approval',params:good});assert.equal(b.autoApprove(good),true);await b.agentCall('browser_click',good._meta.tool_params);assert.ok(b.state().url.endsWith('/next'));
 console.log('LINKS=PASS ordinary_auto sensitive_review direct_navigation');
}catch(e){console.error(e);code=1;}finally{await b.close();w.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));app.exit(code);}

});

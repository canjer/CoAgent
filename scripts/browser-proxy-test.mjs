import {app,BrowserWindow,session} from 'electron';import {BrowserService} from '../apps/desktop/browser-service.mjs';import assert from 'node:assert/strict';
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false});const b=new BrowserService(w,()=>{});let code=0;try{
 const url='https://www.google.com/';const route=await session.defaultSession.resolveProxy(url);console.log('SYSTEM_ROUTE='+route);let dnsCalls=0;b.resolvePublic=async()=>{dnsCalls++;return [{address:'2001::1',family:6}];};
 try{await b.manual('browser_navigate',{url});console.log('NAVIGATION=loaded');}catch(e){console.log('NAVIGATION_ERROR='+e.message);if(/DNS|内网/.test(e.message))throw e;}
 assert.ok(b.proxyRoute);assert.equal(dnsCalls,0);assert.equal(await b.session.resolveProxy(url),'PROXY 127.0.0.1:7890');console.log('PROXY_DNS=PASS remote_resolution local_dns_unused route_pinned');
 }catch(e){console.error(e);code=1;}finally{await b.close();w.destroy();app.exit(code);}});

import http from 'node:http';import https from 'node:https';import {lookup} from 'node:dns/promises';import {isIP} from 'node:net';
import {auditHeaders,auditRedirect} from './http-audit.mjs';
import {checkScope} from './scope.mjs';
export const toolRegistry=Object.freeze({'http-head':Object.freeze({id:'http-head',version:1,label:'HTTP 响应头探测',method:'HEAD',effect:'network-read',description:'串行 HEAD；不读取正文、不发送账号凭据；每个跳转重新检查范围。'})});
async function abortable(promise,signal){
 signal.throwIfAborted();let listener;try{return await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(signal.reason||new Error('已停止'));signal.addEventListener('abort',listener,{once:true});})]);}finally{signal.removeEventListener('abort',listener);}
}
export async function headProbe({url,config,signal,reserve,record,beforeSend=async()=>{},resolve=lookup}){
 let target=url;const seen=new Set();
 for(let hop=0;hop<=5;hop++){
  signal.throwIfAborted();const u=checkScope(config,target);if(seen.has(u.href))throw new Error('循环重定向');seen.add(u.href);
  const host=u.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await abortable(resolve(host,{all:true}),signal);
  signal.throwIfAborted();checkScope(config,u.href,{addresses});await reserve();signal.throwIfAborted();checkScope(config,u.href,{addresses});
  const selected=addresses[0];await beforeSend({url:u.href,method:'HEAD',address:selected.address,headers:{host:u.host,'user-agent':'CoAgent-Security-S1/1.0',accept:'*/*',connection:'close'},body:null,capture:'request-intent'});signal.throwIfAborted();checkScope(config,u.href,{addresses});const started=performance.now();let response;try{response=await new Promise((accept,reject)=>{
   const req=(u.protocol==='https:'?https:http).request(u,{method:'HEAD',agent:false,signal,lookup:(_host,options,cb)=>options.all?cb(null,[selected]):cb(null,selected.address,selected.family),headers:{'user-agent':'CoAgent-Security-S1/1.0','accept':'*/*'},maxHeaderSize:16384},res=>{
    const value={url:u.href,status:res.statusCode,...auditHeaders(res.headers),location:res.headers.location,httpVersion:res.httpVersion,redirect:auditRedirect(res.headers.location),body:{capture:'not-collected',reason:'HEAD'},capture:'application-response-headers',outcome:'response'};res.destroy();accept(value);
   });req.on('error',reject);req.setTimeout(config.budget.timeoutMs,()=>req.destroy(new Error('请求超时')));req.end();
  });}catch(error){await record({url:u.href,address:selected.address,outcome:signal.aborted?'aborted':'network-error',durationMs:Math.round(performance.now()-started),capture:'no-response-headers',errorCode:/^[A-Z0-9_]{1,64}$/.test(error.code||'')?error.code:'REQUEST_FAILED',body:{capture:'not-collected',reason:'no-response'}});throw error;}
  const {location,...evidence}=response;await record({...evidence,address:selected.address,durationMs:Math.round(performance.now()-started)});
  if([301,302,303,307,308].includes(response.status)&&location){if(hop===5)throw new Error('重定向次数超过上限');try{target=new URL(location,u).href;}catch{throw new Error('重定向地址错误');}continue;}
  return evidence;
 }
}

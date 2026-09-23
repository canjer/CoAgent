import {readdir,open,constants} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const pattern=/^([0-9a-f-]{36})\.(intent|result)\.json$/;
const outcomes=new Set(['prepared','transport-completed','provider-error','failed','cancelled-or-timeout']);
async function readRecord(directory,name,id,phase){
 const handle=await open(join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size>16384)throw Error('invalid audit file');
  const buffer=Buffer.alloc(16385);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>16384)throw Error('oversize');
  const v=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
  if(v.version!==1||v.requestId!==id||v.phase!==phase||!outcomes.has(v.outcome)||(phase==='intent'?v.outcome!=='prepared':v.outcome==='prepared')||!['responses','chat-completions'].includes(v.protocol)||!Number.isFinite(Date.parse(v.time)))throw Error('invalid record');
  const clean={requestId:id,phase,time:v.time,protocol:v.protocol,outcome:v.outcome};
  for(const key of ['gatewaySessionId','providerFingerprint'])if(typeof v[key]==='string'&&/^[a-f0-9-]{1,64}$/.test(v[key]))clean[key]=v[key];
  clean.context={};for(const key of ['workspaceHash','threadId','turnId'])if(typeof v.context?.[key]==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v.context[key]))clean.context[key]=v.context[key];
  if(Number.isFinite(v.durationMs)&&v.durationMs>=0)clean.durationMs=v.durationMs;
  if(Number.isInteger(v.upstreamStatus)&&v.upstreamStatus>=100&&v.upstreamStatus<=599)clean.upstreamStatus=v.upstreamStatus;
  return clean;
 }finally{await handle.close();}
}
export async function listGatewayAudit(userData,workspace,{allProjects=false}={}){
 const directory=join(userData,'audit','model-gateway');let names;
 try{names=await readdir(directory);}catch(e){if(e.code==='ENOENT')return {records:[],unreadable:0,truncated:false};throw Error('审计目录读取失败');}
 const files=names.filter(n=>pattern.test(n));const groups=new Map();let unreadable=0;
 // Bound I/O per refresh. UUID ordering is not chronological; expose truncation explicitly.
 for(const name of files.sort().slice(0,2000)){
  const [,id,phase]=name.match(pattern);try{const row=await readRecord(directory,name,id,phase);const group=groups.get(id)||{requestId:id};group[phase]=row;groups.set(id,group);}catch{unreadable++;}
 }
 const hash=workspace?createHash('sha256').update(workspace).digest('hex'):null;
 const records=[...groups.values()].filter(g=>allProjects||(hash&&(g.intent||g.result).context.workspaceHash===hash)).map(g=>({...g,time:(g.intent||g.result).time,outcome:g.result?.outcome||'unrecorded'})).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));
 return {records:records.slice(0,100),unreadable,truncated:files.length>2000||records.length>100};
}

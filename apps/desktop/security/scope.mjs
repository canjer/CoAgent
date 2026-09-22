import {BlockList,isIP} from 'node:net';
import {domainToASCII} from 'node:url';
import {publicAddress} from '../browser-policy.mjs';
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
function address(value){return value.replace(/^\[|\]$/g,'');}
function rule(v){
 if(!v||typeof v.host!=='string')throw new Error('目标规则需要 host');
 let host=v.host.trim().toLowerCase();
 if(host.includes('/')){
  const [ip,bits,...extra]=host.split('/');const family=isIP(ip);
  if(extra.length||!family||!/^\d+$/.test(bits)||!integer(+bits,0,family===4?32:128))throw new Error('CIDR 格式错误');
  host=ip+'/'+Number(bits);
 }else if(!isIP(address(host))){
  const wildcard=host.startsWith('*.');host=domainToASCII(wildcard?host.slice(2):host).replace(/\.$/,'');
  if(!host||host.length>253||!host.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s)))throw new Error('域名格式错误');
  host=(wildcard?'*.':'')+host;
 }else host=address(host);
 const protocols=v.protocols??['https'];const ports=v.ports??[443];const path=v.path??'/';
 if(!Array.isArray(protocols)||!protocols.length||protocols.some(p=>!['http','https'].includes(p)))throw new Error('协议仅支持 http/https');
 if(!Array.isArray(ports)||!ports.length||ports.length>32||ports.some(p=>!integer(p,1,65535)))throw new Error('端口列表错误');
 if(typeof path!=='string'||!path.startsWith('/')||path.length>2048||/[?#%\\\x00-\x1f]/.test(path)||path.split('/').some(s=>s==='.'||s==='..'))throw new Error('路径前缀错误');
 return {host,protocols:[...new Set(protocols)],ports:[...new Set(ports)],path:path==='/'?'/':path.replace(/\/$/,'')};
}
export const defaultEngagement=()=>({version:1,enabled:false,targets:[],exclude:[],tools:['http-head'],budget:{maxRequests:30,requestsPerSecond:1,concurrency:1,timeoutMs:10000,maxDurationMs:60000},startsAt:null,expiresAt:null});
export function engagementSchema(v){
 if(!v||v.version!==1||typeof v.enabled!=='boolean'||!Array.isArray(v.targets)||v.targets.length>100||!Array.isArray(v.exclude)||v.exclude.length>100)throw new Error('测试配置格式错误');
 if(v.enabled&&!v.targets.length)throw new Error('启用前请添加目标范围');
 if(!Array.isArray(v.tools)||v.tools.some(t=>t!=='http-head')||!v.tools.length)throw new Error('未知测试工具');
 const b=v.budget;
 if(!b||!integer(b.maxRequests,1,1000)||typeof b.requestsPerSecond!=='number'||!Number.isFinite(b.requestsPerSecond)||b.requestsPerSecond<0.1||b.requestsPerSecond>10||b.concurrency!==1||!integer(b.timeoutMs,100,60000)||!integer(b.maxDurationMs,100,3600000))throw new Error('执行预算格式错误（首版串行）');
 for(const key of ['startsAt','expiresAt'])if(v[key]!=null&&(typeof v[key]!=='string'||!Number.isFinite(Date.parse(v[key]))))throw new Error('时间窗口错误');
 if(v.startsAt&&v.expiresAt&&Date.parse(v.startsAt)>=Date.parse(v.expiresAt))throw new Error('时间窗口顺序错误');
 return {version:1,enabled:v.enabled,targets:v.targets.map(rule),exclude:v.exclude.map(rule),tools:[...new Set(v.tools)],budget:{...b},startsAt:v.startsAt??null,expiresAt:v.expiresAt??null};
}
function hostMatches(pattern,host){
 host=address(host).toLowerCase().replace(/\.$/,'');
 if(pattern.includes('/')){const [ip,bits]=pattern.split('/');const family=isIP(ip);if(isIP(host)!==family)return false;const list=new BlockList();list.addSubnet(ip,+bits,family===4?'ipv4':'ipv6');return list.check(host,family===4?'ipv4':'ipv6');}
 if(pattern.startsWith('*.'))return host.endsWith(pattern.slice(1))&&host!==pattern.slice(2);
 if(isIP(pattern)){if(isIP(pattern)!==isIP(host))return false;const list=new BlockList();list.addAddress(pattern,isIP(pattern)===4?'ipv4':'ipv6');return list.check(host,isIP(pattern)===4?'ipv4':'ipv6');}
 return pattern===host;
}
function matches(r,u,host=u.hostname){const path=decodeURIComponent(u.pathname);return r.protocols.includes(u.protocol.slice(0,-1))&&r.ports.includes(+(u.port|| (u.protocol==='https:'?443:80)))&&(r.path==='/'||path===r.path||path.startsWith(r.path+'/'))&&hostMatches(r.host,host);}
export function checkScope(config,value,{now=Date.now(),addresses}={}){
 if(!config.enabled)throw new Error('安全测试尚未启用');
 if(config.startsAt&&now<Date.parse(config.startsAt)||config.expiresAt&&now>=Date.parse(config.expiresAt))throw new Error('测试不在允许的时间窗口内');
 let u;try{u=new URL(value);}catch{throw new Error('目标 URL 格式错误');}
 if(value.length>8192||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||/%(?:2f|5c|25|00)/i.test(u.pathname))throw new Error('首版目标仅支持无凭据、无查询参数的 HTTP(S) URL');
 try{if(/[\\\x00-\x1f\x7f]/.test(decodeURIComponent(u.pathname)))throw new Error('控制字符');}catch{throw new Error('目标路径编码错误');}
 if(!config.targets.some(r=>matches(r,u))||config.exclude.some(r=>matches(r,u)))throw new Error('目标超出范围或命中排除项');
 if(addresses){
  if(!addresses.length)throw new Error('DNS 无地址');
  for(const {address:ip} of addresses){
   if(!isIP(ip)||config.exclude.some(r=>matches(r,u,ip)))throw new Error('解析地址命中排除项');
   if(!publicAddress(ip)&&!config.targets.some(r=>(isIP(r.host)||r.host.includes('/'))&&matches(r,u,ip)))throw new Error('非公网解析地址需要明确的 IP/CIDR 授权');
  }
 }
 return u;
}

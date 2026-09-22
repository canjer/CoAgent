import {browserTools} from './browser-policy.mjs';
export function approvalTool(request){
 if(request?.serverName!=='browser'||request?._meta?.codex_approval_kind!=='mcp_tool_call')return null;
 const name=request.message?.match(/^Allow the browser MCP server to run tool "([a-z_]+)"\?$/)?.[1];
 return browserTools.some(t=>t.name===name)?name:null;
}
export class BrowserApprovalScope {
 constructor(){this.clear();}
 clear(){this.all=false;this.similar=new Set();}
 key(name,args,currentOrigin){let origin=currentOrigin;try{if(name==='browser_navigate')origin=new URL(args.url).origin;}catch{return null;}return origin?JSON.stringify([name,origin]):null;}
 allow(mode,name,args,origin){if(mode==='task-browser')this.all=true;else if(mode==='task-similar'){const key=this.key(name,args,origin);if(!key)throw new Error('站点尚未确定，请仅允许此次操作');this.similar.add(key);}else if(mode!=='once')throw new Error('未知审批范围');}
 matches(name,args,origin){const key=this.key(name,args,origin);return this.all||!!key&&this.similar.has(key);}
 state(){return {all:this.all,similarCount:this.similar.size};}
}

// Element actions stay individually reviewed: page labels cannot grant authority.
export function browserActionRisk(name,args={}){
 if(name==='browser_snapshot'||name==='browser_close')return 'read';
 if(name==='browser_navigate'){
  return ordinaryLink(args.url)?'navigation':'review';
 }
 // Reload/back can replay requests or revisit action URLs.
 return 'review';
}

export function ordinaryLink(url){
 try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return false;
 const value=decodeURIComponent(u.pathname+u.search+u.hash);
 if(/(?:delete|remove|logout|unsubscribe|confirm|callback|oauth|authorize|payment|checkout|purchase|reset|password|secret|token|api.?key|email|phone|address|invite|accept|cancel|submit|login|sign.?in|captcha|verify|session)/i.test(value))return false;
 for(const [key,val] of u.searchParams){if(!['page','p','sort','order','lang','locale','tab','category'].includes(key)||val.length>64||!/^[-\w.]*$/.test(val))return false;}
 return true;}catch{return false;}
}

import React,{useEffect,useRef,useState} from 'react';
import {addressTarget} from './browser-address.mjs';
const api=window.coagent;
function title(url){try{return new URL(url).hostname||'网页';}catch{return '网页';}}
export function BrowserPanel({obscured}){
 const [confirm,C]=useState(null),[state,S]=useState({}),[url,U]=useState(''),[local,L]=useState(false),[error,E]=useState(''),[loading,B]=useState(false);const slot=useRef(null);
 useEffect(()=>{api.call('browser:state').then(S);return api.subscribe(({method,params})=>{if(method==='browser/state')S(params);});},[]);
 useEffect(()=>{if(state.url)U(state.url);},[state.url]);
 useEffect(()=>{
  const update=()=>{const r=slot.current?.getBoundingClientRect();if(r)api.call('browser:layout',{visible:!obscured&&!confirm,x:r.x,y:r.y,width:r.width,height:r.height}).catch(e=>E(e.message));};
  update();const observer=new ResizeObserver(update);if(slot.current)observer.observe(slot.current);window.addEventListener('resize',update);
  return()=>{observer.disconnect();window.removeEventListener('resize',update);void api.call('browser:layout',{visible:false,x:0,y:0,width:0,height:0});};
 },[obscured,state.open,confirm]);
 async function call(method,args){E('');B(true);try{await api.call(method,args);}catch(e){E(e.message);}finally{B(false);}}
 const locked=loading||state.active&&!state.paused;
 return <div className="browser-panel">

  <div className="browser-toolbar"><button disabled={locked} onClick={()=>call('browser:back')} aria-label="后退">←</button><button disabled={locked} onClick={()=>call('browser:reload')} aria-label="刷新">↻</button><form className="browser-address" onSubmit={e=>{e.preventDefault();const target=addressTarget(url);if(target){U(target);call('browser:navigate',{url:target,allowLocal:local});}}}><span>◉</span><input aria-label="浏览器地址" placeholder="搜索或输入网址" value={url} onChange={e=>U(e.target.value)}/><button aria-label="打开" disabled={locked}>↗</button></form><button aria-label={state.paused?'交还 Agent':'接管'} onClick={()=>call(state.paused?'browser:resume':'browser:takeover')} title={state.paused?'交还 Agent':'接管浏览器'}>{state.paused?'◇':'◌'}</button></div>
  <div className="browser-meta"><span>{state.approvalScope?.all?'本次任务完全授权':state.approvalScope?.similarCount?`同类授权 ${state.approvalScope.similarCount} 类`:state.paused?'用户接管':'Agent 控制'}</span><label><input aria-label="允许本机 HTTP" type="checkbox" checked={local} onChange={e=>L(e.target.checked)}/> 本机 HTTP</label><details className="browser-diagnostics"><summary>诊断 · {({idle:'未加载',loading:'加载中',loaded:'主文档已加载',failed:'加载失败'})[state.diagnostics?.status]||'未加载'} · {state.diagnostics?.totalBlocked||0}</summary><p>仅展示资源域，不含路径、查询参数或凭据。</p>{state.diagnostics?.error&&<p>{state.diagnostics.error}</p>}{state.diagnostics?.blocked?.map((r,i)=><div key={i}><code>{r.origin}</code><small>{r.resourceType} · {r.reason} · {r.count} 次</small>{r.reason==='cross-origin'&&['script','stylesheet','image','font'].includes(r.resourceType)&&!state.resourceGrants?.some(g=>g.origin===r.origin&&g.type===r.resourceType)&&<button aria-label="授权此资源类型" disabled={locked} onClick={()=>C({origin:r.origin,type:r.resourceType,allow:true})}>授权</button>}</div>)}{state.resourceGrants?.map(g=><div key={g.origin+g.type}><code>{g.origin}</code><small>已授权 · {g.type} · 当前临时会话</small><button aria-label="撤销授权" disabled={locked} onClick={()=>C({...g,allow:false})}>撤销</button></div>)}{state.diagnostics?.truncated&&<p>仅保留前 40 类，计数仍继续。</p>}</details></div>
  {confirm&&<div className="approval" role="alert"><strong>{confirm.allow?'确认授权资源':'确认撤销授权'}</strong><p>{confirm.origin}<br/>{confirm.type}</p><p>仅当前临时网页会话；关闭或跨站导航后失效。</p><button onClick={()=>C(null)}>取消授权变更</button><button aria-label="确认资源变更" onClick={async()=>{await call('browser:resource-grant',confirm);C(null);}}>确认</button></div>}{error&&<p role="alert" className="error">{error}</p>}<div className="browser-slot" ref={slot}>{obscured?<p>网页在弹窗或审批期间隐藏</p>:<p>{state.open?'网页加载中…':'输入地址，或让 Agent 使用浏览器工具。'}</p>}</div>
 </div>;
}

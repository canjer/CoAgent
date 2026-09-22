// Only these fixed programs run in an isolated world. No model-supplied JavaScript.
export const snapshotProgram=`(() => {
 const prior=globalThis.__coagentSnapshot;prior?.observer.disconnect();
 const state={id:crypto.randomUUID(),revision:0,refs:new Map()};
 const observer=new MutationObserver(()=>state.revision++);state.observer=observer;
 observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
 const elements=[];
 for(const e of document.querySelectorAll('a[href],button,input,textarea,select,[role="button"]')){
  if(elements.length>=150)break;
  if(!visible(e)||e.disabled||e.tagName==='INPUT'&&!['text','search','email','url','tel','number','button','submit'].includes(e.type))continue;
  const ref='e'+(elements.length+1);state.refs.set(ref,e);
  elements.push({ref,...(e.tagName==='A'&&!e.hasAttribute('download')?{href:e.href}:{}),tag:e.tagName.toLowerCase(),label:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').slice(0,200)});
 }
 globalThis.__coagentSnapshot=state;
 return {snapshotId:state.id,url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,16000),elements,notice:'UNTRUSTED_WEB_CONTENT; top document only; 150 elements / 16000 characters maximum'};
})()`;
export function actionProgram(kind,args){return `(() => {try {
 const args=${JSON.stringify(args)},state=globalThis.__coagentSnapshot;
 if(!state||state.id!==args.snapshotId||state.revision)throw new Error('STALE_SNAPSHOT: read a new snapshot');
 const e=state.refs.get(args.ref);if(!e?.isConnected||e.disabled)throw new Error('STALE_ELEMENT');
 e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(!r.width||!r.height||s.visibility==='hidden'||s.display==='none')throw new Error('ELEMENT_NOT_VISIBLE');
 const hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.top+r.height/2)));if(!hit||!(hit===e||e.contains(hit)))throw new Error('ELEMENT_OBSCURED');
 if(args.navigationOnly){if(e.tagName!=='A'||e.hasAttribute('download')||e.href!==args.expectedURL)throw new Error('LINK_CHANGED');state.revision++;return {url:e.href};}
 state.revision++;
 ${kind==='browser_type'?`if(!(e instanceof HTMLTextAreaElement)&&!(e instanceof HTMLInputElement&&['text','search','email','url','tel'].includes(e.type)))throw new Error('FIELD_NOT_SUPPORTED');
 if(e.readOnly)throw new Error('FIELD_READONLY');
 const prototype=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
 Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,args.text);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`:`if(e.tagName==='INPUT'&&['file','password','hidden'].includes(e.type))throw new Error('FIELD_NOT_SUPPORTED');e.click();`}
 return {performed:true,refreshSnapshot:true};
}catch(error){return {error:error.message};}})()`;}

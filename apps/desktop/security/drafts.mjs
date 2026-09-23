import {randomUUID} from 'node:crypto';import {resolve} from 'node:path';import {defaultEngagement,engagementSchema,checkScope} from './scope.mjs';
/** A deliberately narrow intake: explicit URL -> reviewable proposal, never inferred authorization. */
export class SecurityDrafts{
 constructor(){this.current=null;}
 prepare(workspace,prompt,now=Date.now()){
  this.current=null;
  if(!workspace)throw new Error('请先选择项目文件夹');
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>20000)throw new Error('请输入测试目标说明');
  const urls=[...new Set((prompt.match(/https?:\/\/[^\s<>"'`，。；、（）]+/gi)||[]).map(s=>s.replace(/[),;.!?]+$/,'')))];
  if(urls.length!==1)throw new Error('首版请在对话中提供一个明确的 HTTP(S) URL；多个目标请分次确认');
  const u=new URL(urls[0]);const config=engagementSchema({...defaultEngagement(),enabled:true,targets:[{host:u.hostname,protocols:[u.protocol.slice(0,-1)],ports:[+(u.port||(u.protocol==='https:'?443:80))],path:decodeURIComponent(u.pathname)}],expiresAt:new Date(now+15*60000).toISOString()});checkScope(config,u.href,{now});
  this.current={id:randomUUID(),workspace:resolve(workspace),objective:prompt,urls:[u.href],config,createdAt:new Date(now).toISOString(),expiresAt:config.expiresAt,profile:'security-head-v1',tool:'http-head',status:'awaiting-confirmation'};
  return structuredClone(this.current);
 }
 consume(workspace,id,now=Date.now()){
  const draft=this.current;if(!draft||draft.id!==id||draft.workspace!==resolve(workspace)||now>=Date.parse(draft.expiresAt))throw new Error('测试确认卡已过期或项目已变化，请重新生成');
  this.current=null;return structuredClone(draft);
 }
 cancel(id){if(this.current?.id===id)this.current=null;return true;}
}

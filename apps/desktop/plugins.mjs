import {join,isAbsolute} from 'node:path';
import {JsonStore} from './storage.mjs';
const text=(v,n=2048)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\x00-\x1f\x7f]/.test(v);
export function pluginSchema(value){
 if(value?.version!==1||typeof value.browserEnabled!=='boolean'||!Array.isArray(value.servers)||value.servers.length>12)throw new Error('插件配置格式错误');
 const ids=new Set(['browser']);
 const servers=value.servers.map(s=>{
  if(!s||!text(s.id,48)||!/^[-a-zA-Z0-9_]+$/.test(s.id)||ids.has(s.id)||typeof s.enabled!=='boolean')throw new Error('MCP 名称重复或格式错误');ids.add(s.id);
  if(s.transport==='stdio'){
   if(!text(s.command)||!isAbsolute(s.command)||!Array.isArray(s.args)||s.args.length>32||s.args.some(a=>typeof a!=='string'||a.length>4096||/[\x00-\x1f\x7f]/.test(a)))throw new Error('MCP 需要绝对命令路径和 JSON 字符串参数数组');
   return {id:s.id,enabled:s.enabled,transport:'stdio',command:s.command,args:s.args};
  }
  if(s.transport==='http'){
   let u;try{u=new URL(s.url);}catch{throw new Error('MCP URL 格式错误');}
   if(!text(s.url)||u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new Error('MCP 需要 HTTPS 或本机 HTTP 地址，不含凭据及查询参数');
   return {id:s.id,enabled:s.enabled,transport:'http',url:u.href};
  }
  throw new Error('未知 MCP 传输类型');
 });return {version:1,browserEnabled:value.browserEnabled,servers};
}
export class PluginRegistry{
 constructor(dir){this.store=new JsonStore(join(dir,'plugins.json'),pluginSchema,{version:1,browserEnabled:false,servers:[]});}
 async read(){return this.store.read();}
 async save(value){return this.store.write(pluginSchema(value));}
}
export function mcpConfig(value,{executable,cli,socketDir,browserUrl}){
 const settings=pluginSchema(value);const servers=settings.servers.filter(s=>s.enabled);
 if(settings.browserEnabled)servers.unshift(browserUrl?{id:'browser',transport:'http',url:browserUrl,bearer:true}:{id:'browser',transport:'stdio',command:executable,args:[cli,'--browser','chrome','--isolated','--headless'],env:{ELECTRON_RUN_AS_NODE:'1',...(socketDir?{PWTEST_SOCKETS_DIR:socketDir}:{})}});
 return servers.map(s=>{
  const lines=[`[mcp_servers.${s.id}]`,'enabled = true','startup_timeout_sec = 15','tool_timeout_sec = 45','default_tools_approval_mode = "prompt"'];
  if(s.transport==='http'){lines.push(`url = ${JSON.stringify(s.url)}`);if(s.bearer)lines.push('bearer_token_env_var = "COAGENT_BROWSER_TOKEN"');}
  else {lines.push(`command = ${JSON.stringify(s.command)}`,`args = ${JSON.stringify(s.args)}`);if(s.env)lines.push('env = { '+Object.entries(s.env).map(([k,v])=>k+' = '+JSON.stringify(v)).join(', ')+' }');}
  // Browser v1 exposes ref-based interaction, not arbitrary page JavaScript or installation commands.
  if(s.id==='browser')lines.push('enabled_tools = ["browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_press_key", "browser_select_option", "browser_tabs", "browser_navigate_back", "browser_close", "browser_reload"]');
  return lines.join('\n');
 }).join('\n\n')+'\n';
}

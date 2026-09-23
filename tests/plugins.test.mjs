import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pluginSchema,PluginRegistry,mcpConfig} from '../apps/desktop/plugins.mjs';
import {validateProvider} from '../apps/desktop/providers.mjs';
const empty={version:1,browserEnabled:false,servers:[]};
test('MCP validation: explicit transports, no shell parsing, URL and config injection boundaries',()=>{
 const server={id:'example',enabled:true,transport:'stdio',command:'/usr/bin/node',args:['/tmp/server.js']};
 assert.equal(pluginSchema({...empty,servers:[server]}).servers[0].command,server.command);
 for(const change of [{id:'browser'},{id:'bad]\n[other'},{command:'node'},{args:['bad\narg']},{transport:'sse'}])assert.throws(()=>pluginSchema({...empty,servers:[{...server,...change}]}));
 for(const url of ['http://remote.example/mcp','https://user:pass@example.com','https://example.com/?token=x','file:///tmp/a'])assert.throws(()=>pluginSchema({...empty,servers:[{id:'http',enabled:false,transport:'http',url}]}));
 assert.throws(()=>pluginSchema({...empty,servers:[server,server]}));
 assert.match(mcpConfig({...empty,browserEnabled:true},{executable:'/path/Electron',cli:'/app/cli.js'}),/default_tools_approval_mode = "prompt"/);
 assert.doesNotMatch(mcpConfig(empty,{}),/mcp_servers/);
});
test('MCP registry persists opt-in and deletion across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'coagent-plugins-'));try{
 const r=new PluginRegistry(dir);assert.deepEqual(await r.read(),empty);
 await r.save({...empty,browserEnabled:true});assert.equal((await new PluginRegistry(dir).read()).browserEnabled,true);
 await r.save(empty);assert.deepEqual(await r.read(),empty);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('API family validates DeepSeek Chat and migrates legacy OpenAI profiles without endpoint changes',()=>{
 const base={id:'custom-'+'a'.repeat(32),label:'Test',upstreamModel:'custom-model',baseUrl:'https://example.com/v1',protocol:'responses'};
 assert.equal(validateProvider(base).apiStyle,'openai');assert.equal(validateProvider(base).protocol,'responses');
 assert.equal(validateProvider({...base,apiStyle:'deepseek',protocol:'chat-completions'}).apiStyle,'deepseek');
 assert.equal(validateProvider({...base,apiStyle:'deepseek',upstreamModel:'deepseek-flash'}).protocol,'responses');assert.throws(()=>validateProvider({...base,apiStyle:'anthropic'}));
 assert.ok(!('apiKey' in validateProvider({...base,apiKey:'not-stored'})));
});

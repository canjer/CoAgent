import test from 'node:test';
import assert from 'node:assert/strict';
import {browserURL,publicAddress,validateBrowserArgs,browserTools,canonical} from '../apps/desktop/browser-policy.mjs';
import {mcpConfig} from '../apps/desktop/plugins.mjs';
test('shared browser URL policy is HTTPS default and explicit exact loopback only',()=>{
 assert.equal(browserURL('https://example.com/').origin,'https://example.com');assert.equal(browserURL('http://127.0.0.1:1234',true).port,'1234');
 for(const url of ['file:///etc/passwd','javascript:alert(1)','data:text/html,hi','http://example.com','https://user:pass@example.com','https://127.0.0.1','https://10.0.0.1','https://[::ffff:127.0.0.1]'])assert.throws(()=>browserURL(url));
 assert.throws(()=>browserURL('http://192.168.1.1',true));
});
test('browser rejects nonpublic DNS answers and private IPv6',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.2.3','192.168.1.1','169.254.169.254','100.64.1.2','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2002:7f00:1::'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('browser only fixed bounded tool arguments; no evaluate or selector execution',()=>{
 assert.equal(browserTools.length,7);assert.throws(()=>validateBrowserArgs('browser_evaluate',{script:'1'}));
 assert.throws(()=>validateBrowserArgs('browser_click',{snapshotId:'x',ref:'e1',script:'1'}));
 assert.throws(()=>validateBrowserArgs('browser_type',{snapshotId:'x',ref:'e1',text:'x'.repeat(10001)}));
 assert.throws(()=>validateBrowserArgs('browser_navigate',{url:'https://example.com',allowLocal:'true'}));
 assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));
});
test('desktop embedded MCP uses private bearer environment, no Chrome command',()=>{
 const config=mcpConfig({version:1,browserEnabled:true,servers:[]},{browserUrl:'http://127.0.0.1:123/mcp'});
 assert.match(config,/bearer_token_env_var = "COAGENT_BROWSER_TOKEN"/);assert.match(config,/default_tools_approval_mode = "prompt"/);assert.doesNotMatch(config,/command =|chrome|headless/);assert.match(config,/browser_reload/);
});

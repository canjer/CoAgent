import test from 'node:test';
import assert from 'node:assert/strict';
import {getModelProfile,providerFor} from '../packages/model-gateway/src/profiles.js';
test('official Qwen profile uses distinct env and rejects unknown model IDs',()=>{
 const profile=getModelProfile('qwen3.5-flash');
 assert.equal(profile.baseUrl,'https://dashscope.aliyuncs.com/compatible-mode/v1');
 assert.equal(providerFor(profile,{QWEN_API_KEY:'qwen-fixture',DEEPSEEK_API_KEY:'deepseek-fixture'}).apiKey,'qwen-fixture');
 assert.throws(()=>providerFor(profile,{DEEPSEEK_API_KEY:'unrelated'}),/QWEN_API_KEY/);
 assert.throws(()=>getModelProfile('__proto__'),/Unknown/);
});

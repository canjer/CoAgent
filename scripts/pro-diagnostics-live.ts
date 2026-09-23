import {diagnoseProvider} from '../packages/model-gateway/src/diagnostics.js';
if(!process.env.DEEPSEEK_API_KEY)throw Error('DEEPSEEK_API_KEY missing');
let passed=true;
for(const model of ['deepseek-v4-pro','deepseek-flash'])for(const protocol of ['responses','chat-completions'] as const){
 const r=await diagnoseProvider({protocol,baseUrl:'https://api.deepseek.com',alias:'diagnostic-test',upstreamModel:model,apiKey:process.env.DEEPSEEK_API_KEY},45000);console.log(JSON.stringify(r));passed&&=r.passed;
}
console.log('DEEPSEEK_DIAGNOSTICS='+String(passed?'PASS':'FAIL'));process.exitCode=passed?0:1;

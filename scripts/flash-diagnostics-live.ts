import {diagnoseProvider} from '../packages/model-gateway/src/diagnostics.js';
if(!process.env.DEEPSEEK_API_KEY)throw Error('DEEPSEEK_API_KEY missing');
let passed=true;
for(const protocol of ['responses','chat-completions'] as const){
 const result=await diagnoseProvider({protocol,baseUrl:'https://api.deepseek.com',alias:'flash-test',upstreamModel:'deepseek-flash',apiKey:process.env.DEEPSEEK_API_KEY},45000);
 console.log(JSON.stringify(result));passed&&=result.passed;
}
console.log('FLASH_DIAGNOSTICS='+String(passed?'PASS':'FAIL'));process.exitCode=passed?0:1;

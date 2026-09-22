import {diagnoseProvider} from '../packages/model-gateway/src/diagnostics.js';
import {getModelProfile,providerFor} from '../packages/model-gateway/src/profiles.js';
const profile=getModelProfile(process.env.COAGENT_MODEL||'deepseek-chat');
const result=await diagnoseProvider({...providerFor(profile),protocol:'chat-completions'});
console.log(JSON.stringify(result,null,2));console.log('CHAT_DIAGNOSTICS='+String(result.passed?'PASS':'FAIL'));process.exitCode=result.passed?0:1;

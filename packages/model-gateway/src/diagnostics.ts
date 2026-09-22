import {randomBytes,randomUUID} from 'node:crypto';
import {startGateway,type GatewayOptions} from './server.js';
import {readSse} from './sse.js';
import {object,type Obj} from './chat-adapter.js';
export interface CapabilityCheck {name:string;status:'pass'|'fail'|'skipped';detail:string}
/** Three synthetic requests, no files or commands. Never return provider content or keys. */
export async function diagnoseProvider(provider:GatewayOptions['provider'],timeoutMs=15000){
 const checks:CapabilityCheck[]=[],token=randomBytes(32).toString('hex');
 const gateway=await startGateway({token,provider,timeoutMs});
 const invoke=async(input:Obj[],tools:Obj[]=[],tool_choice:unknown='auto')=>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(gateway.baseUrl+'/responses',{method:'POST',signal:controller.signal,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({model:provider.alias,input,stream:true,store:false,tools,tool_choice,max_output_tokens:256})});
   if(!response.ok){await response.body?.cancel();throw new Error('HTTP '+response.status);}
   if(!response.headers.get('content-type')?.includes('text/event-stream')){await response.body?.cancel();throw new Error('EXPECTED_SSE');}
   let completed:Obj|undefined,delta=false,count=0,bytes=0;
   for await(const raw of readSse(response.body!)){
    bytes+=Buffer.byteLength(raw);if(bytes>2*1024*1024)throw new Error('OUTPUT_LIMIT');if(raw==='[DONE]')continue;if(++count>10000)throw new Error('EVENT_LIMIT');const e=object(JSON.parse(raw));
    if(e.type==='response.output_text.delta'&&typeof e.delta==='string'&&e.delta)delta=true;
    if(e.type==='response.failed'||e.type==='response.incomplete')throw new Error('INCOMPLETE');
    if(e.type==='response.completed'){if(completed)throw new Error('DUPLICATE_TERMINAL');completed=object(e.response);}
   }
   if(!completed||completed.status!=='completed'||!Array.isArray(completed.output))throw new Error('MISSING_COMPLETION');
   return {output:completed.output as Obj[],delta};
  }finally{clearTimeout(timer);}
 };
 const failure=(e:unknown)=>e instanceof Error&&/^HTTP \d{3}$/.test(e.message)?e.message:'协议、输出校验失败或请求超时（未记录上游内容）';
 try{
  try{const r=await invoke([{role:'user',content:'Reply exactly DIAGNOSTIC_OK.'}],[],'none');if(!r.delta)throw new Error('NO_TEXT_DELTA');checks.push({name:'流式文本与终止事件',status:'pass',detail:'收到文本增量和 completed'});}catch(e){checks.push({name:'流式文本与终止事件',status:'fail',detail:failure(e)});}
  const tools=[{type:'function',name:'diagnostic_echo',description:'Synthetic diagnostic tool; no external side effects.',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}];
  const input:Obj[]=[{role:'user',content:'Call diagnostic_echo once with value "probe". Do not answer in text.'}];
  let output:Obj[]|undefined,call:Obj|undefined;
  try{output=(await invoke(input,tools,{type:'function',name:'diagnostic_echo'})).output;const calls=output.filter(x=>x.type==='function_call');call=calls[0];if(calls.length!==1||call?.name!=='diagnostic_echo'||typeof call.call_id!=='string'||!call.call_id||typeof call.arguments!=='string'||object(JSON.parse(call.arguments)).value!=='probe')throw new Error('INVALID_TOOL');checks.push({name:'工具调用与完整 JSON 参数',status:'pass',detail:'唯一工具调用及参数校验通过；未执行系统工具'});}catch(e){checks.push({name:'工具调用与完整 JSON 参数',status:'fail',detail:failure(e)});}
  if(call&&checks.at(-1)?.status==='pass'){
   const nonce='RESULT_'+randomUUID();
   try{const r=await invoke([...input,...output!,{type:'function_call_output',call_id:call.call_id,output:nonce},{role:'user',content:'Reply with the exact tool result, without calling tools.'}],tools,'none');const texts=r.output.filter(x=>x.type==='message').flatMap(x=>Array.isArray(x.content)?x.content:[]).map(x=>(x as Obj).text).join('');if(!r.delta||!texts.includes(nonce)||r.output.some(x=>x.type==='function_call'))throw new Error('TOOL_RESULT_NOT_USED');checks.push({name:'工具结果续接',status:'pass',detail:'正确返回本次随机工具结果'});}catch(e){checks.push({name:'工具结果续接',status:'fail',detail:failure(e)});}
  }else checks.push({name:'工具结果续接',status:'skipped',detail:'工具调用未通过'});
  return {model:provider.upstreamModel,protocol:provider.protocol,checkedAt:new Date().toISOString(),checks,passed:checks.every(x=>x.status==='pass'),scope:'synthetic-protocol-probes-not-full-agent-certification',limitations:['未验证取消、审批、多模态、并行工具和完整任务质量','Chat 路径不支持 reasoning 内容或摘要；非文本扩展仍明确报错']};
 }finally{await gateway.close();}
}

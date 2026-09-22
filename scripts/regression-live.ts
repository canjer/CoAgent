import { getModelProfile, providerFor } from '../packages/model-gateway/src/profiles.js';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexClient } from '../packages/runtime-codex/src/client.js';
import { CodexRuntime } from '../packages/runtime-codex/src/runtime.js';
import { isolatedEnvironment, codexLauncher } from '../packages/runtime-codex/src/environment.js';
import { startGateway } from '../packages/model-gateway/src/server.js';
const cases = [
 ['copy','Copy input.txt to result.txt exactly.','hello\n','hello\n'],
 ['uppercase','Convert input.txt to uppercase in result.txt.','alpha beta\n','ALPHA BETA\n'],
 ['sort','Sort input.txt lines alphabetically into result.txt.','zebra\napple\nmango\n','apple\nmango\nzebra\n'],
 ['deduplicate','Remove duplicate lines preserving order into result.txt.','a\nb\na\nb\nc\n','a\nb\nc\n'],
 ['sum','Sum integers in input.txt; write only the sum and newline to result.txt.','12\n-4\n7\n','15\n'],
 ['filter','Copy only lines containing ERROR to result.txt.','INFO ok\nERROR one\nWARN no\nERROR two\n','ERROR one\nERROR two\n'],
 ['replace','Replace all OLD with NEW in result.txt, preserve other text.','OLD and OLD\nkeep\n','NEW and NEW\nkeep\n'],
 ['reverse','Reverse line order into result.txt.','one\ntwo\nthree\n','three\ntwo\none\n'],
 ['unicode','Copy input.txt to the file 中文 空格.txt and result.txt exactly.','你好，世界🌍\n','你好，世界🌍\n'],
 ['json','Read JSON input.txt, write its name value with newline to result.txt.','{"name":"coAgent","n":2}\n','coAgent\n'],
 ['csv','Sum the amount column of CSV input.txt; write only sum and newline to result.txt.','name,amount\na,10\nb,25\n','35\n'],
 ['count','Count nonempty lines; write only count and newline to result.txt.','a\n\nb\n\nc\n','3\n'],
 ['trim','Trim whitespace from each input line into result.txt.','  alpha  \n beta \n','alpha\nbeta\n'],
 ['join','Join lines with commas and final newline in result.txt.','a\nb\nc\n','a,b,c\n'],
 ['markdown','Extract Markdown headings without hash prefixes into result.txt.','# Title\ntext\n## Section\n','Title\nSection\n'],
 ['patch','Fix the typo teh to the, writing result.txt.','teh quick fox\n','the quick fox\n'],
 ['nested','Create nested/a.txt containing input.txt and copy it to result.txt.','nested fixture\n','nested fixture\n'],
 ['empty','Create empty result.txt (zero bytes). Input is unrelated.','keep\n',''],
 ['recovery','Run exactly false as a standalone shell tool call (not combined with any other command) and observe its nonzero exit status. Then recover using a separate successful shell tool call to copy input.txt to result.txt.','recovered\n','recovered\n'],
 ['multifile','Split input.txt into one.txt first line and two.txt second line; concatenate them into result.txt.','first\nsecond\n','first\nsecond\n'],
] as const;
const profile=getModelProfile(process.env.COAGENT_MODEL);
const selectedCase=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
const selectedCases=selectedCase?cases.filter(c=>c[0]===selectedCase):cases;
if(!selectedCases.length)throw new Error('Unknown regression case');
const provider=providerFor({...profile,...(process.argv.includes('--chat')?{protocol:'chat-completions' as const}:{})});
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex');
// Every run keeps its own report; Chat never overwrites historical Responses evidence.
const reportName=`AGENT_REGRESSION_${provider.protocol==='chat-completions'?'CHAT_':''}${profile.id}${selectedCase?`_${selectedCase}`:''}.json`;
const reportPath=join('docs','regression-runs',runId,reportName);
await mkdir(join('docs','regression-runs',runId),{recursive:true});
console.log(JSON.stringify({runId,model:profile.id,protocol:provider.protocol,reportPath,total:selectedCases.length}));
const token=randomBytes(32).toString('hex');
const gateway=await startGateway({token,timeoutMs:90000,provider});
const results: object[]=[];
try {
 for(const [id,prompt,input,expected] of selectedCases){
  const env=await isolatedEnvironment(gateway.baseUrl,token,profile.id);
  const client=new CodexClient({command:process.execPath,args:[codexLauncher,'app-server'],cwd:env.cwd,env:env.env});
  const runtime=new CodexRuntime(client); let wait:ReturnType<CodexRuntime['waitForCompletion']>|undefined;
  const start=Date.now(); let denied=0;let phase='initialize';let terminalStatus:string|undefined;let terminalError:unknown;let commandEvidence:{command:string;exitCode:number|null}[]=[];
  client.on('serverRequest',m=>{denied++;client.respond(m.id,{decision:'decline'});});
  try{
   await writeFile(join(env.cwd,'input.txt'),input); await client.initialize();
   const {thread}=await runtime.createSession({cwd:env.cwd,model:profile.id,sandbox:'workspace-write',approvalPolicy:'on-request',baseInstructions:'Complete the local fixture task using tools. Do not use network or access secrets. Preserve input.txt. Verify output with a shell command.'});
   phase='turn';wait=runtime.waitForCompletion(thread.id,120000);
   await runtime.startTurn({threadId:thread.id,input:[{type:'text',text_elements:[],text:prompt}]});
   const done=await wait.result;terminalStatus=done.turn.status;terminalError=done.turn.error?.codexErrorInfo;phase='verify-files';
   const history=await runtime.readSession(thread.id);
   const commands=history.thread.turns.flatMap(t=>t.items).filter(i=>i.type==='commandExecution');
   commandEvidence=commands.map(c=>({command:c.command,exitCode:c.exitCode}));
   const output=await readFile(join(env.cwd,'result.txt'),'utf8');
   const extras = (id!=='unicode'||await readFile(join(env.cwd,'中文 空格.txt'),'utf8')===expected) && (id!=='nested'||await readFile(join(env.cwd,'nested/a.txt'),'utf8')===expected) && (id!=='recovery'||commands.some(c=>c.exitCode!==null && c.exitCode!==0)) && (id!=='multifile'||(await readFile(join(env.cwd,'one.txt'),'utf8')==='first\n' && await readFile(join(env.cwd,'two.txt'),'utf8')==='second\n'));
   const pass=extras && done.turn.status==='completed' && output===expected && await readFile(join(env.cwd,'input.txt'),'utf8')===input && commands.some(c=>c.exitCode===0);
   const result={id,pass,status:done.turn.status,prompt,input,expected,actual:output,commands:commands.length,commandEvidence,denied,ms:Date.now()-start};results.push(result);console.log(JSON.stringify(result));
  }catch(e){const result={id,prompt,input,expected,pass:false,error:e instanceof Error?e.name:'unknown',phase,terminalStatus,terminalError,commandEvidence,denied,fileErrorCode:(e as NodeJS.ErrnoException).code,ms:Date.now()-start};results.push(result);console.log(JSON.stringify(result));}
  finally{wait?.dispose();await client.close();await env.cleanup();}
  await writeFile(reportPath,JSON.stringify({runId,model:profile.id,protocol:provider.protocol,suite:'file-tasks-v1',criteria:'Exact bytes, original input unchanged, completed turn, successful shell command, case-specific extra files or nonzero recovery command; unchanged from Responses suite.',date:new Date().toISOString(),total:selectedCases.length,completed:results.length,passed:results.filter((r:any)=>r.pass).length,results},null,2)+'\n');
 }
}finally{await gateway.close();}
console.log(`REGRESSION=${results.filter((r:any)=>r.pass).length}/${selectedCases.length}`);
if(results.some((r:any)=>!r.pass))process.exitCode=1;

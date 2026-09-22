import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandApprovalScope,commandApprovalKey} from '../apps/desktop/command-approvals.mjs';
const req={method:'item/commandExecution/requestApproval',params:{kind:'command',command:'npm test',cwd:'/workspace',threadId:'t',turnId:'turn',reason:'test',environmentId:null,itemId:'a',startedAtMs:1}};
test('command task grants ignore callback IDs but bind complete command and context',()=>{
 const s=new CommandApprovalScope();s.allow(req);assert.ok(s.matches({...req,params:{...req.params,itemId:'b',startedAtMs:2,approvalId:'new'}}));
 for(const delta of [{command:'npm test -- --update'},{command:'npm test; rm file'},{cwd:'/another'},{environmentId:'remote'},{reason:'network access'},{turnId:'next'},{threadId:'next'},{networkApprovalContext:{host:'new'}},{futurePermission:true}])assert.equal(s.matches({...req,params:{...req.params,...delta}}),false);
 s.clear();assert.equal(s.matches(req),false);
});
test('files, terminal input and malformed requests cannot obtain command scopes',()=>{
 for(const r of [{...req,method:'item/fileChange/requestApproval'},{...req,params:{...req.params,kind:'writeStdin'}},{...req,params:{...req.params,cwd:null}},{method:'mcpServer/elicitation/request'}]){assert.equal(commandApprovalKey(r),null);assert.throws(()=>new CommandApprovalScope().allow(r));}
});

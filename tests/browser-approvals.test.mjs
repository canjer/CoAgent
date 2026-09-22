import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserApprovalScope,approvalTool} from '../apps/desktop/browser-approvals.mjs';
test('similar approval is exact tool and origin, all approval clears explicitly',()=>{
 const s=new BrowserApprovalScope();s.allow('task-similar','browser_navigate',{url:'https://example.com/a'});
 assert.equal(s.matches('browser_navigate',{url:'https://example.com/b'}),true);
 assert.equal(s.matches('browser_navigate',{url:'https://other.example'}),false);
 assert.equal(s.matches('browser_click',{},'https://example.com'),false);
 s.allow('task-browser');assert.equal(s.matches('browser_click',{},'https://other.example'),true);s.clear();assert.equal(s.matches('browser_click',{},'https://other.example'),false);
 assert.throws(()=>s.allow('forever'));assert.throws(()=>s.allow('task-similar','browser_click',{}));
});
test('only known browser MCP tool approval supports task scopes',()=>{
 const r={serverName:'browser',message:'Allow the browser MCP server to run tool "browser_click"?',_meta:{codex_approval_kind:'mcp_tool_call'}};
 assert.equal(approvalTool(r),'browser_click');assert.equal(approvalTool({...r,serverName:'other'}),null);assert.equal(approvalTool({...r,_meta:{}}),null);assert.equal(approvalTool({...r,message:'Allow the browser MCP server to run tool "evaluate"?'}),null);
});

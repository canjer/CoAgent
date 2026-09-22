import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserDiagnostics} from '../apps/desktop/browser-diagnostics.mjs';
test('browser diagnostics redact URL details and aggregate bounded resource records',()=>{
 const d=new BrowserDiagnostics();d.record('https://u:secret@cdn.example/path?token=SECRET#fragment','script','cross-origin');d.record('https://cdn.example/another','script','cross-origin');
 assert.equal(d.snapshot().blocked[0].origin,'https://cdn.example');assert.equal(d.snapshot().blocked[0].count,2);assert.doesNotMatch(JSON.stringify(d.snapshot()),/SECRET|secret|fragment|another/);
 for(let i=0;i<50;i++)d.record('https://cdn'+i+'.example/path','image','cross-origin');assert.equal(d.snapshot().blocked.length,40);assert.equal(d.snapshot().totalBlocked,52);assert.equal(d.snapshot().truncated,true);
 d.snapshot().blocked[0].count=100;assert.equal(d.snapshot().blocked[0].count,2);d.reset();assert.equal(d.snapshot().totalBlocked,0);
});
test('opaque and invalid URLs do not leak page data',()=>{const d=new BrowserDiagnostics();d.record('data:text/html,SECRET','other','url-policy');d.record('not-a-url SECRET','unexpected','url-policy');assert.doesNotMatch(JSON.stringify(d.snapshot()),/SECRET/);assert.equal(d.snapshot().blocked[0].origin,'data:');});

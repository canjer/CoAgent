import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceGrants} from '../apps/desktop/browser-resources.mjs';
test('resource grants are exact origin/type, bounded, and ephemeral',()=>{
 const g=new ResourceGrants();g.allow('https://cdn.example','script');assert.equal(g.has('https://cdn.example','script'),true);
 for(const [origin,type] of [['https://sub.cdn.example','script'],['https://cdn.example:444','script'],['https://cdn.example','xhr'],['https://cdn.example','mainFrame']])assert.equal(g.has(origin,type),false);
 for(const [origin,type] of [['https://cdn.example/path','image'],['https://u:p@cdn.example','image'],['http://cdn.example','script'],['https://cdn.example','webSocket'],['https://10.0.0.1','script']])assert.throws(()=>g.allow(origin,type));
 g.list()[0].type='xhr';assert.equal(g.has('https://cdn.example','xhr'),false);g.revoke('https://cdn.example','script');assert.equal(g.list().length,0);
 for(let i=0;i<20;i++)g.allow('https://c'+i+'.example','image');assert.throws(()=>g.allow('https://extra.example','image'));g.clear();assert.equal(g.list().length,0);
});

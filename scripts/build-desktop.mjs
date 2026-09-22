import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {mkdir,copyFile,cp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
await mkdir('dist/desktop',{recursive:true});
await build({entryPoints:['apps/desktop/main.mjs'],outfile:'dist/desktop/main.mjs',bundle:true,platform:'node',format:'esm',external:['electron']});
await build({entryPoints:['apps/desktop/host.mjs'],outfile:'dist/desktop/host.mjs',bundle:true,platform:'node',format:'esm'});
await copyFile('apps/desktop/preload.cjs','dist/desktop/preload.cjs');
await viteBuild({root:'apps/desktop/renderer',base:'./',build:{outDir:'../../../dist/desktop/ui',emptyOutDir:true}});

// Copy the pinned Codex native runtime for the current platform.
const runtimePackage={'darwin-arm64':'codex-darwin-arm64','darwin-x64':'codex-darwin-x64','linux-arm64':'codex-linux-arm64','linux-x64':'codex-linux-x64'}[`${process.platform}-${process.arch}`];
if(!runtimePackage)throw new Error(`Desktop build does not support ${process.platform}-${process.arch} yet`);
// The platform package ships its binaries under vendor/<rust-triple>; resolve the triple instead of hardcoding it.
const vendorRoot=join('node_modules','@openai',runtimePackage,'vendor');
let triple;
try{([triple]=await readdir(vendorRoot));}catch{throw new Error(`Codex runtime package missing: @openai/${runtimePackage}`);}
if(!triple)throw new Error(`Codex runtime vendor directory is empty: ${vendorRoot}`);
await rm('dist/desktop/runtime',{recursive:true,force:true});
await cp(join(vendorRoot,triple),'dist/desktop/runtime',{recursive:true});
// Bundle the pinned MCP package including its nested Playwright dependencies.
await rm('dist/desktop/browser-mcp',{recursive:true,force:true});
await mkdir('dist/desktop/browser-mcp/node_modules/@playwright',{recursive:true});
await cp('node_modules/@playwright/mcp','dist/desktop/browser-mcp/node_modules/@playwright/mcp',{recursive:true,dereference:true});

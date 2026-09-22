import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {mkdir,copyFile,cp,rm} from 'node:fs/promises';
await mkdir('dist/desktop',{recursive:true});
await build({entryPoints:['apps/desktop/main.mjs'],outfile:'dist/desktop/main.mjs',bundle:true,platform:'node',format:'esm',external:['electron']});
await build({entryPoints:['apps/desktop/host.mjs'],outfile:'dist/desktop/host.mjs',bundle:true,platform:'node',format:'esm'});
await copyFile('apps/desktop/preload.cjs','dist/desktop/preload.cjs');
await viteBuild({root:'apps/desktop/renderer',base:'./',build:{outDir:'../../../dist/desktop/ui',emptyOutDir:true}});

if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Desktop preview currently targets macOS arm64');
await rm('dist/desktop/runtime',{recursive:true,force:true});
await cp('node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin','dist/desktop/runtime',{recursive:true});
// Bundle the pinned MCP package including its nested Playwright dependencies.
await rm('dist/desktop/browser-mcp',{recursive:true,force:true});
await mkdir('dist/desktop/browser-mcp/node_modules/@playwright',{recursive:true});
await cp('node_modules/@playwright/mcp','dist/desktop/browser-mcp/node_modules/@playwright/mcp',{recursive:true,dereference:true});

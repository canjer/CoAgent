import { realpath, readdir, open } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
const limit=256*1024;
export async function confinedPath(workspace,input=''){
 if(typeof input!=='string'||input.length>4096||input.includes('\0')||isAbsolute(input))throw new Error('文件路径格式错误');
 const root=await realpath(workspace),target=await realpath(resolve(root,input));
 const rel=relative(root,target);
 if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw new Error('文件不在当前工作目录内');
 return {root,target};
}
export async function listFiles(workspace,input=''){
 const {target}=await confinedPath(workspace,input);
 const entries=await readdir(target,{withFileTypes:true});
 const filtered=entries.filter(e=>!['.git','node_modules'].includes(e.name)&&!e.isSymbolicLink());
 filtered.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
 return {path:input,truncated:filtered.length>300,entries:filtered.slice(0,300).map(e=>({name:e.name,path:join(input,e.name),directory:e.isDirectory()}))};
}
export async function previewFile(workspace,input){
 const {target}=await confinedPath(workspace,input);
 const file=await open(target,'r');
 try{
  const info=await file.stat();if(!info.isFile())throw new Error('请选择普通文件');
  if(info.size>limit)throw new Error('预览仅支持 256 KiB 以内的文本文件');
  const buffer=Buffer.alloc(limit+1);const {bytesRead}=await file.read(buffer,0,buffer.length,0);
  if(bytesRead>limit)throw new Error('文件超出预览大小');
  const data=buffer.subarray(0,bytesRead);if(data.includes(0))throw new Error('二进制文件暂不支持预览');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw new Error('预览仅支持 UTF-8 文本');}
  return {path:input,text,size:bytesRead};
 }finally{await file.close();}
}

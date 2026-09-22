import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';
const exec=promisify(execFile);
export async function workspaceDiff(workspace,staged=false){
 const root=await realpath(workspace);
 const args=['--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',root];
 const options={timeout:10000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}};
 let top;
 try{top=(await exec('/usr/bin/git',[...args,'rev-parse','--show-toplevel'],options)).stdout.trim();}
 catch{throw new Error('当前工作目录不是 Git 仓库');}
 if(await realpath(top)!==root)throw new Error('请直接选择 Git 仓库根目录查看变更');
 try{
  const {stdout}=await exec('/usr/bin/git',[...args,'diff','--no-ext-diff','--no-textconv','--no-color',...(staged?['--cached']:[]),'--'],options);
  return {text:stdout,staged,empty:!stdout};
 }catch{throw new Error('读取 diff 失败：超过 1 MiB、超时或 Git 错误');}
}

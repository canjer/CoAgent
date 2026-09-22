const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export function commandApprovalKey(request){
 const p=request?.params;
 if(request?.method!=='item/commandExecution/requestApproval'||!p||p.kind&&p.kind!=='command'||typeof p.command!=='string'||!p.command||typeof p.cwd!=='string'||!p.cwd||typeof p.threadId!=='string'||typeof p.turnId!=='string')return null;
 // Compare complete command text and all supplied context, not a shell prefix.
 // Unknown future fields remain part of the key (fail closed on context changes).
 const context=Object.fromEntries(Object.entries(p).filter(([k])=>!['itemId','approvalId','startedAtMs'].includes(k)));
 return JSON.stringify(stable(context));
}
export class CommandApprovalScope {
 constructor(){this.allowed=new Set();}
 clear(){this.allowed.clear();}
 allow(request){const key=commandApprovalKey(request);if(!key)throw new Error('此审批不支持同类命令授权');if(this.allowed.size>=100&&!this.allowed.has(key))throw new Error('本次任务命令授权达到上限');this.allowed.add(key);}
 matches(request){const key=commandApprovalKey(request);return !!key&&this.allowed.has(key);}
}

/** Return only the runtime-proposed argv rule; never accept one supplied by the renderer. */
export function proposedCommandPrefix(request){
 if(!commandApprovalKey(request)||request.params.networkApprovalContext)return null;
 const prefix=request.params.proposedExecpolicyAmendment;
 if(!Array.isArray(prefix)||prefix.length<2||prefix.length>16||prefix.some(s=>typeof s!=='string'||!s||s.length>512||/[\x00-\x1f\x7f]/.test(s)))return null;
 const program=prefix[0].split('/').at(-1);
 if(/^(?:sh|bash|zsh|fish|dash|ksh|sudo|doas|env|xargs|find|eval|exec|node|nodejs|python[\d.]*|ruby|perl|php|osascript|powershell|pwsh|cmd)(?:\.exe)?$/i.test(program))return null;
 return [...prefix];
}

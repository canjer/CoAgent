import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// One immutable record per phase; no shared JSONL append races or raw payloads.
export async function writeGatewayAudit(directory:string, id:string, phase:'intent'|'result', record:Record<string,unknown>) {
 await mkdir(directory,{recursive:true,mode:0o700});
 const temp=join(directory,`.${id}-${randomUUID()}.tmp`);
 try {
  const file=await open(temp,'wx',0o600);
  try { await file.writeFile(JSON.stringify(record,null,2)+'\n');await file.sync(); } finally {await file.close();}
  await rename(temp,join(directory,`${id}.${phase}.json`));
  const dir=await open(directory,'r');try {await dir.sync();} finally {await dir.close();}
 } finally {await unlink(temp).catch(()=>{});}
}

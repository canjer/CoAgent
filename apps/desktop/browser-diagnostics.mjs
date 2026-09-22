// Store origins, never full URLs, query tokens, headers or request bodies.
export class BrowserDiagnostics {
 constructor(){this.reset();}
 reset(){this.status='idle';this.error='';this.blocked=new Map();this.totalBlocked=0;this.truncated=false;}
 record(url,type,reason){
  let origin;try{const u=new URL(url);origin=['http:','https:','ws:','wss:'].includes(u.protocol)?u.origin:u.protocol;}catch{origin='invalid-url';}
  const resourceType=['mainFrame','subFrame','stylesheet','script','image','font','object','xhr','ping','cspReport','media','webSocket','other'].includes(type)?type:'other';
  const key=JSON.stringify([origin,resourceType,reason]);this.totalBlocked=Math.min(Number.MAX_SAFE_INTEGER,this.totalBlocked+1);
  const item=this.blocked.get(key);if(item)item.count=Math.min(Number.MAX_SAFE_INTEGER,item.count+1);
  else if(this.blocked.size<40)this.blocked.set(key,{origin,resourceType,reason,count:1});else this.truncated=true;
 }
 snapshot(){return {status:this.status,error:this.error,totalBlocked:this.totalBlocked,truncated:this.truncated,blocked:[...this.blocked.values()].map(v=>({...v}))};}
}

import {browserURL} from './browser-policy.mjs';
export const resourceTypes=['script','stylesheet','image','font'];
export class ResourceGrants {
 constructor(){this.entries=new Map();}
 validate(origin,type,local=false){const u=browserURL(origin,local);if(u.origin!==origin||!resourceTypes.includes(type))throw new Error('仅支持精确资源域与 script/stylesheet/image/font 类型');return u;}
 allow(origin,type,local=false){this.validate(origin,type,local);const key=JSON.stringify([origin,type]);if(!this.entries.has(key)&&this.entries.size>=20)throw new Error('当前会话最多授权 20 类资源');this.entries.set(key,{origin,type});}
 has(origin,type){return this.entries.has(JSON.stringify([origin,type]));}
 revoke(origin,type){this.entries.delete(JSON.stringify([origin,type]));}
 clear(){this.entries.clear();}
 list(){return [...this.entries.values()].map(v=>({...v}));}
}

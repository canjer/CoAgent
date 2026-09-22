import {basename,resolve} from 'node:path';
import {JsonStore} from './storage.mjs';

export function projectsSchema(value){
 if(!value||value.version!==1||!Array.isArray(value.paths)||value.paths.length>100)throw new Error('项目配置格式错误');
 const paths=[];
 for(const item of value.paths){
  if(typeof item!=='string'||!item.startsWith('/')||item.length>4096||item.includes('\0'))throw new Error('项目路径格式错误');
  const path=resolve(item);if(!paths.includes(path))paths.push(path);
 }
 return {version:1,paths};
}
export class ProjectRegistry{
 constructor(dir){this.store=new JsonStore(resolve(dir,'projects.json'),projectsSchema,{version:1,paths:[]});this.value={version:1,paths:[]};}
 async init(seed=''){this.value=await this.store.read();if(seed)await this.add(seed);return this.value;}
 async add(path){path=resolve(path);if(!this.value.paths.includes(path))this.value=await this.store.write({version:1,paths:[path,...this.value.paths]});return path;}
 async touch(path){path=await this.add(path);this.value=await this.store.write({version:1,paths:[path,...this.value.paths.filter(p=>p!==path)]});return path;}
 list(){return this.value.paths.map(path=>({path,name:basename(path)||path}));}
}

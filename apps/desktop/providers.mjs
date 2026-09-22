import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {JsonStore} from './storage.mjs';
import {modelProfiles} from '../../packages/model-gateway/src/profiles.ts';
export const customId=id=>typeof id==='string'&&/^custom-[a-f0-9]{32}$/.test(id);
export function validateProvider(v){
 if(!v||typeof v!=='object'||!customId(v.id))throw new Error('配置格式错误');
 const text=(s,max)=>typeof s==='string'&&s===s.trim()&&s.length>0&&s.length<=max&&!/[\x00-\x1f\x7f]/.test(s);
 if(!text(v.label,80)||!text(v.upstreamModel,160)||!text(v.baseUrl,2048)||!['responses','chat-completions'].includes(v.protocol))throw new Error('配置格式错误');
 let url;try{url=new URL(v.baseUrl);}catch{throw new Error('配置格式错误');}
 const apiStyle=v.apiStyle??'openai';if(!['openai','deepseek'].includes(apiStyle)||apiStyle==='deepseek'&&v.protocol!=='chat-completions')throw new Error('仅支持 OpenAI 或 DeepSeek API');
 const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password||url.search||url.hash||/\/(responses|chat\/completions)\/?$/.test(url.pathname))throw new Error('配置格式错误');
 return {id:v.id,label:v.label,upstreamModel:v.upstreamModel,baseUrl:url.href.replace(/\/+$/,''),protocol:v.protocol,apiStyle,apiKeyEnv:'COAGENT_KEY_'+v.id.slice(7).toUpperCase(),custom:true};
}
export function providerSchema(v){
 if(!v||typeof v!=='object')throw new Error('配置格式错误');
 if(v.version!==1)throw new Error('不支持的配置版本');
 if(!Array.isArray(v.models)||v.models.length>20)throw new Error('配置格式错误');
 const models=v.models.map(validateProvider);if(new Set(models.map(p=>p.id)).size!==models.length)throw new Error('配置格式错误');
 return {version:1,models};
}
export class ProviderRegistry{
 constructor(directory){this.store=new JsonStore(join(directory,'providers.json'),providerSchema,{version:1,models:[]});this.models=[];}
 async init(){this.models=(await this.store.read()).models;}
 all(){return [...Object.values(modelProfiles),...this.models];}
 get(id){const profile=this.all().find(p=>p.id===id);if(!profile)throw new Error('未知模型');return profile;}
 async save(value){const id=value.id||'custom-'+randomUUID().replaceAll('-','');if(value.id&&!this.models.some(p=>p.id===id))throw new Error('未知模型');const profile=validateProvider({...value,id});const next=this.models.filter(p=>p.id!==id).concat(profile);const saved=await this.store.write({version:1,models:next});this.models=saved.models;return profile;}
 async remove(id){if(!customId(id)||!this.models.some(p=>p.id===id))throw new Error('未知模型');this.models=(await this.store.write({version:1,models:this.models.filter(p=>p.id!==id)})).models;}
}

import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite} from './storage.mjs';
const ids={'deepseek-chat':'DEEPSEEK_API_KEY','qwen3.5-flash':'QWEN_API_KEY'};
export class CredentialVault {
 constructor(directory,crypto,env=process.env,profiles=()=>Object.entries(ids).map(([id,apiKeyEnv])=>({id,apiKeyEnv}))){this.directory=directory;this.crypto=crypto;this.env=env;this.profiles=profiles;}
 profile(id){const p=this.profiles().find(p=>p.id===id);if(!p)throw new Error('未知模型');return p;}
 name(id){this.profile(id);return join(this.directory,id+'.sealed');}
 available(){return this.crypto.isEncryptionAvailable() && !(process.platform==='linux'&&this.crypto.getSelectedStorageBackend()==='basic_text');}
 async stored(id){try{return await readFile(this.name(id));}catch(e){if(e.code==='ENOENT')return null;throw new Error('读取凭据失败');}}
 async key(id){const encrypted=await this.stored(id);if(encrypted){if(!this.available())throw new Error('系统凭据加密服务暂不可用');try{return this.crypto.decryptString(encrypted);}catch{throw new Error('解密凭据失败，请重新保存密钥');}}return this.env[this.profile(id).apiKeyEnv]||'';}
 async status(){const models=[];for(const profile of this.profiles()){const {id,apiKeyEnv:envName}=profile;const saved=!!await this.stored(id);let error='';try{await this.key(id);}catch(e){error=e.message;}models.push({...profile,id,envName,error,source:saved?'system-encrypted':this.env[envName]?'environment':'missing',saved});}return {encryptionAvailable:this.available(),models};}
 async environment(){const env={};for(const {id,apiKeyEnv:name} of this.profiles()){try{env[name]=await this.key(id);}catch{env[name]='';}}return env;}
 async save(id,value){const path=this.name(id);if(typeof value!=='string'||value.length<8||value.length>4096||/\s/.test(value))throw new Error('密钥格式错误');if(!this.available())throw new Error('系统凭据加密服务暂不可用');let encrypted;try{encrypted=this.crypto.encryptString(value);}catch{throw new Error('系统凭据加密失败');}await atomicWrite(path,encrypted);}
 async remove(id){await rm(this.name(id),{force:true});}
}

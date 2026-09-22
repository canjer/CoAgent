import type { GatewayOptions } from './server.js';
export type ModelId = 'deepseek-chat' | 'qwen3.5-flash';
export interface ModelProfile { id: string; upstreamModel?: string; label: string; apiKeyEnv: string; protocol: GatewayOptions['provider']['protocol']; baseUrl: string; }
export const modelProfiles: Record<ModelId,ModelProfile> = {
 'deepseek-chat':{id:'deepseek-chat',label:'DeepSeek Chat',apiKeyEnv:'DEEPSEEK_API_KEY',protocol:'responses',baseUrl:'https://api.deepseek.com'},
 'qwen3.5-flash':{id:'qwen3.5-flash',label:'Qwen3.5 Flash',apiKeyEnv:'QWEN_API_KEY',protocol:'responses',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'},
};
export function getModelProfile(id: string = 'deepseek-chat'): ModelProfile {
 if(!Object.hasOwn(modelProfiles,id))throw new Error('Unknown model profile');
 return modelProfiles[id as ModelId];
}
export function providerFor(profile:ModelProfile,env:NodeJS.ProcessEnv=process.env):GatewayOptions['provider']{
 const apiKey=env[profile.apiKeyEnv];
 if(!apiKey)throw new Error(`Missing environment: ${profile.apiKeyEnv}`);
 return {protocol:profile.protocol,baseUrl:profile.baseUrl,upstreamModel:profile.upstreamModel??profile.id,alias:profile.id,apiKey};
}

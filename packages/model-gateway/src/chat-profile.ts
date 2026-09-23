/** Verified official Qwen text-only profile; never infer options for arbitrary hosts. */
export function chatProfileOptions(baseUrl:string,model:string):Record<string,unknown>{
 if(isOfficialDeepSeekTextModel(baseUrl,model))return {thinking:{type:'disabled'}};
 const url=new URL(baseUrl);
 if(url.origin==='https://dashscope.aliyuncs.com'&&url.pathname.replace(/\/$/,'')==='/compatible-mode/v1'&&model==='qwen3.5-flash')return {enable_thinking:false};
 return {};
}

/** Only verified official DeepSeek models/endpoints receive provider-specific diagnostic controls. */
export function isOfficialDeepSeekTextModel(baseUrl:string,model:string):boolean{
 const url=new URL(baseUrl);
 return url.origin==='https://api.deepseek.com'&&['','/v1'].includes(url.pathname.replace(/\/$/,''))&&['deepseek-flash','deepseek-v4-pro'].includes(model);
}

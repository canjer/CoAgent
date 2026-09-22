/** Verified official Qwen text-only profile; never infer options for arbitrary hosts. */
export function chatProfileOptions(baseUrl:string,model:string):Record<string,unknown>{
 const url=new URL(baseUrl);
 if(url.origin==='https://dashscope.aliyuncs.com'&&url.pathname.replace(/\/$/,'')==='/compatible-mode/v1'&&model==='qwen3.5-flash')return {enable_thinking:false};
 return {};
}

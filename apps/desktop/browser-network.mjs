// Use one explicit proxy without a DIRECT fallback; do not mix local DNS
// preflight with remote proxy resolution.
export function proxyRoute(result){
 const first=String(result).split(';')[0].trim();
 if(first==='DIRECT')return null;
 const match=/^(PROXY|HTTPS|SOCKS5)\s+(\[[\da-f:]+\]|[\w.-]+):(\d+)$/i.exec(first);
 if(!match||+match[3]<1||+match[3]>65535)throw new Error('系统代理类型暂不支持，请配置 HTTP、HTTPS 或 SOCKS5 代理');
 return ({PROXY:'http',HTTPS:'https',SOCKS5:'socks5'})[match[1].toUpperCase()]+'://'+match[2]+':'+match[3];
}

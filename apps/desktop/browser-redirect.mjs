import {ordinaryLink} from './browser-approvals.mjs';
// Only unwrap the observed Google regional redirect. Never trust arbitrary q/next URLs.
export function redirectDestination(source,target){
 if(ordinaryLink(target))return target;
 try{
  const from=new URL(source),wrapper=new URL(target);
  const origins=new Set(['https://www.google.com','https://www.google.com.hk']);
  if(!origins.has(from.origin)||!origins.has(wrapper.origin)||wrapper.pathname!=='/url'||wrapper.username||wrapper.password)return null;
  if(wrapper.searchParams.getAll('q').length!==1)return null;
  const destination=new URL(wrapper.searchParams.get('q'));
  if(destination.origin!==wrapper.origin||!ordinaryLink(destination.href))return null;
  return destination.href;
 }catch{return null;}
}

const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('coagent',{
 call:(method,args)=>ipcRenderer.invoke('agent:call',method,args),
 subscribe:(listener)=>{const handler=(_event,data)=>listener(data);ipcRenderer.on('agent:event',handler);return()=>ipcRenderer.removeListener('agent:event',handler);}
});

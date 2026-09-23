const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('coagent',{
 filePath:file=>webUtils.getPathForFile(file),
 call:(method,args)=>ipcRenderer.invoke('agent:call',method,args),
 subscribe:(listener)=>{const handler=(_event,data)=>listener(data);ipcRenderer.on('agent:event',handler);return()=>ipcRenderer.removeListener('agent:event',handler);}
});

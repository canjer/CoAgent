import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){
 let m;try{m=JSON.parse(line);}catch{continue;}
 if(m.id===undefined)continue;
 let result;
 if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'coagent-fixture',version:'1'}};
 else if(m.method==='tools/list')result={tools:[{name:'echo',description:'Return a test value.',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};
 else if(m.method==='tools/call')result={content:[{type:'text',text:'MCP_ECHO:'+m.params.arguments.value}],isError:false};
 else if(['resources/list','resources/templates/list'].includes(m.method))result=m.method==='resources/list'?{resources:[]}:{resourceTemplates:[]};
 else result={};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
}

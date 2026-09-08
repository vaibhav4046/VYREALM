import {spawn} from 'node:child_process';
import {join} from 'node:path';

export function mcpConnectionConfig({root,port,executable=process.execPath,electron=Boolean(process.versions.electron)}){
 if(!root||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local MCP configuration');
 return {mcpServers:{vyrealm:{command:executable,args:[join(root,'mcp-server.mjs')],env:{VYREALM_API:`http://127.0.0.1:${port}`,...(electron?{ELECTRON_RUN_AS_NODE:'1'}:{})}}}};
}

/** Exercises the shipped stdio transport without creating media or publishing. */
export async function checkMcpConnection(options,{spawnImpl=spawn,timeoutMs=10000}={}){
 const config=mcpConnectionConfig(options).mcpServers.vyrealm;
 return new Promise((resolve,reject)=>{
  const child=spawnImpl(config.command,config.args,{cwd:options.root,env:{...process.env,...config.env},windowsHide:true,stdio:['pipe','pipe','ignore']});
  let pending='',bytes=0,settled=false,initialized=false,toolCount=0;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);child.stdin?.end();if(child.exitCode===null)child.kill();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(Error('MCP_CONNECTION_TIMEOUT: The local bridge did not respond within the time limit.')),timeoutMs);
  const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
  child.once('error',()=>finish(Error('MCP_START_FAILED: The bundled local bridge could not start.')));
  child.stdin.on('error',()=>finish(Error('MCP_INPUT_FAILED: The local bridge closed its input.')));
  child.once('exit',()=>{if(!settled)finish(Error('MCP_EXITED: The bridge exited before verification completed.'));});
  child.stdout.on('data',chunk=>{
   bytes+=chunk.length;if(bytes>1_000_000)return finish(Error('MCP_RESPONSE_LIMIT: The local bridge returned too much data.'));
   pending+=chunk.toString('utf8');let end;
   while((end=pending.indexOf('\n'))!==-1){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line.trim())continue;
    let message;try{message=JSON.parse(line);}catch{return finish(Error('MCP_INVALID_RESPONSE: The bridge returned invalid JSON.'));}
    if(message.error)return finish(Error('MCP_PROTOCOL_ERROR: The bridge rejected the connection check.'));
    if(message.id===1){if(message.result?.serverInfo?.name!=='vyrealm-local')return finish(Error('MCP_IDENTITY_MISMATCH'));initialized=true;send({jsonrpc:'2.0',method:'notifications/initialized'});send({jsonrpc:'2.0',id:2,method:'tools/list'});}
    else if(message.id===2&&initialized){const tools=message.result?.tools;if(!Array.isArray(tools)||!tools.some(t=>t.name==='list_projects'))return finish(Error('MCP_TOOLS_MISSING'));toolCount=tools.length;send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_projects',arguments:{limit:1}}});}
    else if(message.id===3&&toolCount){let receipt;try{receipt=JSON.parse(message.result.content.find(c=>c.type==='text').text);}catch{return finish(Error('MCP_RECEIPT_INVALID'));}if(message.result.isError||receipt.status!=='succeeded')return finish(Error('MCP_READ_FAILED: The bridge could not read the local project store.'));finish(null,{status:'passed',server:'vyrealm-local',transport:'stdio',toolCount,checkedAt:new Date().toISOString(),checks:['initialize','tools/list','list_projects'],writesPerformed:false});}
   }
  });
  send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',clientInfo:{name:'vyrealm-connection-check',version:'1.0.0'},capabilities:{}}});
 });
}

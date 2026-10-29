import path from 'node:path';
import {access,stat,constants} from 'node:fs/promises';
import {harnessError,identifier} from './store.mjs';
export async function validateMcpServer(server){
 const invalid=()=>{throw harnessError('INVALID_MCP_SERVER','Expected an id, name and HTTPS/loopback HTTP URL, or an absolute installed command with bounded args');};
 if(!server||typeof server!=='object'||Array.isArray(server)||!identifier(server.id)||server.id.length>89||/^(grok_|custom_)/.test(server.id)||typeof server.name!=='string'||!server.name.trim()||server.name.length>100)invalid();
 if(Object.hasOwn(server,'url')){
  if(Object.keys(server).some(k=>!['id','name','url'].includes(k))||typeof server.url!=='string'||server.url.length>2048||/[\s\\]/.test(server.url))invalid();
  let url;try{url=new URL(server.url);}catch{invalid();}
  const loopback=/^http:\/\/(127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(server.url);
  if((url.protocol!=='https:'&&!loopback)||url.username||url.password||url.search||url.hash||server.url.includes('?')||server.url.includes('#'))invalid();
  return {id:server.id,name:server.name,url:url.href};
 }
 if(Object.keys(server).some(k=>!['id','name','command','args'].includes(k))||typeof server.command!=='string'||!path.isAbsolute(server.command)||server.command.length>1024||!Array.isArray(server.args)||server.args.length>32||server.args.some(a=>typeof a!=='string'||a.length>2048))invalid();
 try{await access(server.command,constants.X_OK);if(!(await stat(server.command)).isFile())invalid();}catch{invalid();}
 return {id:server.id,name:server.name,command:server.command,args:[...server.args]};
}


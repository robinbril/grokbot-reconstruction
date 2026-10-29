import {Server} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {access,appendFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const [marker,gate]=process.argv.slice(2);
const server=new Server({name:'synthetic-mcp-cancellation',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler('tools/list',async()=>({tools:[{name:'probe',inputSchema:{type:'object',properties:{id:{type:'string'},wait:{type:'boolean'}},required:['id','wait'],additionalProperties:false}}]}));
server.setRequestHandler('tools/call',async incoming=>{
 const args=incoming.params.arguments;
 await appendFile(marker,args.id+'\n');
 if(args.wait){
  for(let attempt=0;;attempt++){
   if(await access(gate).then(()=>true,()=>false))break;
   if(attempt>=1000)throw new Error('Synthetic gate timed out');
   await delay(5);
  }
 }
 return {content:[{type:'text',text:args.id}]};
});
await server.connect(new StdioServerTransport());

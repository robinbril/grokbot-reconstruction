// Synthetic project-owned MCP fixture. Selection is presentation, not a call.
import {Server} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
const server=new Server({name:'synthetic-reference-proof',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler('tools/list',async()=>({tools:[{name:'add',description:'Add two synthetic integers without side effects.',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{a:{type:'integer'},b:{type:'integer'}},required:['a','b'],additionalProperties:false}}]}));
server.setRequestHandler('tools/call',async request=>{
 const args=request.params.arguments??{};
 if(request.params.name!=='add'||!Number.isInteger(args.a)||!Number.isInteger(args.b)||Object.keys(args).some(key=>!['a','b'].includes(key)))return {isError:true,content:[{type:'text',text:'Invalid synthetic addition'}]};
 return {content:[{type:'text',text:JSON.stringify({sum:args.a+args.b,marker:'SYNTHETIC_MCP_REFERENCE_PROBE'})}]};
});
await server.connect(new StdioServerTransport());

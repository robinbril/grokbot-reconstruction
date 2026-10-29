// A real project-owned MCP server used to verify custom stdio registration.
import {Server} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
const server=new Server({name:'harness-math-proof',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler('tools/list',async()=>({tools:[{name:'sum',description:'Compute the exact sum of two finite numbers for a harness integration proof.',inputSchema:{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b'],additionalProperties:false}}]}));
server.setRequestHandler('tools/call',async request=>{const {name,arguments:args}=request.params;if(name!=='sum'||!args||!Number.isFinite(args.a)||!Number.isFinite(args.b))return {isError:true,content:[{type:'text',text:'sum requires two finite numbers'}]};const result={sum:args.a+args.b};return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};});
await server.connect(new StdioServerTransport());

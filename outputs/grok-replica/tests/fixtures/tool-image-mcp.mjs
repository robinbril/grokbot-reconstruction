// Project-owned read-only MCP observation. Its pixels are the entire result.
import {readFile} from 'node:fs/promises';
import {Server} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
const data=(await readFile(new URL('./model-attachments/vision.jpeg',import.meta.url))).toString('base64');
const server=new Server({name:'tool-observation-proof',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler('tools/list',async()=>({tools:[{name:'observe',description:'Return the synthetic visual observation.',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));
server.setRequestHandler('tools/call',async request=>{
 if(request.params.name!=='observe'||Object.keys(request.params.arguments??{}).length)return {isError:true,content:[{type:'text',text:'Invalid observation request'}]};
 return {content:[{type:'image',mimeType:'image/jpeg',data}]};
});
await server.connect(new StdioServerTransport());

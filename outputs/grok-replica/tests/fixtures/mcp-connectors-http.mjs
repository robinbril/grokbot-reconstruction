import http from 'node:http';
import {Server,WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';

// Project-owned real SDK HTTP MCP server. No service credentials or model calls.
export async function startConnectorMcp(){
 const calls=[],requests=[];
 const server=http.createServer(async(req,res)=>{
  let mcp;
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const bytes=Buffer.concat(chunks);if(bytes.length)requests.push(JSON.parse(bytes));
   mcp=new Server({name:'connector-http-proof',version:'1'},{capabilities:{tools:{}}});
   mcp.setRequestHandler('tools/list',async()=>({tools:[{name:'sum',description:'Compute an exact finite sum',inputSchema:{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b'],additionalProperties:false}}]}));
   mcp.setRequestHandler('tools/call',async incoming=>{
    const {name,arguments:args}=incoming.params;
    if(name!=='sum'||!Number.isFinite(args?.a)||!Number.isFinite(args?.b))return {isError:true,content:[{type:'text',text:'Expected finite a and b'}]};
    calls.push(structuredClone(incoming.params));const result={sum:args.a+args.b};
    return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
   });
   const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await mcp.connect(transport);
   const response=await transport.handleRequest(new Request(`http://127.0.0.1:${server.address().port}${req.url}`,{method:req.method,headers:req.headers,...(bytes.length?{body:bytes}:{})}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}finally{await mcp?.close();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}/mcp`,calls,requests,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

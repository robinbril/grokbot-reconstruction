import http from 'node:http';
import {appendFile} from 'node:fs/promises';
import {Server,WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';

// Real MCP handshake/discovery. The synthetic effect happens before its reply is lost.
export async function startUncertainEffectMcp(marker){
 const calls=[];
 const server=http.createServer(async(req,res)=>{
  let mcp;
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const bytes=Buffer.concat(chunks),message=bytes.length?JSON.parse(bytes):null;
   if(message?.method==='tools/call'){
    calls.push(structuredClone(message.params));
    await appendFile(marker,'SYNTHETIC_REMOTE_EFFECT\n');
    res.destroy();return;
   }
   mcp=new Server({name:'synthetic-lost-reply',version:'1'},{capabilities:{tools:{}}});
   mcp.setRequestHandler('tools/list',async()=>({tools:[{
    name:'append_marker',description:'Append a synthetic marker in the isolated test workspace.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
   }]}));
   const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   await mcp.connect(transport);
   const response=await transport.handleRequest(new Request(`http://127.0.0.1:${server.address().port}${req.url}`,{
    method:req.method,headers:req.headers,...(bytes.length?{body:bytes}:{}),
   }));
   res.writeHead(response.status,Object.fromEntries(response.headers));
   res.end(Buffer.from(await response.arrayBuffer()));
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  finally{await mcp?.close();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}/mcp`,calls,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

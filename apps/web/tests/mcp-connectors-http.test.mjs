import test from 'node:test';
import assert from 'node:assert/strict';
import {startConnectorMcp} from './fixtures/mcp-connectors-http.mjs';

test('owned SDK Streamable HTTP fixture executes actual initialize/list/call with exact receipt',async t=>{
 const server=await startConnectorMcp();t.after(()=>server.close());let sequence=0;
 const rpc=async(method,params)=>{const response=await fetch(server.url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});assert.equal(response.status,200);return response.json();};
 assert.equal((await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'connector-test',version:'1'}})).result.serverInfo.name,'connector-http-proof');
 assert.equal((await rpc('tools/list',{})).result.tools[0].name,'sum');
 assert.deepEqual((await rpc('tools/call',{name:'sum',arguments:{a:43,b:18}})).result.structuredContent,{sum:61});
 assert.deepEqual(server.calls,[{name:'sum',arguments:{a:43,b:18}}]);
 assert.equal((await rpc('tools/call',{name:'sum',arguments:{a:'wrong',b:18}})).result.isError,true);assert.equal(server.calls.length,1);
});

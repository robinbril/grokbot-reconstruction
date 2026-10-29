import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGrokToolHost} from '../harness/grok-tool-host.mjs';
import {startConnectorMcp} from './fixtures/mcp-connectors-http.mjs';

test('Grok discovers and calls real HTTP and stdio MCP tools without Codex',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'grok-host-')),http=await startConnectorMcp();
 const fixture=path.resolve('tests/fixtures/harness-math-mcp.mjs');
 const host=await createGrokToolHost({workspace,customServers:[{id:'http',runtimeId:'custom_http',url:http.url},{id:'stdio',runtimeId:'custom_stdio',command:process.execPath,args:[fixture]}]});
 try{
  const definitions=host.getDefinitions();assert.equal(definitions.filter(t=>t.serverId==='grok_workspace').length,11);
  assert.deepEqual(definitions.filter(t=>['browser_press','browser_scroll','browser_select'].includes(t.name)).map(t=>t.name).sort(),['browser_press','browser_scroll','browser_select']);
  for(const id of ['custom_http','custom_stdio']){
   const tool=definitions.find(t=>t.serverId===id);assert.ok(tool);assert.match(tool.name,/^[a-zA-Z0-9_-]{1,64}$/);
   assert.equal((await host.call(tool.name,{a:4,b:6})).structuredContent.sum,10);
  }
  assert.ok(host.inventory().every(server=>server.state==='connected'));
  assert.ok(http.requests.some(request=>request.method==='initialize'));
  await assert.rejects(host.call('unknown',{}),/Unknown/);
 }finally{await host.close();await http.close();await fs.rm(workspace,{recursive:true,force:true});}
 await assert.rejects(host.call('workspace_list',{}),/closed/);
});

test('failed and disabled connectors report actual discovery state',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'grok-host-'));
 const host=await createGrokToolHost({workspace,customServers:[{id:'off',enabled:false,url:'http://127.0.0.1:1/mcp'},{id:'bad',command:'/nonexistent/mcp',args:[]}]});
 try{
  assert.equal(host.inventory().find(row=>row.id==='off').state,'disabled');
  assert.equal(host.inventory().find(row=>row.id==='bad').state,'failed');
  assert.equal(host.getDefinitions().length,11);
 }finally{await host.close();await fs.rm(workspace,{recursive:true,force:true});}
});

test('argument validation, disabled tools and credential forwarding fail closed',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'grok-host-')),http=await startConnectorMcp();
 const host=await createGrokToolHost({workspace,customServers:[{id:'http',url:http.url},{id:'disabled',url:http.url,disabledTools:['sum']},{id:'secret',command:process.execPath,args:[],env_vars:['OPENAI_API_KEY']}]});
 try{
  const sum=host.getDefinitions().find(tool=>tool.serverId==='http');
  assert.equal(sum.requiresApproval,true);
  await assert.rejects(host.call(sum.name,{a:'4',b:6}),/Invalid/);
  assert.equal(http.calls.length,0);
  assert.equal(host.getDefinitions().some(tool=>tool.serverId==='disabled'),false);
  assert.equal(host.inventory().find(row=>row.id==='secret').state,'failed');
 }finally{await host.close();await http.close();await fs.rm(workspace,{recursive:true,force:true});}
});


test('owned account bridge receives only its bridge bearer and abort closes stale calls',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'grok-host-')),fixture=await startConnectorMcp(),headers=[];
 const proxy=http.createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=Buffer.concat(chunks);headers.push(req.headers.authorization);
   if(body.length&&JSON.parse(body).method==='tools/call')await new Promise(resolve=>setTimeout(resolve,150));
   const response=await fetch(fixture.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.destroy();}
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${proxy.address().port}/mcp`;
 const host=await createGrokToolHost({workspace,c:{token:'owned-bridge-demo-token'},accountServers:[{id:'account_demo',accountId:'demo',url}]});
 try{
  const tool=host.getDefinitions().find(tool=>tool.serverId==='account_demo');assert.ok(tool);
  const controller=new AbortController();
  const calling=host.call(tool.name,{a:1,b:2},{signal:controller.signal});
  setTimeout(()=>controller.abort(),30);
  await assert.rejects(calling);
  assert.ok(headers.length>=2);assert.ok(headers.every(value=>value==='Bearer owned-bridge-demo-token'));
  assert.equal(host.inventory().find(row=>row.id==='account_demo').state,'disconnected');
  assert.equal(host.getDefinitions().some(tool=>tool.serverId==='account_demo'),false);
  assert.ok(!JSON.stringify(host.inventory()).includes('owned-bridge-demo-token'));
 }finally{
  await host.close();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await fixture.close();
  await fs.rm(workspace,{recursive:true,force:true});
 }
});


test('model Terminal tool requires exact-command approval and uses owned executor',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'grok-host-')),calls=[];
 const executor={async start(input){calls.push(input);return {stdout:'proof',stderr:'',exitCode:0};}};
 const host=await createGrokToolHost({workspace,runtime:{executor}});
 try{
  const tool=host.getDefinitions().find(tool=>tool.name==='Terminal');assert.equal(tool.requiresApproval,true);assert.equal(tool.serverId,'grok_taskbox');
  const controller=new AbortController();
  assert.deepEqual(await host.call('Terminal',{command:'printf proof'},{signal:controller.signal}),{stdout:'proof',stderr:'',exitCode:0});
  assert.equal(calls.length,1);assert.equal(calls[0].command,'printf proof');assert.equal(calls[0].workspace,workspace);assert.equal(calls[0].signal.aborted,false);controller.abort();assert.equal(calls[0].signal.aborted,true);
  await assert.rejects(host.call('Terminal',{command:'printf proof',extra:true}),/Invalid/);
  assert.equal(calls.length,1);
  assert.equal(host.inventory().find(row=>row.id==='grok_taskbox').state,'connected');
 }finally{await host.close();await fs.rm(workspace,{recursive:true,force:true});}
});

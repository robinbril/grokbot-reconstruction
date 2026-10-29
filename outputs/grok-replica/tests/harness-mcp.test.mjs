// Historical protocol adapter coverage, not current product-provider execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {createWorkspaceTools} from '../harness/workspace-tools.mjs';
import {createWorkspaceMcpBridge} from '../harness/workspace-mcp.mjs';
import {DEFAULT_CODEX_BINARY} from '../harness/codex-rpc.mjs';
import {startLegacyHarness as startHarness} from './fixtures/legacy-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function stdio(t,file,env={}){
 const child=spawn(process.execPath,[file],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let sequence=0,stderr='';const pending=new Map();child.stderr.on('data',chunk=>stderr+=chunk);readline.createInterface({input:child.stdout}).on('line',line=>{let msg;try{msg=JSON.parse(line);}catch{return;}const item=pending.get(msg.id);if(item){pending.delete(msg.id);clearTimeout(item.timer);item.resolve(msg);}});t.after(async()=>{child.stdin.end();if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('MCP fixture closed'));}});
 const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP protocol deadline: '+method+' '+stderr));},15000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 return {request,notify:(method,params)=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n'),get stderr(){return stderr;}};
}
async function initialize(client){const result=await client.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'owned-integration-test',version:'1'}});assert.equal(result.error,undefined);client.notify('notifications/initialized',{});return result.result;}
test('official MCP stdio initialize/list/call reaches actual workspace bytes and propagates denial',async t=>{
 const workspace=await mkdtemp(path.join(tmpdir(),'harness-mcp-'));const tools=createWorkspaceTools({workspace}),token=randomBytes(32).toString('hex');let calls=0;const server=http.createServer(async(req,res)=>{if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401).end('{}');return;}res.setHeader('Content-Type','application/json');if(req.url.endsWith('/tools/list')){res.end(JSON.stringify({tools:tools.listTools()}));return;}try{let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);calls++;res.end(JSON.stringify({result:await tools.callTool(value.name,value.arguments)}));}catch(error){res.writeHead(422).end(JSON.stringify({error:{message:error.message}}));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await tools.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(workspace,{recursive:true,force:true});});
 const client=stdio(t,path.join(root,'harness/workspace-mcp.mjs'),{HARNESS_MCP_BASE_URL:`http://127.0.0.1:${server.address().port}/api/harness/internal/ownedproof`,HARNESS_MCP_TOKEN:token});assert.equal((await initialize(client)).serverInfo.name,'grok_workspace');const listed=await client.request('tools/list',{});assert.deepEqual(listed.result.tools.map(tool=>tool.name).sort(),['browser_click','browser_fill','browser_open','browser_press','browser_screenshot','browser_scroll','browser_select','browser_snapshot','workspace_list','workspace_read','workspace_write']);
 const content='Actual MCP bytes '+randomUUID();const written=await client.request('tools/call',{name:'workspace_write',arguments:{path:'mcp.txt',content}});assert.equal(written.result.structuredContent.bytesWritten,Buffer.byteLength(content));assert.equal(await readFile(path.join(workspace,'mcp.txt'),'utf8'),content);const read=await client.request('tools/call',{name:'workspace_read',arguments:{path:'mcp.txt'}});assert.equal(read.result.structuredContent.content,content);const denied=await client.request('tools/call',{name:'workspace_read',arguments:{path:'../escape'}});assert.equal(denied.result.isError,true);assert.equal(calls,3);assert.equal(client.stderr,'');
});
test('MCP bridge rejects remote, ambiguous and credential-bearing callback addresses before fetching',()=>{
 const token=randomBytes(32).toString('hex');for(const baseUrl of ['https://example.com/api/harness/internal/a','http://127.0.0.1:1234/api/harness/internal/a?token=bad','http://user:pass@127.0.0.1:1234/api/harness/internal/a','http://127.0.0.1:1234/other','file:///tmp/no'])assert.throws(()=>createWorkspaceMcpBridge({baseUrl,token}));assert.throws(()=>createWorkspaceMcpBridge({baseUrl:'http://127.0.0.1:1234/api/harness/internal/a',token:'short'}));
});
test('custom project MCP server computes a real result over standard stdio transport',async t=>{
 const client=stdio(t,fileURLToPath(new URL('./fixtures/harness-math-mcp.mjs',import.meta.url)));assert.equal((await initialize(client)).serverInfo.name,'harness-math-proof');assert.equal((await client.request('tools/list',{})).result.tools[0].name,'sum');const result=await client.request('tools/call',{name:'sum',arguments:{a:87,b:124}});assert.equal(result.result.structuredContent.sum,211);const rejected=await client.request('tools/call',{name:'sum',arguments:{a:'wrong',b:124}});assert.equal(rejected.result.isError,true);
});
test('installed Codex really discovers a registered custom SDK MCP server without importing global servers',{timeout:90000},async t=>{
 const app=await startHarness({codexBinary:DEFAULT_CODEX_BINARY});t.after(()=>app.close());const client=await app.client();const response=await client.request('/conversations/custommcp/mcp-servers',{method:'POST',body:{requestId:randomUUID(),server:{id:'mathproof',name:'Math proof',command:process.execPath,args:[fileURLToPath(new URL('./fixtures/harness-math-mcp.mjs',import.meta.url))]}}});assert.equal(response.status,200,JSON.stringify(response));const tools=(await client.request('/conversations/custommcp/tools')).value.servers;assert.deepEqual(tools.map(s=>s.id).sort(),['custom_mathproof','grok_workspace']);assert.equal(tools.find(s=>s.id==='custom_mathproof').state,'connected');assert.equal(tools.find(s=>s.id==='custom_mathproof').tools[0].name,'sum');assert.equal(response.value.entries.length,0);assert.equal(response.value.runs.length,0);
});
test('installed Codex reconnects a pre-turn Computer session without a missing lazy rollout',{timeout:90000},async t=>{
 const app=await startHarness({codexBinary:DEFAULT_CODEX_BINARY});t.after(()=>app.close());const client=await app.client(),id='emptyreconnect';
 const first=await client.request('/conversations/'+id+'/connect',{method:'POST',body:{requestId:randomUUID()}});assert.equal(first.status,200,JSON.stringify(first.value));assert.equal(first.value.runs.length,0);const workspace=first.value.workspaceRoot;
 await app.handler.runtime.drop(id);
 const second=await client.request('/conversations/'+id+'/connect',{method:'POST',body:{requestId:randomUUID()}});assert.equal(second.status,200,JSON.stringify(second.value));assert.equal(second.value.workspaceRoot,workspace);assert.equal(second.value.runs.length,0);assert.equal(second.value.runtime.state,'connected');
});

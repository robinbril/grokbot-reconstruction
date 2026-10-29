import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,writeFile,readFile,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWorkspaceTools,validateToolArguments} from '../harness/workspace-tools.mjs';
async function setup(t){const workspace=await mkdtemp(path.join(tmpdir(),'harness-tools-'));let tools;const server=http.createServer(async(req,res)=>{if(!req.url.startsWith('/api/harness/conversations/probe/preview/')||req.headers['x-harness-bridge']!=='yes'){res.writeHead(403).end();return;}if(req.url.endsWith('missing.html')){res.writeHead(404).end('missing');return;}if(req.url.endsWith('redirect.html')){res.writeHead(302,{location:'http://127.0.0.1:1/private'}).end();return;}const content=await readFile(path.join(workspace,'index.html'));res.writeHead(200,{'Content-Type':'text/html'}).end(content);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseUrl='http://127.0.0.1:'+server.address().port+'/api/harness/conversations/probe/preview/';const frames=[];tools=createWorkspaceTools({workspace,baseUrl,emit:async(type,value)=>frames.push({type,value}),authorizeLocalUrl:url=>url.startsWith(baseUrl)?{headers:{'x-harness-bridge':'yes'}}:false});t.after(async()=>{await tools.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(workspace,{recursive:true,force:true});});return {workspace,baseUrl,tools,frames};}
test('workspace tools operate on actual UTF-8 files and an immutable discovered catalog',async t=>{
 const {workspace,tools}=await setup(t);const text='Unique file '+randomUUID();const written=await tools.callTool('workspace_write',{path:'proof.txt',content:text});assert.equal(written.bytesWritten,Buffer.byteLength(text));assert.equal(await readFile(path.join(workspace,'proof.txt'),'utf8'),text);assert.equal((await tools.callTool('workspace_read',{path:'proof.txt'})).content,text);assert.equal((await tools.callTool('workspace_list',{})).entries[0].name,'proof.txt');const catalog=tools.listTools();assert.equal(catalog.length,11);catalog[0].name='corrupted';assert.notEqual(tools.listTools()[0].name,'corrupted');
});
test('path and symlink escapes are refused for read, write and list',async t=>{
 const {workspace,tools}=await setup(t);await writeFile(path.join(workspace,'.private'),'hidden');await symlink(path.dirname(workspace),path.join(workspace,'escape'));
 for(const input of ['../outside','/etc/passwd','.private','escape','escape/anything','sub/../file','C:\\secret','nul\0byte'])for(const name of ['workspace_read','workspace_list','workspace_write'])await assert.rejects(tools.callTool(name,{path:input,...(name==='workspace_write'?{content:'must not write'}:{})}));
});
test('oversize writes and malformed arguments cannot silently truncate or change a file',async t=>{
 const {tools}=await setup(t);await tools.callTool('workspace_write',{path:'keep.txt',content:'keep'});await assert.rejects(tools.callTool('workspace_write',{path:'keep.txt',content:'x'.repeat(262145)}));assert.equal((await tools.callTool('workspace_read',{path:'keep.txt'})).content,'keep');for(const [name,args] of [['unknown',{}],['workspace_read',{path:'keep.txt',extra:'bad'}],['browser_open',{url:42}],['browser_fill',{selector:'input'}]])assert.throws(()=>validateToolArguments(name,args));
});
test('cancelled file operation never writes and returns an explicit error',async t=>{
 const {workspace,tools}=await setup(t);const controller=new AbortController();controller.abort();await assert.rejects(tools.callTool('workspace_write',{path:'cancelled.txt',content:'no'},{signal:controller.signal}));await assert.rejects(readFile(path.join(workspace,'cancelled.txt')));
});
test('actual Chromium opens an owned file, fills and clicks actual DOM, and captures actual PNG',async t=>{
 const {workspace,baseUrl,tools,frames}=await setup(t);const marker=randomUUID();await writeFile(path.join(workspace,'index.html'),`<!doctype html><title>Harness browser proof</title><label>Name<input id="name"></label><button id="apply" onclick="document.getElementById('out').textContent=document.getElementById('name').value">Apply</button><p id="out">Before</p>`);const first=await tools.callTool('browser_open',{url:baseUrl+'index.html'});assert.equal(first.title,'Harness browser proof');await tools.callTool('browser_fill',{selector:'#name',value:marker});await tools.callTool('browser_click',{selector:'#apply'});const snap=await tools.callTool('browser_snapshot',{});assert.ok(snap.text.includes(marker));const frame=tools.frame(snap.captureId);assert.equal(frame.contentType,'image/png');assert.deepEqual([...frame.bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(frame.bytes.length>1000);assert.equal(frames.at(-1).type,'browser.frame');assert.equal(frames.at(-1).value.captureId,snap.captureId);assert.equal(tools.browserState().captureId,snap.captureId);
});
test('browser refuses private targets, unsafe protocols, redirects and missing pages',async t=>{
 const {tools,baseUrl,workspace}=await setup(t);await writeFile(path.join(workspace,'index.html'),'<title>Owned</title>');for(const url of ['file:///etc/passwd','data:text/html,private','javascript:alert(1)','http://127.0.0.1:1/private','http://169.254.169.254/latest/meta-data','http://[::1]:1/private',baseUrl+'redirect.html',baseUrl+'missing.html'])await assert.rejects(tools.callTool('browser_open',{url}),url);
});

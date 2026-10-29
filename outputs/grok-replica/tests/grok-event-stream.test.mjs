import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createHarnessHandler} from '../harness/http.mjs';

async function until(predicate){
 for(let i=0;i<400;i++){if(predicate())return;await delay(5);}
 assert.fail('Synthetic SSE lifecycle condition was not reached');
}
async function setup(t,{chunks=48}={}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-sse-regression-'));
 let handler,streamReady;
 const streamHandled=new Promise(resolve=>{streamReady=resolve;});
 const metrics={writes:0,falseWrites:0,maxBuffered:0,afterEndWrites:0,errors:[],res:null};
 const server=http.createServer(async(req,res)=>{
  if(req.url.includes('/events')){
   metrics.res=res;res.cork();
   const write=res.write.bind(res);
   res.write=(...args)=>{if(res.writableEnded)metrics.afterEndWrites++;const accepted=write(...args);metrics.writes++;if(!accepted)metrics.falseWrites++;metrics.maxBuffered=Math.max(metrics.maxBuffered,res.writableLength);return accepted;};
   res.on('error',error=>metrics.errors.push(error.code));
  }
  await handler.handle(req,res);
  if(req.url.includes('/events'))streamReady();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const baseUrl='http://127.0.0.1:'+server.address().port;
 handler=await createHarnessHandler({root:path.resolve('.'),dataDir,baseUrl,workflowAutoStart:false,model:{status:()=>({state:'unavailable'})}});
 t.after(async()=>{await handler.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const status=await fetch(baseUrl+'/api/harness/status'),cookie=status.headers.get('set-cookie').split(';')[0],owner=cookie.split('=')[1];await status.arrayBuffer();
 await handler.store.transaction(owner,'synthetic',(s,emit)=>{
  s.runs.push({id:'run',status:'completed',approvals:[]});
  for(let index=0;index<chunks;index++)emit('probe.chunk',{text:'x'.repeat(65536),index},'run');
 });
 return {handler,server,metrics,owner,cookie,streamHandled};
}
async function openPaused(t,app,route){
 const socket=net.connect(app.server.address().port,'127.0.0.1');
 socket.on('error',()=>{});t.after(()=>socket.destroy());
 await once(socket,'connect');socket.pause();
 socket.write(`GET ${route} HTTP/1.1\r\nHost: 127.0.0.1:${app.server.address().port}\r\nCookie: ${app.cookie}\r\n\r\n`);
 await app.streamHandled;return socket;
}
function receiveEvents(socket,count){
 return new Promise((resolve,reject)=>{
  let bytes='';const timer=setTimeout(()=>{socket.off('data',onData);reject(Error('Synthetic SSE events did not arrive'));},10000);
  const onData=chunk=>{
   bytes+=chunk.toString('utf8');
   const events=[...bytes.matchAll(/data: (\{[^\n]+\})\n/g)].map(match=>JSON.parse(match[1]));
   if(events.length>=count){clearTimeout(timer);socket.off('data',onData);resolve(events);}
  };
  socket.on('data',onData);socket.resume();
 });
}

for(const route of ['/api/harness/conversations/synthetic/events','/api/harness/runs/run/events']){
 test('backpressure bounds actual SSE replay and resumes durable live events exactly once: '+route,{timeout:30000},async t=>{
  const app=await setup(t),socket=await openPaused(t,app,route);
  assert.equal(app.metrics.writes,1,'Only the first rejected write may enter a corked response');
  assert.equal(app.metrics.falseWrites,1);assert.ok(app.metrics.maxBuffered<70000);
  assert.equal(app.handler.store.listeners.get('synthetic').size,1);
  await app.handler.store.transaction(app.owner,'synthetic',(s,emit)=>emit('probe.live',{text:'COMMITTED_WHILE_CLIENT_BLOCKED'},'run'));
  assert.equal(app.metrics.writes,1,'Store commit must not add another blocked-client payload');
  const received=receiveEvents(socket,49);app.metrics.res.uncork();
  const events=await received;
  assert.deepEqual(events.map(event=>event.seq),Array.from({length:49},(_,index)=>index+1));
  assert.equal(events.at(-1).data.text,'COMMITTED_WHILE_CLIENT_BLOCKED');
  assert.deepEqual(app.metrics.errors,[]);
  socket.destroy();await until(()=>!app.handler.store.listeners.has('synthetic'));
  if(app.handler.workflows.streams)assert.equal(app.handler.workflows.streams.size,0);
 });
 test('ending an actual backpressured SSE prevents post-end writes and releases listeners: '+route,{timeout:30000},async t=>{
  const app=await setup(t),socket=await openPaused(t,app,route);
  const write=app.handler.store.write.bind(app.handler.store);let closing;
  // Begin shutdown after the real fsync, before this in-flight commit publishes.
  app.handler.store.write=async state=>{await write(state);closing??=app.handler.close();};
  await app.handler.store.transaction(app.owner,'synthetic',(s,emit)=>emit('probe.during-close',{text:'SYNTHETIC_SHUTDOWN_EVENT'},'run'));
  app.handler.store.write=write;
  await closing;
  await new Promise(setImmediate);
  assert.equal(app.metrics.res.writableEnded,true);
  assert.equal(app.metrics.afterEndWrites,0);
  assert.deepEqual(app.metrics.errors,[],'Shutdown must not emit ERR_STREAM_WRITE_AFTER_END');
  assert.equal(app.handler.store.listeners.has('synthetic'),false);
  socket.destroy();
 });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DeviceSessions} from '../harness/device-sessions.mjs';
import {createDeviceSessionsHandler} from '../harness/device-sessions-http.mjs';
async function setup(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'grok-device-http-')),sessions=await new DeviceSessions({dataDir}).init(),revoked=[];
 const csrf=owner=>createHash('sha256').update('test-only:'+owner).digest('hex'),setCookie=(res,token)=>res.setHeader('Set-Cookie','grok_harness_owner='+token+'; HttpOnly; SameSite=Strict; Path=/api/harness');
 const json=(res,status,value)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));
 const body=async req=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text||'{}');};
 let hasHistory=false;
 const handler=createDeviceSessionsHandler({sessions,json,body,setCookie,csrf,canReplaceOwner:async()=>!hasHistory,onRevoke:id=>{revoked.push(id);}});
 const server=http.createServer((req,res)=>{void(async()=>{
  const raw=(req.headers.cookie||'').split(';').find(value=>value.trim().startsWith('grok_harness_owner='))?.trim().slice(19),session=await sessions.resolve(raw);
  if(session.changed)setCookie(res,session.token);
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'&&req.headers['x-harness-csrf']!==csrf(session.owner))return json(res,403,{error:{code:'INVALID_CSRF'}});
  if(url.pathname==='/api/harness/status')return json(res,200,{...sessions.publicSession(session),csrfToken:csrf(session.owner)});
  if(!await handler(req,res,{session,url}))json(res,404,{error:{code:'NOT_FOUND'}});
 })().catch(error=>json(res,error.status||500,{error:{code:error.code||'INTERNAL_ERROR'}}));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+server.address().port;
 async function client(){let cookie='',csrfToken='';
  const request=async(route,{method='GET',body,headers={}}={})=>{
   const res=await fetch(origin+'/api/harness'+route,{method,headers:{cookie,'x-harness-csrf':csrfToken,'Content-Type':'application/json',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   const next=res.headers.get('set-cookie');if(next)cookie=next.split(';')[0];const value=await res.json();if(value.csrfToken)csrfToken=value.csrfToken;return{status:res.status,value,setCookie:next};
  };
  await request('/status');return{request,get cookie(){return cookie;}};
 }
 return{client,revoked,setHasHistory:value=>{hasHistory=value;}};
}
test('actual HTTP uses distinct revocable cookies, safe principal scopes and rotated CSRF after pairing',async t=>{
 const {client,revoked}=await setup(t),a=await client(),b=await client(),oldB=b.cookie;
 const aStatus=(await a.request('/status')).value,bStatus=(await b.request('/status')).value;
 assert.notEqual(aStatus.principalScope,bStatus.principalScope);
 const pairing=await a.request('/devices/pairing',{method:'POST',body:{}});assert.equal(pairing.status,201);
 const accepted=await b.request('/devices/pairing/accept',{method:'POST',body:{code:pairing.value.code,label:'Second browser'}});
 assert.equal(accepted.status,200);assert.equal(accepted.value.principalScope,aStatus.principalScope);assert.notEqual(b.cookie,a.cookie);assert.notEqual(b.cookie,oldB);
 assert.equal(Object.hasOwn(accepted.value,'token'),false);assert.equal(Object.hasOwn(accepted.value,'owner'),false);assert.match(accepted.setCookie,/HttpOnly/);assert.match(accepted.setCookie,/SameSite=Strict/);
 const devices=(await a.request('/devices')).value;assert.equal(devices.devices.length,2);assert.equal(devices.devices.find(row=>row.id===accepted.value.deviceId).label,'Second browser');
 const rejected=await b.request('/devices/pairing',{method:'POST',body:{},headers:{'x-harness-csrf':bStatus.csrfToken}});assert.equal(rejected.status,403);
 const revoke=await a.request('/devices/'+accepted.value.deviceId+'/revoke',{method:'POST',body:{}});assert.equal(revoke.status,200);assert.ok(revoked.includes(accepted.value.deviceId));
 const after=(await b.request('/status')).value;assert.notEqual(after.principalScope,aStatus.principalScope);assert.notEqual(b.cookie,oldB);
});
test('self revocation rotates into an isolated identity and unknown routes do not mutate access',async t=>{
 const {client}=await setup(t),a=await client(),before=(await a.request('/status')).value;
 const unknown=await a.request('/devices/unknown',{method:'POST',body:{}});assert.equal(unknown.status,404);
 const result=await a.request('/devices/'+before.deviceId+'/revoke',{method:'POST',body:{}});
 assert.equal(result.status,200);assert.equal(result.value.current,true);assert.notEqual(result.value.principalScope,before.principalScope);
 assert.equal((await a.request('/devices')).value.devices.length,1);
});

test('existing independent server history blocks pairing before consuming the code or changing cookies',async t=>{
 const {client,setHasHistory}=await setup(t),a=await client(),b=await client(),originalCookie=b.cookie,original=(await b.request('/status')).value;
 const pairing=await a.request('/devices/pairing',{method:'POST',body:{}});setHasHistory(true);
 const refused=await b.request('/devices/pairing/accept',{method:'POST',body:{code:pairing.value.code}});
 assert.equal(refused.status,409);assert.equal(refused.value.error.code,'DEVICE_HAS_HISTORY');assert.equal(b.cookie,originalCookie);assert.equal((await b.request('/status')).value.principalScope,original.principalScope);
 setHasHistory(false);const accepted=await b.request('/devices/pairing/accept',{method:'POST',body:{code:pairing.value.code}});assert.equal(accepted.status,200);
});

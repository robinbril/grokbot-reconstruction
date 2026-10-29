import {timingSafeEqual} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import {pipeline} from 'node:stream/promises';
import {harnessError} from './store.mjs';
import {secureOAuthFetch} from './identity/oauth-fetch.mjs';

const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=(res,error)=>{
 if(res.headersSent){res.end();return;}
 res.writeHead(error.status??502,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify({error:{code:error.code??'ACCOUNT_PROXY_ERROR',message:error.status?error.message:'Account connection failed'}}));
};
function redact(secret){
 const patterns=[...new Set([secret,JSON.stringify(secret).slice(1,-1)])],keep=Math.max(...patterns.map(s=>s.length))-1,decoder=new StringDecoder('utf8');let pending='';
 const clean=value=>patterns.reduce((text,pattern)=>text.split(pattern).join('[REDACTED]'),value);
 return new Transform({transform(chunk,encoding,done){pending=clean(pending+decoder.write(chunk));const length=Math.max(0,pending.length-keep);this.push(pending.slice(0,length));pending=pending.slice(length);done();},flush(done){this.push(clean(pending+decoder.end()));done();}});
}
async function readBody(req){
 const chunks=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>131072)throw harnessError('BODY_TOO_LARGE','MCP request exceeds 128 KiB',413);chunks.push(chunk);}
 if(!length)return undefined;
 const text=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(text);}catch{throw harnessError('INVALID_JSON','Invalid MCP request',400);}
 if(!value||typeof value!=='object'||Array.isArray(value)||value.jsonrpc!=='2.0')throw harnessError('INVALID_JSON','Expected one MCP JSON-RPC request',400);
 return {text,value};
}
export function createAccountProxy({accounts,access,runtime,fetchImpl=secureOAuthFetch}){
 const active=new Map();
 const abortAccount=id=>{for(const [controller,context] of active)if(context.accountId===id)controller.abort();};
 const abortAll=()=>{for(const controller of active.keys())controller.abort();};
 async function handle(req,res,url){
  const match=url.pathname.match(/^\/api\/harness\/internal\/([A-Za-z0-9_-]+)\/accounts\/([A-Za-z0-9_-]+)\/mcp$/);if(!match)return false;
  const c=runtime.bridges.get(match[1]),accountId=match[2];
  if(!c||!equal(req.headers.authorization,'Bearer '+c.token)||!c.accountIds?.includes(accountId)){fail(res,harnessError('UNAUTHORIZED','Owned account proxy authorization required',401));return true;}
  const controller=new AbortController();active.set(controller,{accountId,c});
  req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
   if(!['GET','POST','DELETE'].includes(req.method))throw harnessError('METHOD_NOT_ALLOWED','Unsupported MCP method',405);
   const state=runtime.store.get(c.owner,c.id);if(!state?.botId)throw harnessError('ACCESS_DENIED','Conversation has no authorized Bot',403);
   const input=req.method==='POST'?await readBody(req):undefined;
   const binding=await access.accountUse(c.owner,state.botId,accountId);
   if(input?.value.method==='tools/call'&&binding.disabledTools.includes(input.value.params?.name))throw harnessError('ACCESS_DENIED','This tool is disabled',403);
   const credential=await accounts.getCredentialForUse(binding.accountOwner,accountId,{resourceUrl:binding.resourceUrl});
   const latestBinding=await access.accountUse(c.owner,state.botId,accountId);
   if(input?.value.method==='tools/call'&&latestBinding.disabledTools.includes(input.value.params?.name))throw harnessError('ACCESS_DENIED','This tool is disabled',403);
   controller.signal.throwIfAborted();
   const headers={Authorization:'Bearer '+credential.accessToken,Accept:'application/json, text/event-stream'};
   for(const name of ['content-type','mcp-session-id','mcp-protocol-version','last-event-id'])if(req.headers[name])headers[name]=req.headers[name];
   const upstream=await fetchImpl(binding.resourceUrl,{method:req.method,headers,body:input?.text,signal:controller.signal,redirect:'error',timeoutMs:300000});
   if(upstream.status===401){await accounts.requireAuthentication(binding.accountOwner,accountId,{expectedAccessToken:credential.accessToken});throw harnessError('OAUTH_REAUTH_REQUIRED','Sign in again to reconnect this account',401);}
   const responseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
   for(const name of ['content-type','mcp-session-id','mcp-protocol-version'])if(upstream.headers.get(name)&&!upstream.headers.get(name).includes(credential.accessToken))responseHeaders[name]=upstream.headers.get(name);
   res.writeHead(upstream.status,responseHeaders);
   if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),redact(credential.accessToken),res);else res.end();
  }catch(error){fail(res,error);}finally{active.delete(controller);}
  return true;
 }
 async function abortUnauthorized(){
  for(const [controller,{c,accountId}] of active){
   try{const state=runtime.store.get(c.owner,c.id);await access.accountUse(c.owner,state?.botId,accountId);}catch{controller.abort();}
  }
 }
 return {handle,abortAccount,abortAll,abortUnauthorized};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {OAuthAccounts} from '../harness/identity/oauth-accounts.mjs';
import {AccessControl} from '../harness/access/index.mjs';
import {createAccountProxy} from '../harness/account-proxy.mjs';
import {oauthFixture} from './fixtures/oauth-provider.mjs';

test('an existing OAuth MCP proxy refuses revoked team access before another upstream tool call',async t=>{
 const provider=await oauthFixture();t.after(()=>provider.close());const dataDir=await mkdtemp(path.join(tmpdir(),'proxy-proof-'));
 const accounts=await new OAuthAccounts({dataDir,baseUrl:'http://127.0.0.1:8876'}).init();
 const flow=await accounts.begin('a',{requestId:'start',resourceUrl:provider.resourceUrl});
 const authorize=await fetch(flow.authorizationUrl,{redirect:'manual'});
 const account=await accounts.callback({...Object.fromEntries(new URL(authorize.headers.get('location')).searchParams),browserBinding:flow.browserBinding});
 const access=await new AccessControl({dataDir,accountLookup:id=>accounts.getInternalAccount(id)}).init();
 const team=await access.createTeam('a',{requestId:'team',name:'Proof'});
 const invitation=await access.invite('a',team.id,{requestId:'invite',role:'member'});await access.join('b',{requestId:'join',token:invitation.token});
 await access.grantAccount('a',team.id,{requestId:'grant',accountId:account.id,enabled:true});
 const bot=await access.ensureBot('a',{requestId:'bot',clientKey:'proof',name:'Proof'});await access.shareBot('a',bot.id,{requestId:'share',teamId:team.id});await access.bindAccount('a',bot.id,{requestId:'bind',accountId:account.id});
 const c={id:'conversation',owner:'b',handle:'owned',token:'private-proxy-token',accountIds:[account.id]};
 const runtime={bridges:new Map([['owned',c]]),store:{get:()=>({botId:bot.id})}};
 const proxy=createAccountProxy({accounts,access,runtime});
 const server=http.createServer((req,res)=>proxy.handle(req,res,new URL(req.url,'http://127.0.0.1')).catch(()=>{res.writeHead(500).end();}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/api/harness/internal/owned/accounts/'+account.id+'/mcp';
 let sequence=0;const call=async()=>fetch(url,{method:'POST',headers:{authorization:'Bearer '+c.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name:'sum',arguments:{a:13,b:29}}})});
 const answer=await call();assert.equal(answer.status,200);assert.equal((await answer.json()).result.structuredContent.sum,42);assert.equal(provider.calls.length,1);
 await access.grantAccount('a',team.id,{requestId:'revoke',accountId:account.id,enabled:false});proxy.abortAll();
 assert.equal((await call()).status,403);assert.equal(provider.calls.length,1);
 assert.equal((await fetch(url,{headers:{authorization:'Bearer wrong'}})).status,401);
});

test('OAuth proxy redacts split token output and echoed headers and binds 401 to the used credential',async t=>{
 const secret='old-sensitive-access-token',newSecret='new-sensitive-access-token';let current=secret,invalidated=false,mode='echo',seen;
 const accounts={getCredentialForUse:async()=>({accessToken:current}),requireAuthentication:async(owner,id,options)=>{seen=options;if(current===options?.expectedAccessToken)invalidated=true;}};
 const access={accountUse:async()=>({accountOwner:'owner',resourceUrl:'https://example.com/mcp',disabledTools:[]})};
 const c={owner:'owner',id:'chat',handle:'owned',token:'own-bridge-token',accountIds:['account']};
 const runtime={bridges:new Map([['owned',c]]),store:{get:()=>({botId:'bot'})}};
 const proxy=createAccountProxy({accounts,access,runtime,fetchImpl:async()=>{
  if(mode==='401'){current=newSecret;return new Response('',{status:401});}
  return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('before '+secret.slice(0,8)));controller.enqueue(new TextEncoder().encode(secret.slice(8)+' after'));controller.close();}}),{headers:{'content-type':'text/plain','mcp-session-id':secret}});
 }});
 const server=http.createServer((req,res)=>proxy.handle(req,res,new URL(req.url,'http://127.0.0.1')));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=()=>fetch('http://127.0.0.1:'+server.address().port+'/api/harness/internal/owned/accounts/account/mcp',{headers:{authorization:'Bearer '+c.token}});
 const echoed=await call();assert.equal(echoed.headers.get('mcp-session-id'),null);assert.equal(await echoed.text(),'before [REDACTED] after');
 mode='401';assert.equal((await call()).status,401);assert.deepEqual(seen,{expectedAccessToken:secret});assert.equal(invalidated,false);assert.equal(current,newSecret);
});

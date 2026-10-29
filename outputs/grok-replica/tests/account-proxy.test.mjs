import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable,Writable} from 'node:stream';
import {createAccountProxy} from '../harness/account-proxy.mjs';

function responseSink(){
 const chunks=[];
 const res=new Writable({write(chunk,_encoding,done){chunks.push(chunk);done();}});
 res.writeHead=status=>{res.statusCode=status;res.headersSent=true;return res;};
 res.body=()=>JSON.parse(Buffer.concat(chunks).toString());
 return res;
}

test('MCP tool disabled while credentials refresh never reaches upstream dispatch',async()=>{
 let disabledTools=[],fetches=0,checks=0,releaseCredential,credentialStarted;
 const refreshing=new Promise(resolve=>{credentialStarted=resolve;});
 const credentialGate=new Promise(resolve=>{releaseCredential=resolve;});
 const accounts={async getCredentialForUse(){credentialStarted();await credentialGate;return {accessToken:'synthetic-token'};}};
 const access={async accountUse(){checks++;return {accountOwner:'owner',resourceUrl:'https://example.test/mcp',disabledTools:[...disabledTools]};}};
 const c={owner:'owner',id:'chat',token:'synthetic-bridge',accountIds:['account']};
 const runtime={bridges:new Map([['owned',c]]),store:{get:()=>({botId:'bot'})}};
 const proxy=createAccountProxy({accounts,access,runtime,fetchImpl:async()=>{fetches++;return new Response('{}');}});
 const req=Readable.from([Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'sum',arguments:{a:1,b:2}}}))]);
 req.method='POST';req.headers={authorization:'Bearer '+c.token,'content-type':'application/json'};
 const res=responseSink();
 const handling=proxy.handle(req,res,new URL('http://127.0.0.1/api/harness/internal/owned/accounts/account/mcp'));
 await refreshing;disabledTools=['sum'];releaseCredential();
 assert.equal(await handling,true);
 assert.equal(checks,2);
 assert.equal(fetches,0,'new policy must prevent the upstream tool request');
 assert.equal(res.statusCode,403);
 assert.equal(res.body().error.code,'ACCESS_DENIED');
});

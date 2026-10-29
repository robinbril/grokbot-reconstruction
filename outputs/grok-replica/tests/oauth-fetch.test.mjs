import test from 'node:test';
import assert from 'node:assert/strict';
import {createOAuthFetch,secureOAuthFetch} from '../harness/identity/oauth-fetch.mjs';
import {oauthFixture} from './fixtures/oauth-provider.mjs';

test('HTTPS literal/private and all private DNS answers fail before network I/O',async()=>{
 for(const address of ['127.0.0.1','10.2.3.4','169.254.169.254','172.16.0.1','192.168.1.2','[::1]','[::ffff:127.0.0.1]','[fc00::1]','[fe80::1]'])await assert.rejects(secureOAuthFetch(`https://${address}/token`),{code:'OAUTH_NETWORK_DENIED'});
 let resolves=0;const fetchImpl=createOAuthFetch({lookup:async()=>{resolves++;return [{address:'8.8.8.8',family:4},{address:'192.168.1.1',family:4}];}});
 await assert.rejects(fetchImpl('https://provider.example/token'),{code:'OAUTH_NETWORK_DENIED'});assert.equal(resolves,1);
});

test('owned literal HTTP fixture works; browser consent is explicit; redirect is never followed',async t=>{
 const provider=await oauthFixture({consent:true});t.after(()=>provider.close());const resource=new URL(provider.resourceUrl);const url=new URL('/authorize',resource);url.searchParams.set('redirect_uri','http://127.0.0.1:8876/api/harness/oauth/callback');url.searchParams.set('state','test');
 const consent=await secureOAuthFetch(url);assert.equal(consent.status,200);const html=await consent.text();assert.match(html,/form/);assert.match(html,/Allow/);
 const approval=await secureOAuthFetch(new URL('/approve',resource),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:url.searchParams.toString(),redirect:'manual'});assert.equal(approval.status,302);assert.match(approval.headers.get('location'),/code=/);
 await assert.rejects(secureOAuthFetch('http://localhost:8876/'),{code:'OAUTH_NETWORK_DENIED'});
});

test('transport timeout also bounds DNS resolution before a socket exists',async()=>{
 const fetchImpl=createOAuthFetch({lookup:()=>new Promise(()=>{})});const result=await Promise.race([fetchImpl('https://provider.example/token',{timeoutMs:10}).then(()=>false,()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),60))]);assert.equal(result,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {OAuthAccounts} from '../harness/identity/oauth-accounts.mjs';

async function service(options={}){return new OAuthAccounts({dataDir:await mkdtemp(path.join(tmpdir(),'provider-oauth-')),baseUrl:'http://127.0.0.1:8876',providerEnv:{},...options}).init();}
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('provider catalog is explicit, secret-free and fails closed for missing GitHub configuration',async()=>{
 const accounts=await service({fetchImpl:()=>assert.fail('Missing configuration must not contact provider')});
 const providers=accounts.listProviders();assert.deepEqual(providers.map(p=>p.id),['github','notion']);
 assert.equal(providers[0].status,'setupRequired');assert.equal(providers[1].status,'ready');
 assert.deepEqual(providers[0].setup.environmentVariables,['GROK_GITHUB_OAUTH_CLIENT_ID','GROK_GITHUB_OAUTH_CLIENT_SECRET']);
 await assert.rejects(accounts.beginProvider('owner','github',{requestId:'one'}),{code:'OAUTH_PROVIDER_SETUP_REQUIRED'});
 await assert.rejects(accounts.beginProvider('owner','other',{requestId:'two'}),{code:'OAUTH_PROVIDER_UNKNOWN'});
 await assert.rejects(accounts.beginProvider('owner','notion',{requestId:'three',resourceUrl:'https://evil.example/mcp'}),{code:'OAUTH_PROVIDER_INPUT_INVALID'});
});

test('GitHub preset keeps confidential credentials encrypted and enforces PKCE/browser binding with nonexpiring OAuth tokens',async()=>{
 const requests=[];let clock=Date.now();const accounts=await service({clock:()=>clock,providerEnv:{GROK_GITHUB_OAUTH_CLIENT_ID:'test-client',GROK_GITHUB_OAUTH_CLIENT_SECRET:'backend-only-secret'},fetchImpl:async(url,options)=>{if(String(url).includes('oauth-protected-resource'))return json({resource:'https://api.githubcopilot.com/mcp/',authorization_servers:['https://github.com/login/oauth']});if(String(url).includes('oauth-authorization-server'))return json({issuer:'https://github.com/login/oauth',authorization_endpoint:'https://github.com/login/oauth/authorize',token_endpoint:'https://github.com/login/oauth/access_token',code_challenge_methods_supported:['S256']});requests.push({url:String(url),options});assert.equal(String(url),'https://github.com/login/oauth/access_token');assert.equal(options.headers.accept,'application/json');const body=new URLSearchParams(options.body);assert.equal(body.get('client_secret'),'backend-only-secret');assert.ok(body.get('code_verifier'));assert.equal(body.get('resource'),'https://api.githubcopilot.com/mcp/');return json({access_token:'fixture-github-token',token_type:'bearer',scope:'repo'});}});
 const flow=await accounts.beginProvider('owner','github',{requestId:'github-1',name:'My GitHub'});const auth=new URL(flow.authorizationUrl);
 assert.equal(auth.origin,'https://github.com');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('client_id'),'test-client');assert.ok(!JSON.stringify(flow).includes('backend-only-secret'));assert.ok(!JSON.stringify(accounts.listProviders()).includes('backend-only-secret'));
 await assert.rejects(accounts.callback({state:auth.searchParams.get('state'),code:'fixture-code',browserBinding:'wrong'}),{code:'OAUTH_BROWSER_MISMATCH'});assert.equal(requests.length,0);
 const account=await accounts.callback({state:auth.searchParams.get('state'),code:'fixture-code',browserBinding:flow.browserBinding});assert.equal(account.providerId,'github');clock+=365*86400000;assert.equal((await accounts.getCredentialForUse('owner',account.id)).accessToken,'fixture-github-token');assert.equal(requests.length,1);
 assert.ok(!JSON.stringify(accounts.list('owner')).includes('fixture-github-token'));
 const persisted=await readFile(accounts.storage.filename,'utf8');assert.ok(!persisted.includes('backend-only-secret'));assert.ok(!persisted.includes('fixture-github-token'));
});

test('Notion preset uses discovered public DCR while generic tokens still require expiry',async()=>{
 const requests=[];const accounts=await service({fetchImpl:async(url,options)=>{const location=String(url);requests.push({location,options});
 if(location.includes('oauth-protected-resource'))return json({resource:'https://mcp.notion.com/mcp',authorization_servers:['https://mcp.notion.com']});
 if(location.includes('oauth-authorization-server'))return json({issuer:'https://mcp.notion.com',authorization_endpoint:'https://mcp.notion.com/authorize',token_endpoint:'https://mcp.notion.com/token',registration_endpoint:'https://mcp.notion.com/register',code_challenge_methods_supported:['S256']});
 if(location.endsWith('/register')){assert.equal(JSON.parse(options.body).token_endpoint_auth_method,'none');return json({client_id:'notion-public',token_endpoint_auth_method:'none'});}
 if(location.endsWith('/token'))return json({access_token:'notion-token',token_type:'Bearer'});assert.fail(location);
 }});
 const flow=await accounts.beginProvider('owner','notion',{requestId:'notion-1'});const auth=new URL(flow.authorizationUrl);assert.equal(auth.searchParams.get('resource'),'https://mcp.notion.com/mcp');
 await assert.rejects(accounts.callback({state:auth.searchParams.get('state'),code:'code',browserBinding:flow.browserBinding}),{code:'OAUTH_TOKEN_INVALID'});assert.equal(accounts.list('owner').length,0);
});

test('provider discovery cannot replace the expected issuer before confidential credentials are used',async()=>{
 let contacted=0;const accounts=await service({providerEnv:{GROK_GITHUB_OAUTH_CLIENT_ID:'client',GROK_GITHUB_OAUTH_CLIENT_SECRET:'server-secret'},fetchImpl:async(url)=>{
 contacted++;if(String(url).includes('oauth-protected-resource'))return json({resource:'https://api.githubcopilot.com/mcp/',authorization_servers:['https://other.example']});
 return json({issuer:'https://other.example',authorization_endpoint:'https://other.example/authorize',token_endpoint:'https://other.example/token',code_challenge_methods_supported:['S256']});
 }});
 await assert.rejects(accounts.beginProvider('owner','github',{requestId:'hostile-discovery'}),{code:'OAUTH_ISSUER_MISMATCH'});assert.equal(contacted,2);assert.equal(accounts.pendingFlows('owner').length,0);
});

test('Notion public registration exchanges PKCE, rotates refresh tokens and survives restart',async()=>{
 let clock=Date.now(),refreshes=0;const fetchImpl=async(url,options)=>{
 const location=String(url);if(location.includes('oauth-protected-resource'))return json({resource:'https://mcp.notion.com/mcp',authorization_servers:['https://mcp.notion.com']});
 if(location.includes('oauth-authorization-server'))return json({issuer:'https://mcp.notion.com',authorization_endpoint:'https://mcp.notion.com/authorize',token_endpoint:'https://mcp.notion.com/token',registration_endpoint:'https://mcp.notion.com/register',code_challenge_methods_supported:['S256']});
 if(location.endsWith('/register'))return json({client_id:'notion-client',token_endpoint_auth_method:'none'});
 assert.equal(location,'https://mcp.notion.com/token');const fields=new URLSearchParams(options.body);assert.equal(fields.get('client_secret'),null);assert.equal(fields.get('resource'),'https://mcp.notion.com/mcp');
 if(fields.get('grant_type')==='authorization_code'){assert.ok(fields.get('code_verifier'));return json({token_type:'Bearer',access_token:'notion-access-0',refresh_token:'notion-refresh-0',expires_in:28800});}
 assert.equal(fields.get('refresh_token'),'notion-refresh-'+refreshes);refreshes++;return json({token_type:'Bearer',access_token:'notion-access-'+refreshes,refresh_token:'notion-refresh-'+refreshes,expires_in:28800});
 };
 const accounts=await service({fetchImpl,clock:()=>clock});const flow=await accounts.beginProvider('owner','notion',{requestId:'notion-success'});const auth=new URL(flow.authorizationUrl);
 const account=await accounts.callback({state:auth.searchParams.get('state'),code:'notion-code',browserBinding:flow.browserBinding});assert.equal(account.providerId,'notion');
 const reloaded=await new OAuthAccounts({dataDir:path.dirname(accounts.storage.dir),baseUrl:'http://127.0.0.1:8876',clock:()=>clock,fetchImpl,providerEnv:{}}).init();
 for(let index=1;index<=2;index++){clock+=28800001;assert.equal((await reloaded.getCredentialForUse('owner',account.id)).accessToken,'notion-access-'+index);}assert.equal(refreshes,2);
 await assert.rejects(reloaded.beginProvider('other','notion',{requestId:'cross-owner',accountId:account.id}),{code:'NOT_FOUND'});
});

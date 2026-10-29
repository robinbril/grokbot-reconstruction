import {createServer} from 'node:http';
import {Server,WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {randomUUID,createHash} from 'node:crypto';
export async function oauthFixture({consent=false}={}){
 const calls=[],codes=new Map(),tokens=new Set(),refreshTokens=new Set();let origin;const metrics={refreshes:0,revocations:0,exchanges:0};
 const server=createServer(async(req,res)=>{const url=new URL(req.url,origin);const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/.well-known/oauth-protected-resource/mcp'||url.pathname==='/.well-known/oauth-protected-resource')return json(200,{resource:origin+'/mcp',authorization_servers:[origin],scopes_supported:['docs.read']});
 if(url.pathname==='/.well-known/oauth-authorization-server')return json(200,{issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',revocation_endpoint:origin+'/revoke',code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true});
 let raw='';if(req.method==='POST')for await(const chunk of req)raw+=chunk;const form=new URLSearchParams(raw);
 if(url.pathname==='/register'){const body=JSON.parse(raw);if(body.token_endpoint_auth_method!=='none')return json(400,{error:'invalid_client_metadata'});return json(201,{client_id:'fixture-public',token_endpoint_auth_method:'none'});}
 if(url.pathname==='/authorize'&&consent){const escape=value=>String(value).replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end('<!doctype html><title>OAuth consent</title><h1>Allow local MCP access?</h1><p>Project-owned test provider. Allows synthetic sum tasks.</p><form method="post" action="/approve">'+[...url.searchParams].map(([name,value])=>`<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join('')+'<button type="submit">Allow</button></form>');}
 if(url.pathname==='/approve'&&req.method==='POST'||url.pathname==='/authorize'&&!consent){if(url.pathname==='/approve')url.search=form.toString();const code=randomUUID();codes.set(code,Object.fromEntries(url.searchParams));const redirect=new URL(url.searchParams.get('redirect_uri'));redirect.searchParams.set('state',url.searchParams.get('state'));redirect.searchParams.set('code',code);redirect.searchParams.set('iss',origin);res.writeHead(302,{location:redirect.href});return res.end();}
 if(url.pathname==='/token'){
  if(form.get('grant_type')==='authorization_code'){const saved=codes.get(form.get('code'));codes.delete(form.get('code'));metrics.exchanges++;const challenge=createHash('sha256').update(form.get('code_verifier')??'').digest('base64url');if(!saved||saved.code_challenge!==challenge||saved.redirect_uri!==form.get('redirect_uri')||saved.resource!==form.get('resource')||saved.client_id!==form.get('client_id'))return json(400,{error:'invalid_grant'});}
  else if(form.get('grant_type')==='refresh_token'){if(!refreshTokens.delete(form.get('refresh_token')))return json(400,{error:'invalid_grant'});metrics.refreshes++;}else return json(400,{error:'unsupported_grant_type'});
  const access_token='access-'+randomUUID(),refresh_token='refresh-'+randomUUID();tokens.add(access_token);refreshTokens.add(refresh_token);return json(200,{access_token,refresh_token,token_type:'Bearer',expires_in:60,scope:'docs.read'});
 }
 if(url.pathname==='/revoke'){metrics.revocations++;tokens.delete(form.get('token'));refreshTokens.delete(form.get('token'));return json(200,{});}
 if(url.pathname==='/mcp'){
  if(!tokens.has((req.headers.authorization??'').replace(/^Bearer /,''))){res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);return json(401,{error:'unauthorized'});}
  if(req.method==='GET')return json(200,{ok:true});
  const mcp=new Server({name:'oauth-protected-proof',version:'1'},{capabilities:{tools:{}}});
  try{mcp.setRequestHandler('tools/list',async()=>({tools:[{name:'sum',description:'Compute a finite sum behind actual OAuth',inputSchema:{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b'],additionalProperties:false}}]}));
   mcp.setRequestHandler('tools/call',async incoming=>{const {name,arguments:args}=incoming.params;if(name!=='sum'||!Number.isFinite(args?.a)||!Number.isFinite(args?.b))return {isError:true,content:[{type:'text',text:'Expected finite a and b'}]};calls.push(structuredClone(incoming.params));const result={sum:args.a+args.b};return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};});
   const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await mcp.connect(transport);
   const answer=await transport.handleRequest(new Request(origin+req.url,{method:req.method,headers:req.headers,...(raw?{body:raw}:{})}));res.writeHead(answer.status,Object.fromEntries(answer.headers));return res.end(Buffer.from(await answer.arrayBuffer()));
  }finally{await mcp.close();}
 }
 json(404,{error:'not_found'});
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 return {calls,...Object.fromEntries(Object.keys(metrics).map(key=>[key,0])),get refreshes(){return metrics.refreshes;},get revocations(){return metrics.revocations;},get exchanges(){return metrics.exchanges;},resourceUrl:origin+'/mcp',close:()=>new Promise(resolve=>server.close(resolve))};
}

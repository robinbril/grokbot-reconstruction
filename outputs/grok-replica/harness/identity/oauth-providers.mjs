import {harnessError} from '../store.mjs';

const github={id:'github',name:'GitHub',resourceUrl:'https://api.githubcopilot.com/mcp/',documentationUrl:'https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md'};
const notion={id:'notion',name:'Notion',resourceUrl:'https://mcp.notion.com/mcp',documentationUrl:'https://developers.notion.com/guides/mcp/build-mcp-client'};
const required=['GROK_GITHUB_OAUTH_CLIENT_ID','GROK_GITHUB_OAUTH_CLIENT_SECRET'];
const configured=env=>required.every(key=>typeof env[key]==='string'&&env[key].trim()&&!/[\r\n]/.test(env[key]));
export function providerCatalog(env){
 return [github,notion].map(provider=>({...provider,status:provider.id==='github'&&!configured(env)?'setupRequired':'ready',...(provider.id==='github'&&!configured(env)?{setup:{message:'Registreer een GitHub OAuth-app met de getoonde callback-URL en configureer de client-ID en het clientgeheim op de server.',environmentVariables:required}}:{})}));
}
export function providerOptions(id,input,env){
 const preset=[github,notion].find(p=>p.id===id);if(!preset)throw harnessError('OAUTH_PROVIDER_UNKNOWN','Unknown account provider',404);
 if(Object.keys(input).some(key=>!['requestId','name','accountId'].includes(key)))throw harnessError('OAUTH_PROVIDER_INPUT_INVALID','Provider connection accepts only requestId, name and accountId',422);
 if(id==='github'&&!configured(env))throw harnessError('OAUTH_PROVIDER_SETUP_REQUIRED','Configure GROK_GITHUB_OAUTH_CLIENT_ID and GROK_GITHUB_OAUTH_CLIENT_SECRET on the server before connecting GitHub',422);
 return {input:{...input,resourceUrl:preset.resourceUrl,name:input.name??preset.name,...(id==='github'?{clientId:env.GROK_GITHUB_OAUTH_CLIENT_ID,scope:'repo read:org read:user offline_access'}:{})},trusted:{providerId:id,expectedIssuer:id==='github'?'https://github.com/login/oauth':'https://mcp.notion.com',...(id==='github'?{clientSecret:env.GROK_GITHUB_OAUTH_CLIENT_SECRET}:{})}};
}
export function tokenRequest(fields,credential){
 const request={method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({...fields,...(credential.clientSecret?{client_secret:credential.clientSecret}:{})}).toString()};
 return request;
}
export const permitsNonexpiring=credential=>credential.providerId==='github'&&credential.provider.issuer==='https://github.com/login/oauth'&&credential.resourceUrl===github.resourceUrl;

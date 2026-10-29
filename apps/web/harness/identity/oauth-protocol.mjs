import {harnessError} from '../store.mjs';
export function oauthUrl(value){
 if(typeof value!=='string'||value.length>2048||/[\s\\]/.test(value))throw harnessError('OAUTH_URL_INVALID','Expected HTTPS or literal loopback HTTP URL');
 let url;try{url=new URL(value);}catch{throw harnessError('OAUTH_URL_INVALID','Invalid OAuth URL');}
 const local=/^http:\/\/(127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(value);
 if((url.protocol!=='https:'&&!local)||url.username||url.password||url.hash)throw harnessError('OAUTH_URL_INVALID','Unsafe OAuth URL');return url;
}
export async function oauthJson(fetchImpl,url,options={}){
 const {allowEmpty,...requestOptions}=options;const safe=oauthUrl(url);const response=await fetchImpl(safe,{...requestOptions,redirect:'error',signal:AbortSignal.timeout(15000)});

 if(allowEmpty&&!response.body)return {};const reader=response.body.getReader();let size=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>131072){await reader.cancel();throw harnessError('OAUTH_PROVIDER_ERROR','OAuth response exceeds limit',502);}chunks.push(Buffer.from(value));}
 const text=Buffer.concat(chunks).toString();if(allowEmpty&&!text&&response.ok)return {};let body;try{body=JSON.parse(text);}catch{throw harnessError('OAUTH_PROVIDER_ERROR','Invalid OAuth response',502);}
 if(!response.ok){const error=harnessError('OAUTH_PROVIDER_ERROR',`OAuth provider returned HTTP ${response.status}`,502);error.providerStatus=response.status;if(['invalid_grant','invalid_client','invalid_request','temporarily_unavailable','server_error'].includes(body?.error))error.oauthError=body.error;throw error;}
 if(!body||typeof body!=='object'||Array.isArray(body))throw harnessError('OAUTH_PROVIDER_ERROR','Invalid OAuth response',502);return body;
}
export async function discover(fetchImpl,resourceUrl){
 const resource=oauthUrl(resourceUrl);if(resource.search)throw harnessError('OAUTH_URL_INVALID','Resource URL cannot contain a query');
 const metadata=new URL('/.well-known/oauth-protected-resource'+(resource.pathname==='/'?'':resource.pathname),resource);
 const protectedResource=await oauthJson(fetchImpl,metadata.href);
 if(protectedResource.resource!==resource.href||!Array.isArray(protectedResource.authorization_servers)||!protectedResource.authorization_servers.length)throw harnessError('OAUTH_METADATA_INVALID','Protected resource metadata does not match resource',422);
 const issuer=oauthUrl(protectedResource.authorization_servers[0]);if(resource.protocol==='https:'&&issuer.protocol!=='https:')throw harnessError('OAUTH_METADATA_INVALID','HTTPS resource cannot downgrade its issuer to HTTP',422);if(issuer.search)throw harnessError('OAUTH_METADATA_INVALID','Issuer cannot contain query',422);
 const location=new URL('/.well-known/oauth-authorization-server'+(issuer.pathname==='/'?'':issuer.pathname),issuer);
 const provider=await oauthJson(fetchImpl,location.href);
 if(provider.issuer!==issuer.href.replace(/\/$/,'')&&provider.issuer!==issuer.href)throw harnessError('OAUTH_METADATA_INVALID','Issuer metadata mismatch',422);
 if(!provider.code_challenge_methods_supported?.includes('S256'))throw harnessError('OAUTH_PKCE_REQUIRED','Provider must support S256 PKCE',422);
 for(const key of ['authorization_endpoint','token_endpoint','registration_endpoint','revocation_endpoint'])if(provider[key]){const endpoint=oauthUrl(provider[key]);if(issuer.protocol==='https:'&&endpoint.protocol!=='https:')throw harnessError('OAUTH_METADATA_INVALID','OAuth endpoints must use HTTPS',422);}
 if(!provider.authorization_endpoint||!provider.token_endpoint)throw harnessError('OAUTH_METADATA_INVALID','OAuth endpoints missing',422);
 return {resourceUrl:resource.href,provider};
}
export const formRequest=value=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(value).toString()});
export function normalizeTokens(value,clock,previous={},allowNonexpiring=false){
 if(value.token_type?.toLowerCase()!=='bearer'||typeof value.access_token!=='string'||!value.access_token||value.access_token.length>16384||/[\r\n]/.test(value.access_token)||(!(allowNonexpiring&&value.expires_in===undefined)&&(!Number.isFinite(Number(value.expires_in))||Number(value.expires_in)<=0)))throw harnessError('OAUTH_TOKEN_INVALID','Provider did not return a valid expiring bearer token',502);
 if(value.refresh_token!==undefined&&(typeof value.refresh_token!=='string'||value.refresh_token.length>16384||/[\r\n]/.test(value.refresh_token)))throw harnessError('OAUTH_TOKEN_INVALID','Invalid refresh token',502);
 return {accessToken:value.access_token,refreshToken:value.refresh_token??previous.refreshToken,expiresAt:allowNonexpiring&&value.expires_in===undefined?null:clock()+Number(value.expires_in)*1000,scope:typeof value.scope==='string'?value.scope:previous.scope??''};
}

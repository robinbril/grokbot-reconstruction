import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {harnessError,identifier} from '../store.mjs';
import {secureOAuthFetch} from './oauth-fetch.mjs';
import {EncryptedStore} from './encrypted-store.mjs';
import {oauthUrl,oauthJson,discover,normalizeTokens} from './oauth-protocol.mjs';
import {providerCatalog,providerOptions,tokenRequest,permitsNonexpiring} from './oauth-providers.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const publicAccount=a=>({revokeConfirmed:a.revokeConfirmed??false,...(a.revocationError?{revocationError:a.revocationError}:{}),id:a.id,name:a.name,...(a.providerId?{providerId:a.providerId}:{}),resourceUrl:a.resourceUrl,issuer:a.provider.issuer,status:a.status,isDefault:a.isDefault,scope:a.scope,createdAt:a.createdAt,updatedAt:a.updatedAt});
function nameOf(value){if(typeof value!=='string'||!value.trim()||value.length>100)throw harnessError('INVALID_ACCOUNT_NAME','Account name must contain 1–100 characters');return value.trim();}
export class OAuthAccounts {
 constructor({dataDir,baseUrl,fetchImpl=secureOAuthFetch,clock=Date.now,providerEnv=process.env}){this.providerEnv=providerEnv;this.storage=new EncryptedStore(dataDir);this.fetch=fetchImpl;this.clock=clock;this.callbackUrl=new URL('/api/harness/oauth/callback',oauthUrl(baseUrl)).href;this.tail=Promise.resolve();}
 async init(){await this.storage.init();let changed=false;for(const flow of this.storage.data.flows)if(flow.status==='exchanging'){flow.status='error';flow.error={code:'OAUTH_INTERRUPTED',message:'Sign-in was interrupted by a restart; start again'};delete flow.verifier;changed=true;}if(changed)await this.storage.save();return this;}
 transaction(operation){const task=this.tail.then(operation);this.tail=task.catch(()=>{});return task;}
 getInternalAccount(id){const a=this.storage.data.accounts.find(a=>a.id===id);if(!a)throw harnessError('NOT_FOUND','Account not found',404);return {owner:a.owner,id:a.id,name:a.name,...(a.providerId?{providerId:a.providerId}:{}),resourceUrl:a.resourceUrl,status:a.status};}
 pendingFlows(owner){return this.storage.data.flows.filter(f=>f.owner===owner&&['pending','exchanging'].includes(f.status)&&f.expiresAt>this.clock()).map(f=>({flowId:f.id,status:f.status,...(f.providerId?{providerId:f.providerId}:{}),authorizationUrl:f.authorizationUrl,expiresAt:f.expiresAt}));}
 list(owner){return this.storage.data.accounts.filter(a=>a.owner===owner).map(publicAccount);}
 account(owner,id){const account=this.storage.data.accounts.find(a=>a.id===id&&a.owner===owner);if(!account)throw harnessError('NOT_FOUND','Account not found',404);return account;}
 flowIdForState(state){if(typeof state!=='string'||state.length>200)throw harnessError('OAUTH_STATE_INVALID','Invalid or expired OAuth state');const f=this.storage.data.flows.find(f=>f.stateHash===digest(state)&&f.status==='pending'&&f.expiresAt>this.clock());if(!f)throw harnessError('OAUTH_STATE_INVALID','Invalid or expired OAuth state');return f.id;}
 flow(owner,id){const f=this.storage.data.flows.find(f=>f.owner===owner&&f.id===id);if(!f)throw harnessError('NOT_FOUND','Sign-in flow not found',404);return {flowId:f.id,...(f.providerId?{providerId:f.providerId}:{}),status:f.status==='pending'&&f.expiresAt<=this.clock()?'expired':f.status,expiresAt:f.expiresAt,...(f.accountId?{accountId:f.accountId}:{}),...(f.error?{error:f.error}:{})};}
 async cancelFlow(owner,id){return this.transaction(async()=>{this.flow(owner,id);const f=this.storage.data.flows.find(f=>f.owner===owner&&f.id===id);if(f.status==='pending'){f.status='cancelled';delete f.verifier;await this.storage.save();}return this.flow(owner,id);});}
 listProviders(){return providerCatalog(this.providerEnv).map(provider=>({...provider,callbackUrl:this.callbackUrl}));}
 async beginProvider(owner,id,input){const options=providerOptions(id,input,this.providerEnv);return this.begin(owner,options.input,options.trusted);}
 async begin(owner,input,trusted={}){return this.transaction(async()=>{
  const {requestId,resourceUrl,clientId,accountId}=input;if(!identifier(requestId)||typeof owner!=='string'||!owner)throw harnessError('INVALID_REQUEST_ID','Valid owner and request identifier required');
  const resource=oauthUrl(resourceUrl);if(resource.search)throw harnessError('OAUTH_URL_INVALID','Resource cannot contain query');
  const existing=accountId?this.account(owner,accountId):null,scope=input.scope??existing?.scope??'';if(existing&&existing.resourceUrl!==resource.href)throw harnessError('OAUTH_RESOURCE_MISMATCH','Account is bound to a different MCP resource',403);
  if(typeof scope!=='string'||scope.length>2000||/[\r\n]/.test(scope)||(clientId!==undefined&&(typeof clientId!=='string'||!clientId||clientId.length>2000)))throw harnessError('OAUTH_INPUT_INVALID','Invalid OAuth client or scope');
  const name=nameOf(existing?.name??input.name??resource.hostname),hash=digest(JSON.stringify({resourceUrl:resource.href,clientId,scope,name,accountId,providerId:trusted.providerId})),key=digest(owner+':'+requestId),prior=this.storage.data.requests[key];
  if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','OAuth request identifier reused with different input',409);if(prior.expiresAt<=this.clock())throw harnessError('OAUTH_FLOW_EXPIRED','Start sign-in with a new request identifier',409);return structuredClone(prior.response);}
  const discovered=await discover(this.fetch,resource.href),provider=discovered.provider;if(trusted.expectedIssuer&&provider.issuer!==trusted.expectedIssuer)throw harnessError('OAUTH_ISSUER_MISMATCH','Provider discovery returned an unexpected authorization server',422);if(existing&&existing.provider.issuer!==provider.issuer)throw harnessError('OAUTH_ISSUER_MISMATCH','Existing account issuer changed',409);let publicClientId=clientId??existing?.clientId;
  if(!publicClientId){if(!provider.registration_endpoint)throw harnessError('OAUTH_CLIENT_REQUIRED','Provider requires a registered public client ID',422);const registration=await oauthJson(this.fetch,provider.registration_endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Grok local replica',redirect_uris:[this.callbackUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});if(typeof registration.client_id!=='string'||!registration.client_id||registration.client_secret||(registration.token_endpoint_auth_method&&registration.token_endpoint_auth_method!=='none'))throw harnessError('OAUTH_CLIENT_UNSUPPORTED','Provider did not register a public OAuth client',422);publicClientId=registration.client_id;}
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url'),expiresAt=this.clock()+600000,id=randomUUID(),browserBinding=randomBytes(32).toString('base64url');
  const flow={id,owner,...(trusted.providerId?{providerId:trusted.providerId}:{}),...(trusted.clientSecret?{clientSecret:trusted.clientSecret}:{}),...(accountId?{accountId}:{}),browserBindingHash:digest(browserBinding),stateHash:digest(state),verifier,provider,clientId:publicClientId,resourceUrl:resource.href,scope,name,expiresAt,redirectUri:this.callbackUrl,status:'pending'};
  const authorization=new URL(provider.authorization_endpoint);for(const [k,v]of Object.entries({response_type:'code',client_id:publicClientId,redirect_uri:this.callbackUrl,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:resource.href,...(scope?{scope}:{})}))authorization.searchParams.set(k,v);
  flow.authorizationUrl=authorization.href;const response={authorizationUrl:authorization.href,flowId:id,expiresAt,browserBinding,...(trusted.providerId?{providerId:trusted.providerId}:{})};this.storage.data.flows.push(flow);this.storage.data.requests[key]={hash,expiresAt,response};await this.storage.save();return response;
 });}
 async callback({state,code,iss,error,browserBinding}){return this.transaction(async()=>{
  if(typeof state!=='string'||state.length>200)throw harnessError('OAUTH_STATE_INVALID','Invalid or expired OAuth state',400);
  const flow=this.storage.data.flows.find(f=>f.stateHash===digest(state)&&f.status==='pending'&&f.expiresAt>this.clock());if(!flow)throw harnessError('OAUTH_STATE_INVALID','Invalid or expired OAuth state',400);
  if(typeof browserBinding!=='string'||digest(browserBinding)!==flow.browserBindingHash)throw harnessError('OAUTH_BROWSER_MISMATCH','Sign-in must finish in the browser that started it',400);
  flow.status='exchanging';await this.storage.save();
  try{
  if((iss!==undefined&&iss!==flow.provider.issuer)||(flow.provider.authorization_response_iss_parameter_supported&&iss!==flow.provider.issuer))throw harnessError('OAUTH_ISSUER_MISMATCH','Authorization response issuer mismatch',400);
  if(error)throw harnessError('OAUTH_DENIED','Authorization was declined or failed',400);
  if(typeof code!=='string'||!code||code.length>4096)throw harnessError('OAUTH_CODE_INVALID','Missing authorization code',400);
  const token=await oauthJson(this.fetch,flow.provider.token_endpoint,tokenRequest({grant_type:'authorization_code',code,code_verifier:flow.verifier,client_id:flow.clientId,redirect_uri:flow.redirectUri,resource:flow.resourceUrl},flow));
  const tokens=normalizeTokens(token,this.clock,{},permitsNonexpiring(flow)),at=this.clock(),existing=flow.accountId?this.account(flow.owner,flow.accountId):null;const account={id:existing?.id??randomUUID(),owner:flow.owner,name:existing?.name??flow.name,resourceUrl:flow.resourceUrl,provider:flow.provider,clientId:flow.clientId,...(flow.providerId?{providerId:flow.providerId}:{}),...(flow.clientSecret?{clientSecret:flow.clientSecret}:{}),...tokens,status:'connected',isDefault:existing?existing.isDefault:!this.storage.data.accounts.some(a=>a.owner===flow.owner&&a.resourceUrl===flow.resourceUrl&&a.isDefault),createdAt:existing?.createdAt??at,updatedAt:at};
  if(existing)Object.assign(existing,account,{revokeConfirmed:false,revocationError:undefined});else this.storage.data.accounts.push(account);flow.status='connected';flow.accountId=account.id;delete flow.verifier;await this.storage.save();return publicAccount(account);
  }catch(e){flow.status='error';flow.error={code:e.code??'OAUTH_PROVIDER_ERROR',message:e.status?e.message:'OAuth provider could not complete sign-in'};delete flow.verifier;await this.storage.save();throw e;}
 });}
 async rename(owner,id,name){return this.transaction(()=>this.renameInternal(owner,id,name));}
 async renameInternal(owner,id,name){const a=this.account(owner,id);a.name=nameOf(name);a.updatedAt=this.clock();await this.storage.save();return publicAccount(a);}
 async setDefault(owner,id){return this.transaction(()=>this.setDefaultInternal(owner,id));}
 async setDefaultInternal(owner,id){const a=this.account(owner,id);if(a.status!=='connected')throw harnessError('OAUTH_DISCONNECTED','Connect this account first',409);for(const other of this.storage.data.accounts)if(other.owner===owner&&other.resourceUrl===a.resourceUrl)other.isDefault=other.id===id;await this.storage.save();return publicAccount(a);}
 async requireAuthentication(owner,id,{expectedAccessToken}={}){return this.transaction(async()=>{const account=this.account(owner,id);if(account.status==='disconnected'||expectedAccessToken!==undefined&&account.accessToken!==expectedAccessToken)return publicAccount(account);return this.authenticationRequiredInternal(account);});}
 async authenticationRequiredInternal(account){account.status='authenticationRequired';account.updatedAt=this.clock();await this.storage.save();return publicAccount(account);}
 async getCredentialForUse(owner,id,{resourceUrl}={}){return this.transaction(async()=>{
  const a=this.account(owner,id);if(resourceUrl&&oauthUrl(resourceUrl).href!==a.resourceUrl)throw harnessError('OAUTH_RESOURCE_MISMATCH','Account is bound to a different MCP resource',403);if(a.status==='authenticationRequired')throw harnessError('OAUTH_REAUTH_REQUIRED','Sign in again to use this account',401);if(a.status!=='connected')throw harnessError('OAUTH_DISCONNECTED','Account is disconnected',409);
  if(a.expiresAt!==null&&a.expiresAt<=this.clock()+15000){if(!a.refreshToken){await this.authenticationRequiredInternal(a);throw harnessError('OAUTH_REAUTH_REQUIRED','Sign in again to renew this account',401);}try{const token=await oauthJson(this.fetch,a.provider.token_endpoint,tokenRequest({grant_type:'refresh_token',refresh_token:a.refreshToken,client_id:a.clientId,resource:a.resourceUrl},a));Object.assign(a,normalizeTokens(token,this.clock,a,permitsNonexpiring(a)),{updatedAt:this.clock()});await this.storage.save();}catch(error){if(error.providerStatus===400&&error.oauthError==='invalid_grant'){await this.authenticationRequiredInternal(a);throw harnessError('OAUTH_REAUTH_REQUIRED','The saved authorization expired or was revoked; sign in again',401);}throw harnessError('OAUTH_REFRESH_UNAVAILABLE','Account renewal is temporarily unavailable; retry later',503,true);}}
  return {accessToken:a.accessToken,tokenType:'Bearer',resourceUrl:a.resourceUrl,accountId:a.id};
 });}
 async disconnect(owner,id){return this.transaction(()=>this.disconnectInternal(owner,id));}
 async disconnectInternal(owner,id){
  const a=this.account(owner,id);for(const flow of this.storage.data.flows)if(flow.accountId===id&&flow.owner===owner&&flow.status==='pending'){flow.status='cancelled';delete flow.verifier;}if(a.status==='disconnected'){await this.storage.save();return publicAccount(a);}
  const token=a.refreshToken??a.accessToken,tokenType=a.refreshToken?'refresh_token':'access_token';delete a.accessToken;delete a.refreshToken;a.status='disconnected';a.isDefault=false;a.updatedAt=this.clock();a.revokeConfirmed=false;await this.storage.save();
  if(a.provider.revocation_endpoint){try{await oauthJson(this.fetch,a.provider.revocation_endpoint,{...tokenRequest({token,token_type_hint:tokenType,client_id:a.clientId},a),allowEmpty:true});a.revokeConfirmed=true;}catch{a.revocationError='Remote revocation could not be confirmed; the local account is disconnected';}}else a.revocationError='Provider does not advertise remote revocation; the local account is disconnected';
  await this.storage.save();return publicAccount(a);
 }
 async mutate(owner,id,action,payload){return this.transaction(async()=>{
  if(!identifier(payload?.requestId)||!['rename','default','disconnect'].includes(action))throw harnessError('INVALID_ACCOUNT_MUTATION','Valid account mutation and request identifier required');
  const account=this.account(owner,id),key='mutation:'+digest(owner+':'+payload.requestId),hash=digest(JSON.stringify({id,action,...(action==='rename'?{name:payload.name}:{})})),prior=this.storage.data.requests[key];
  if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Account request identifier reused with different input',409);return publicAccount(account);}
  if(action==='rename')nameOf(payload.name);if(action==='default'&&account.status!=='connected')throw harnessError('OAUTH_DISCONNECTED','Connect this account first',409);
  this.storage.data.requests[key]={hash,status:'accepted'};
  const result=action==='rename'?await this.renameInternal(owner,id,payload.name):action==='default'?await this.setDefaultInternal(owner,id):await this.disconnectInternal(owner,id);
  this.storage.data.requests[key].status='completed';await this.storage.save();return result;
 });}
}

import {harnessError,identifier} from './store.mjs';

const flowCookie=id=>'grok_oauth_'+id.replaceAll('-','');
const safeId=value=>{if(!identifier(value))throw harnessError('INVALID_ID','Invalid identifier');return value;};
const cookies=req=>Object.fromEntries((req.headers.cookie??'').split(';').map(part=>part.trim().split('=')));
function callbackPage(res,status){
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
 res.end('<!doctype html><html lang="nl"><meta charset="utf-8"><title>Account verbinden</title><h1>'+(status===200?'Account verbonden':'Authenticatie niet voltooid')+'</h1><p>Je kunt dit venster sluiten en teruggaan naar de replica.</p><a href="/">Terug naar Grok Bot</a></html>');
}
export function createIdentityHandler({accounts,access,proxy,bindConversation,revalidate,invalidateBot,json,body,baseUrl}){
 const accountList=async owner=>[...new Map([...await access.availableAccounts(owner),...accounts.list(owner)].map(a=>[a.id,a])).values()];
 const changed=async()=>{await proxy.abortUnauthorized();await revalidate();};
 const secure=new URL(baseUrl).protocol==='https:'?'; Secure':'';
 async function callback(req,res,url){
  if(req.method!=='GET'||url.pathname!=='/api/harness/oauth/callback')return false;
  let cookieName;
  try{
   for(const name of ['state','code','iss','error'])if(url.searchParams.getAll(name).length>1)throw harnessError('OAUTH_STATE_INVALID','Duplicate OAuth parameter');
   const params=Object.fromEntries(url.searchParams),id=accounts.flowIdForState(params.state);cookieName=flowCookie(id);
   await accounts.callback({...params,browserBinding:cookies(req)[cookieName]});
   res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/harness/oauth/callback; Max-Age=0${secure}`);callbackPage(res,200);
  }catch{callbackPage(res,400);}
  return true;
 }
 async function handle(req,res,{owner,url}){
  const path=url.pathname.slice('/api/harness'.length);
  if(req.method==='GET'){
   if(path==='/accounts/providers'){json(res,200,{providers:accounts.listProviders()});return true;}
   if(path==='/accounts'){json(res,200,{accounts:await accountList(owner),pendingFlows:accounts.pendingFlows(owner)});return true;}
   if(path==='/access'){json(res,200,{...await access.overview(owner),accounts:await accountList(owner)});return true;}
   const flow=path.match(/^\/accounts\/flows\/([^/]+)$/);if(flow){json(res,200,accounts.flow(owner,safeId(flow[1])));return true;}
   return false;
  }
  if(req.method!=='POST'||!/^\/(accounts(?:\/|$)|teams(?:\/|$)|bots(?:\/|$))/.test(path))return false;
  const b=await body(req);safeId(b.requestId);let result,match;
  if(path==='/accounts/oauth/start'||(match=path.match(/^\/accounts\/providers\/([^/]+)\/start$/))){
   const started=match?await accounts.beginProvider(owner,safeId(match[1]),b):await accounts.begin(owner,b),{browserBinding,...publicFlow}=started;
   res.setHeader('Set-Cookie',`${flowCookie(started.flowId)}=${browserBinding}; HttpOnly; SameSite=Lax; Path=/api/harness/oauth/callback; Max-Age=600${secure}`);
   json(res,200,{...publicFlow,status:'pending'});return true;
  }
  if((match=path.match(/^\/accounts\/flows\/([^/]+)\/cancel$/))){json(res,200,await accounts.cancelFlow(owner,safeId(match[1])));return true;}
  if((match=path.match(/^\/accounts\/([^/]+)\/(rename|default|disconnect)$/))){
   const id=safeId(match[1]);accounts.account(owner,id);
   if(match[2]==='disconnect')proxy.abortAccount(id);
   result={account:await accounts.mutate(owner,id,match[2],b)};if(match[2]==='disconnect')await changed();
  }else if(path==='/bots')result={bot:await access.ensureBot(owner,b)};
  else if(path==='/teams')result={team:await access.createTeam(owner,b)};
  else if(path==='/teams/join')result={team:await access.join(owner,b)};
  else if((match=path.match(/^\/teams\/([^/]+)\/invitations$/)))result={invitation:await access.invite(owner,safeId(match[1]),b)};
  else if((match=path.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/))){await access.setMember(owner,safeId(match[1]),safeId(match[2]),b);await changed();result=await access.overview(owner);}
  else if((match=path.match(/^\/teams\/([^/]+)\/accounts$/))){await access.grantAccount(owner,safeId(match[1]),b);await changed();result=await access.overview(owner);}
  else if((match=path.match(/^\/bots\/([^/]+)\/team$/))){result={bot:await access.shareBot(owner,safeId(match[1]),b)};await changed();}
  else if((match=path.match(/^\/bots\/([^/]+)\/accounts$/))){result={bot:await access.bindAccount(owner,safeId(match[1]),b)};await invalidateBot(match[1]);}
  else if((match=path.match(/^\/bots\/([^/]+)\/accounts\/([^/]+)\/unbind$/))){result={bot:await access.unbindAccount(owner,safeId(match[1]),{...b,accountId:safeId(match[2])})};await changed();await invalidateBot(match[1]);}
  else throw harnessError('NOT_FOUND','Account or permission endpoint not found',404);
  json(res,200,result);return true;
 }
 return {handle,callback};
}

import {harnessError} from './store.mjs';
// Caller authenticates Host/Origin/CSRF before dispatch. Tokens remain HttpOnly.
export function createDeviceSessionsHandler({sessions,json,body,setCookie,csrf,onRevoke=()=>{},canReplaceOwner=async()=>false}){
 return async(req,res,{session,url})=>{
  if(!url.pathname.startsWith('/api/harness/devices'))return false;
  const route=url.pathname.slice('/api/harness/devices'.length),token=session.token;
  if(req.method==='GET'&&route===''){
   json(res,200,{...await sessions.list(token),...sessions.publicSession(session)});return true;
  }
  if(req.method==='POST'&&route==='/pairing'){
   await body(req);json(res,201,await sessions.startPairing(token));return true;
  }
  if(req.method==='POST'&&route==='/pairing/accept'){
   const input=await body(req);
   if(!await canReplaceOwner(session.owner))throw harnessError('DEVICE_HAS_HISTORY','This browser already owns conversation history. Use a fresh browser profile to preserve that history.',409);
   const accepted=await sessions.acceptPairing(token,input.code,{label:input.label});
   setCookie(res,accepted.token);await onRevoke(session.deviceId);
   json(res,200,{schema:1,linked:true,device:accepted.device,...sessions.publicSession(accepted),csrfToken:csrf(accepted.owner)});return true;
  }
  const revoke=route.match(/^\/([A-Za-z0-9_-]+)\/revoke$/);
  if(req.method==='POST'&&revoke){
   await body(req);const result=await sessions.revoke(token,revoke[1]);await onRevoke(result.deviceId);
   if(result.current){const fresh=await sessions.resolve(token);setCookie(res,fresh.token);json(res,200,{...result,...sessions.publicSession(fresh),csrfToken:csrf(fresh.owner)});}
   else json(res,200,result);return true;
  }
  throw harnessError('NOT_FOUND','Device endpoint not found',404);
 };
}

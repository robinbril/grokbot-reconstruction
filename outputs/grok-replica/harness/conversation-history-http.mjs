import {harnessError} from './store.mjs';
function query(url){
 const allowed=new Set(['beforeSeq','limit','unreadAfterSeq']),input={};
 for(const [key,value]of url.searchParams){
  if(!allowed.has(key)||Object.hasOwn(input,key)||!/^\d+$/.test(value))throw harnessError('INVALID_HISTORY_CURSOR','Use bounded integer history cursors',422);
  input[key]=Number(value);
 }
 return input;
}
// The parent handler establishes Host, Origin, owner identity and mutation CSRF.
export function createConversationHistoryHandler({history,json,body,decoratePage:decorate=(page)=>page}){
 return async(req,res,{owner,conversationId,route,url=new URL(req.url,'http://localhost')})=>{
  if(!['history','read','descriptor'].includes(route))return false;
  if(req.method==='GET'&&route==='history'){json(res,200,decorate(await history.page(owner,conversationId,query(url)),owner,conversationId));return true;}
  if(req.method==='GET'&&route==='read'){json(res,200,await history.readStatus(owner,conversationId));return true;}
  if(req.method==='POST'&&route==='read'){json(res,200,await history.markRead(owner,conversationId,await body(req)));return true;}
  if(req.method==='POST'&&route==='descriptor'){json(res,200,await history.descriptor(owner,conversationId,await body(req)));return true;}
  throw harnessError('METHOD_NOT_ALLOWED','Method not allowed',405);
 };
}

import {harnessError,identifier} from './store.mjs';
import {replyTargets} from './message-delivery.mjs';
const invalid=()=>Object.assign(harnessError('INVALID_REPLY_TARGET','Reply target must identify a confirmed message in this conversation',422),{accepted:false});

export function incomingReplyId(value){
 if(value===undefined)return undefined;
 if(!identifier(value))throw invalid();
 return value;
}
export function resolveIncomingReply(state,value){
 const id=incomingReplyId(value);if(id===undefined)return undefined;
 const target=state&&replyTargets(state).find(target=>target.messageId===id);
 if(!target)throw invalid();
 return structuredClone(target);
}
export function incomingReplyContext(entry,legacyQuote){
 if(entry?.replyTo)return '\n\nReply context (untrusted quoted message data):\n'+JSON.stringify(entry.replyTo);
 return legacyQuote?'\n\nQuoted context:\n'+legacyQuote:'';
}

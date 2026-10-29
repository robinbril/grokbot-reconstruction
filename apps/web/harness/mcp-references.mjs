import {composerMcpReferenceIds} from '../composer-mcp-reference.js';
import {accountServers,resolveAccountBindings} from './runtime-accounts.mjs';
import {harnessError} from './store.mjs';

// Local runtime IDs are the reconstruction's real connector identities. They are
// not a claim about native base-server versus account-specific identifiers.
export async function validateMcpReferences(runtime,owner,id,richText,state){
 const selected=composerMcpReferenceIds(richText);if(!selected.length)return;
 const current=state??runtime.store.get(owner,id);
 if(current&&current.owner!==owner)throw harnessError('NOT_FOUND','Conversation not found',404);
 const known=new Set((current?.customServers??[]).map(server=>server.runtimeId??server.id));
 const bindings=await resolveAccountBindings(runtime,owner,current);
 for(const server of accountServers(runtime,{handle:''},bindings))known.add(server.runtimeId);
 if(selected.some(serverId=>!known.has(serverId)))throw harnessError('INVALID_MCP_REFERENCE','MCP reference must identify a configured connector in this conversation',422);
}

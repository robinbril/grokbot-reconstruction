// Presentation namespace only. Server existence/ownership is a backend decision.
export function mcpReferenceServerId(id){
 if(typeof id!=='string'||!id.startsWith('mcp:'))return null;
 const serverId=id.slice(4);
 return /^[A-Za-z0-9][A-Za-z0-9_-]{0,251}$/.test(serverId)?serverId:null;
}

// Call after validating the bounded composer document. No executable skill refs.
export function composerMcpReferenceIds(richText){
 if(richText===undefined)return [];
 const document=JSON.parse(richText),ids=new Set();
 const visit=node=>{
  if(node.type==='workflowReference'){
   const id=mcpReferenceServerId(node.attrs?.id);if(id!==null)ids.add(id);
  }
  for(const child of node.content??[])visit(child);
 };
 visit(document);return [...ids];
}

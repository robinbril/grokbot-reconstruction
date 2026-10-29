import {normalizeComposerDocument} from '../composer-document.js';
import {harnessError} from './store.mjs';

// The document is presentation metadata. Skill execution still resolves only
// immutable skillRefs through the owner-scoped registry.
export function normalizeRichText(body) {
 if(body.richText===undefined)return undefined;
 try {
  const legacy=(body.skillReferences??[]).map(value=>JSON.parse(value));
  return normalizeComposerDocument(body.richText,{text:body.text,references:[...(body.skillRefs??[]),...legacy]});
 }catch {
  throw harnessError('INVALID_RICH_TEXT','Rich text must be a bounded composer document matching its text and selected skills',422);
 }
}

// Legacy instructions remain private turn input. Publish only the identities and
// labels that are actually present in the validated presentation document.
export function legacyRichTextReferences(body) {
 const richText=normalizeRichText(body);
 if(richText===undefined||!body.skillReferences?.length)return [];
 const legacyIds=new Set(body.skillReferences.map(value=>JSON.parse(value).id)),seen=new Set(),references=[];
 const visit=node=>{
  if(node.type==='workflowReference'&&legacyIds.has(node.attrs.id)&&!seen.has(node.attrs.id)){
   seen.add(node.attrs.id);references.push({kind:'skill',id:node.attrs.id,label:node.attrs.label});
  }
  for(const child of node.content??[])visit(child);
 };
 visit(JSON.parse(richText));
 return references;
}

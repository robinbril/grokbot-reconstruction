import {normalizeComposerDocument} from './composer-document.js';
// The journal removes a send intent and restores its composer in one metadata commit.
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const files=refs=>refs.map(({id,name,type,size})=>({id,name,type,size})).sort((a,b)=>a.id.localeCompare(b.id));
export function prepareRecoveredSendDraft(current,snapshot,{attachments,failed,busy}){
 const key=snapshot.conversationId,text=current.drafts?.[key]||'',quote=current.replyDrafts?.[key],skills=current.composerSkillReferences?.[key]||[];
 const richText=current.draftRichTexts?.[key];
 normalizeComposerDocument(snapshot.richText,{text:snapshot.text,references:snapshot.skillReferences||[]});
 const empty=!text&&!richText&&!quote&&!skills.length&&!attachments.length;
 const identical=text===snapshot.text&&richText===snapshot.richText&&same(quote,snapshot.quote)&&same(skills,snapshot.skillReferences||[])&&same(files(attachments),files(snapshot.attachments));
 if(busy||failed.length||(!empty&&!identical))throw Error('draft-conflict');
 const replyDrafts={...current.replyDrafts};
 if(snapshot.quote)replyDrafts[key]=structuredClone(snapshot.quote);else delete replyDrafts[key];
 const draftRichTexts={...current.draftRichTexts};
 if(snapshot.richText!==undefined)draftRichTexts[key]=snapshot.richText;else delete draftRichTexts[key];
 const recovered=new Set(snapshot.attachments.map(ref=>ref.id));
 return {...current,drafts:{...current.drafts,[key]:snapshot.text},draftRichTexts,replyDrafts,composerSkillReferences:{...current.composerSkillReferences,[key]:structuredClone(snapshot.skillReferences||[])},attachmentConsumedIds:(current.attachmentConsumedIds||[]).filter(id=>!recovered.has(id))};
}

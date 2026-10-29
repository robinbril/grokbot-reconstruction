// Volatile drafts share the same in-memory shape as durable drafts, so rendering
// and accepted-send matching always read exactly the text visible in the editor.
// The browser-local writer remains the only authority for successful persistence.
export const unsavedComposerWarning='Opslaan is mislukt. Je nieuwste tekst blijft zichtbaar, maar is nog niet opgeslagen. Maak ruimte vrij en probeer opnieuw.';
export function withComposerDraft(current,key,snapshot){
 const draftRichTexts={...current.draftRichTexts};
 if(snapshot.richText===undefined)delete draftRichTexts[key];else draftRichTexts[key]=snapshot.richText;
 return {...current,drafts:{...current.drafts,[key]:snapshot.text},draftRichTexts,composerSkillReferences:{...current.composerSkillReferences,[key]:structuredClone(snapshot.references)}};
}
export function createComposerDraftRetention(){
 const pending=new Set();
 return {retain(current,key,snapshot){const next=withComposerDraft(current,key,snapshot);pending.add(key);return next;},has:key=>pending.has(key),saved(){pending.clear();}};
}

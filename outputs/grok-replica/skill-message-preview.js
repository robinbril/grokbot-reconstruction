import {normalizeComposerDocument} from './composer-document.js';
// Quote the visible selected metadata, never the private instructions themselves.
// The actual prompt text remains unchanged in the canonical user entry.
export function userMessagePreview(entry){
 const text=typeof entry?.text==='string'?entry.text:'';
 if(entry?.richText!==undefined){
  try{normalizeComposerDocument(entry.richText,{text,references:[...(entry.skills||[]),...(entry.legacySkillReferences||[])]});return text;}catch{/* Old invalid metadata keeps the plain preview contract. */}
 }
 const skills=(Array.isArray(entry?.skills)?entry.skills:[]).slice(0,20).filter(skill=>
  skill&&typeof skill.id==='string'&&skill.id.length>0&&skill.id.length<=128&&
  typeof skill.name==='string'&&skill.name.trim()&&skill.name.length<=100&&!/[\r\n\0]/.test(skill.name)&&
  Number.isSafeInteger(skill.revision)&&skill.revision>0
 ).map(skill=>`@${skill.name} · Versie ${skill.revision}`);
 return skills.length?[text,...skills].filter(part=>part.trim()).join('\n'):text;
}

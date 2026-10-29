import {createSkillsController,mergeHarnessSkills} from './live-skills-controller.js';
import {skillsMarkup} from './live-skills-view.js';
import {createSkillImportController} from './live-skill-import.js';
export function createLiveSkillsSurface({host,client,isLive}){
 let dialog=null,cacheError='',disposed=false,saveGeneration=0;
 const drafts=new Map();
 function registry(skills){
  const next=mergeHarnessSkills(host.getState().privateSkills,skills);
  try{const saved=host.commit(current=>({...current,privateSkills:mergeHarnessSkills(current.privateSkills,skills)}),{reason:'harness-skills-cache'});cacheError=saved?.ok?'':'De harness heeft de skills bewaard. De browsercache kon niet worden opgeslagen.';}
  catch{cacheError='De harness heeft de skills bewaard. De browsercache kon niet worden opgeslagen.';}
  if(cacheError)host.getState().privateSkills=next;
 }
 const importer=createSkillImportController({client,onImported:skills=>controller.acceptImported(skills),onChange:paint});
 const controller=createSkillsController({client,onRegistry:registry,onChange:paint,initialSkills:(host.getState().privateSkills||[]).filter(skill=>skill.storage==='harness')});
 function capture(){if(!dialog?.draftKey)return;const draft=drafts.get(dialog.draftKey);if(!draft)return;for(const input of host.overlay.querySelectorAll('[data-skill-field]'))draft[input.dataset.skillField]=input.value;}
 function markup(){return skillsMarkup({esc:host.esc,...controller.state(),busy:locked(),importState:importer.state(),draft:dialog?.draftKey?drafts.get(dialog.draftKey):null,cacheError});}
 function locked(){return controller.state().busy||importer.state().busy||importer.state().reading;}
 function current(){return !disposed&&isLive()&&dialog&&host.overlay.open&&dialog.version===host.getDialogVersion();}
 function paint(){
  if(!current())return;capture();const root=host.overlay.querySelector('[data-live-skills-root]');if(!root)return;
  const fileInputs=new Map(['[data-skill-import-files]','[data-skill-import-folder]'].map(selector=>[selector,host.overlay.querySelector(selector)]));
  const focused=root.contains(document.activeElement)?document.activeElement?.dataset.skillField:null,start=document.activeElement?.selectionStart,end=document.activeElement?.selectionEnd;
  const content=markup();if(content===dialog.signature)return;root.outerHTML=content;dialog.signature=content;
  // Native file choosers must keep their original target during same-dialog sync.
  for(const [selector,input]of fileInputs){const replacement=host.overlay.querySelector(selector);if(input&&replacement){input.disabled=replacement.disabled;replacement.replaceWith(input);}}
  if(focused){const input=host.overlay.querySelector(`[data-skill-field="${focused}"]`);input?.focus({preventScroll:true});input?.setSelectionRange?.(start,end);}
 }
 function open(draftKey=null){
  capture();const content=skillsMarkup({esc:host.esc,...controller.state(),busy:locked(),importState:importer.state(),draft:draftKey?drafts.get(draftKey):null,cacheError});
  host.closePopover();host.showDialog('marketplace','Privéskills',content);dialog={draftKey,version:host.getDialogVersion(),signature:content};return true;
 }
 function newSkill(){if(!drafts.has('new'))drafts.set('new',{name:'',description:'',content:''});return open('new');}
 function edit(id){const skill=controller.skill(id);if(!skill)return true;if(!drafts.has(id))drafts.set(id,{id,name:skill.name,description:skill.description,content:skill.content,expectedRevision:skill.revision});return open(id);}
 async function save(){
  if(locked())return true;
  capture();const draftKey=dialog?.draftKey,draft=drafts.get(draftKey);if(!draft)return true;
  const generation=saveGeneration,version=dialog.version,receipt=await controller.save(draft.id,draft);
  if(receipt&&generation===saveGeneration&&current()&&dialog.version===version){drafts.delete(draftKey);open();void controller.refresh();}return true;
 }
 function handleAction({action,id}){
  if(!isLive())return false;
  if(action.startsWith('live-skill-import-'))return importAction(action);
  if(locked()&&['skill-new','live-skill-new','live-skill-edit','live-skill-save','live-skill-reload'].includes(action))return true;
  if(action==='skill-new'||action==='live-skill-new')return newSkill();
  if(action==='live-skills-open'){open();void controller.refresh();return true;}
  if(action==='live-skill-edit')return edit(id);
  if(action==='live-skill-save')return save();
  if(action==='live-skills-refresh')return controller.refresh().then(()=>true);
  if(action==='live-skill-reload'){
   const selected=dialog?.draftKey;return controller.refresh().then(()=>{if(current()&&dialog.draftKey===selected&&controller.skill(selected)){drafts.delete(selected);edit(selected);}return true;});
  }
  return false;
 }
 function importAction(action){
  if(!current()||controller.state().busy)return true;
  if(action==='live-skill-import-confirm')return importer.submit();
  if(action==='live-skill-import-discard'){importer.discard();return true;}
  if(locked())return true;
  const selector=action==='live-skill-import-files'?'[data-skill-import-files]':action==='live-skill-import-folder'?'[data-skill-import-folder]':null;
  if(selector)host.overlay.querySelector(selector)?.click();return true;
 }
 function importChange(event){
  const input=event.target;
  if(!current()||!input.matches?.('[data-skill-import-files],[data-skill-import-folder]'))return;
  const entries=Array.from(input.files??[]).map(file=>({path:file.webkitRelativePath||file.name,file}));input.value='';
  if(entries.length&&!locked())void importer.prepare(entries);
 }
 function dragging(event){return current()&&event.target.closest?.('[data-skill-import-drop]')&&Array.from(event.dataTransfer?.types??[]).includes('Files');}
 function dragOver(event){
  if(!dragging(event))return;event.preventDefault();event.stopPropagation();
  event.dataTransfer.dropEffect=locked()?'none':'copy';
  const hint=host.overlay.querySelector('[data-skill-drop-hint]');if(hint)hint.textContent=locked()?'Wacht tot de huidige bewerking klaar is.':'Laat los om de import voor te bereiden.';
 }
 function dragLeave(event){
  if(!current()||event.currentTarget?.contains?.(event.relatedTarget))return;
  const hint=host.overlay.querySelector('[data-skill-drop-hint]');if(hint)hint.textContent='';
 }
 function drop(event){
  if(!dragging(event))return;event.preventDefault();event.stopPropagation();
  if(!locked())void importer.prepareDrop(event.dataTransfer);
 }
 const events=[['change',importChange],['dragenter',dragOver],['dragover',dragOver],['dragleave',dragLeave],['drop',drop]];
 for(const [type,listener]of events)host.overlay.addEventListener?.(type,listener);
 return {handleAction,refresh:controller.refresh,
  renderSlot:name=>name==='installedSkillsControls'&&isLive()?'<button class="outline-button" data-action="live-skills-open">Privéskills beheren</button>':undefined,
  handleInput(event){if(event.target?.dataset.skillField)capture();},
  beforeDialogChange(){capture();dialog=null;saveGeneration++;},afterDialogChange:paint,sync:paint,destroy(){disposed=true;for(const [type,listener]of events)host.overlay.removeEventListener?.(type,listener);importer.destroy();controller.destroy();}};
}

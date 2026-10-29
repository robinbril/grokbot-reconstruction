import {readSkillFiles,planSkillFiles,skillDocument,readDroppedSkillFiles} from './skill-file-import.js';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function preparedItems(planned,existing){
 return planned.map(item=>{
  const matches=existing.filter(skill=>skill.name===item.name);
  if(matches.length>1)throw new Error(`Er zijn meerdere lokale skills met de naam ${item.name}. Maak die namen uniek voordat je deze import opnieuw voorbereidt.`);
  const prior=matches[0],description=skillDocument(item.content).description.trim();
  if(item.name.length>100||description.length>2000||item.content.length>32768||/\u0000/.test(item.content))throw new Error('Deze import past niet binnen de lokale opslaglimieten: naam 100, beschrijving 2000 en instructies 32768 tekens. Er is niets geïmporteerd.');
  return {...(prior?{id:prior.id,expectedRevision:prior.revision}:{}),name:item.name,description,content:item.content};
 });
}
function confirmedSkills(receipt,items){
 if(receipt?.schema!==1||!Array.isArray(receipt.skills)||receipt.skills.length!==items.length)throw new Error('De harness heeft de volledige import niet bevestigd. Probeer dezelfde import opnieuw.');
 const ids=new Set();
 for(let index=0;index<items.length;index++){
  const input=items[index],skill=receipt.skills[index];
  if(!uuid(skill?.id)||ids.has(skill.id)||skill.name!==input.name||skill.description!==input.description||skill.content!==input.content||skill.revision!==(input.expectedRevision??0)+1||(input.id&&skill.id!==input.id))throw new Error('De harness gaf een afwijkende importbevestiging. De voorbereide import blijft behouden.');
  ids.add(skill.id);
 }
 return receipt.skills;
}
// The native file planner is source-backed. Review, all-or-none storage and
// request receipts belong to the independent local registry adapter.
export function createSkillImportController({client,onImported=()=>{},onChange=()=>{}}){
 let reading=false,pending=null,preview=null,error=null,status='',disposed=false,generation=0;
 function publish(){if(!disposed)onChange();}
 async function prepare(entries){
  if(reading||pending||disposed)return false;
  const version=++generation;reading=true;preview=null;error=null;status='';publish();
  try{
   const [files,receipt]=await Promise.all([Promise.resolve(entries).then(readSkillFiles),client.skills()]);
   if(disposed||version!==generation)return false;
   if(receipt?.schema!==1||!Array.isArray(receipt.skills))throw new Error('De skilllijst is niet leesbaar. Bereid de import opnieuw voor.');
   const planned=planSkillFiles(files.text,receipt.skills,{maxSkills:new Set(receipt.skills.map(skill=>skill.name)).size+250});
   const items=preparedItems(planned.skills,receipt.skills);
   preview={payload:{requestId:crypto.randomUUID(),skills:items},skipped:[...files.skipped,...planned.skipped]};return true;
  }catch(cause){if(!disposed&&version===generation)error=cause;return false;}
  finally{if(!disposed&&version===generation){reading=false;publish();}}
 }
 function submit(){
  if(pending)return pending;
  if(disposed||reading||!preview?.payload.skills.length)return Promise.resolve(false);
  const batch=preview.payload;error=null;status='';
  pending=Promise.resolve().then(()=>client.importSkills(structuredClone(batch))).then(receipt=>{
   const skills=confirmedSkills(receipt,batch.skills);if(disposed)return false;
   onImported(skills);status=`${skills.length} skill${skills.length===1?'':'s'} geïmporteerd.`;preview=null;return true;
  }).catch(cause=>{if(!disposed)error=cause;return false;}).finally(()=>{pending=null;publish();});
  publish();return pending;
 }
 return {prepare,prepareDrop:transfer=>prepare(readDroppedSkillFiles(transfer)),submit,state:()=>({reading,busy:Boolean(pending),preview:preview?structuredClone(preview):null,error,status}),
  discard(){if(pending||reading)return false;generation++;preview=null;error=null;status='';publish();return true;},
  destroy(){disposed=true;generation++;}};
}

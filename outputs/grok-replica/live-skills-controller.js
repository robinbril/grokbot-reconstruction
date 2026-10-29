// The backend receipt owns a skill version. Browser state is only a display cache.
export const mergeHarnessSkills=(current,skills)=>[...(current||[]).filter(skill=>skill.storage!=='harness'),...skills.map(skill=>({...skill,storage:'harness'}))];
export function createSkillsController({client,onChange=()=>{},onRegistry=()=>{},initialSkills=[]}){
 let skills=structuredClone(initialSkills),loading=false,pending=null,error=null,disposed=false,generation=0;
 const intents=new Map();
 function publish(){onRegistry(skills);onChange();}
 async function refresh(){
  const version=++generation;loading=true;onChange();
  try{const receipt=await client.skills();if(disposed||version!==generation)return;if(receipt.schema!==1||!Array.isArray(receipt.skills))throw new Error('De skilllijst is niet leesbaar.');skills=receipt.skills;error=null;publish();}
  catch(cause){if(!disposed&&version===generation)error=cause;}
  finally{if(!disposed&&version===generation){loading=false;onChange();}}
 }
 function save(id,{name,description,content,expectedRevision}){
  if(pending)return pending;
  const payload={name,description,content,...(id?{expectedRevision}:{})};
  if(!name?.trim()||name.length>100||typeof description!=='string'||description.length>2000||!content?.trim()||content.length>32768){error=new Error('Vul een naam en instructies in. Maximaal 100 tekens voor de naam, 2000 voor de beschrijving en 32768 voor instructies.');onChange();return Promise.resolve();}
  const signature=JSON.stringify([id,payload]),requestId=intents.get(signature)||crypto.randomUUID();intents.set(signature,requestId);generation++;loading=false;error=null;
  pending=Promise.resolve().then(()=>id?client.updateSkill(id,{...payload,requestId}):client.createSkill({...payload,requestId})).then(receipt=>{
   if(disposed)return;if(receipt?.schema!==1||!receipt.skill?.id||!Number.isSafeInteger(receipt.skill.revision)||receipt.skill.revision<1)throw new Error('Opslag is niet bevestigd door de harness.');
   generation++;loading=false;skills=[...skills.filter(skill=>skill.id!==receipt.skill.id),receipt.skill];intents.delete(signature);publish();return receipt.skill;
  }).catch(cause=>{if(!disposed)error=cause;}).finally(()=>{pending=null;if(!disposed)onChange();});onChange();return pending;
 }
 function acceptImported(imported){
  if(disposed)return;
  generation++;loading=false;error=null;
  const byId=new Map(skills.map(skill=>[skill.id,skill]));
  for(const skill of imported){const prior=byId.get(skill.id);if(!prior||prior.revision<=skill.revision)byId.set(skill.id,skill);}
  skills=[...byId.values()];publish();
 }
 return {refresh,save,acceptImported,state:()=>({skills,loading,busy:Boolean(pending),error}),skill:id=>skills.find(skill=>skill.id===id),destroy(){disposed=true;generation++;}};
}

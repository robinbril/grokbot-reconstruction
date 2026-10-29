import {randomUUID} from 'node:crypto';
import {harnessError,identifier} from './store.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
// Local atomic adapter. Native imports target Bot skills through sequential addSkills.
export function canonicalSkillImport(input,canonical){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['requestId','skills'].includes(key))||!identifier(input.requestId)||!Array.isArray(input.skills)||input.skills.length<1||input.skills.length>250)throw harnessError('INVALID_SKILL_IMPORT','Import 1–250 skills with a bounded requestId',422);
 const values=input.skills.map(skill=>{
  if(!skill||typeof skill!=='object'||Array.isArray(skill)||Object.keys(skill).some(key=>!['id','expectedRevision','name','description','content'].includes(key)))throw harnessError('INVALID_SKILL','Use exact bounded skill fields',422);
  const updating=Object.hasOwn(skill,'id');
  if((updating&&!uuid(skill.id))||(!updating&&Object.hasOwn(skill,'expectedRevision')))throw harnessError('INVALID_SKILL','Updates require an owned skill ID and positive expectedRevision',422);
  const {id,...fields}=skill;
  return {id:updating?id:null,value:canonical({requestId:input.requestId,...fields},updating)};
 });
 const ids=values.map(value=>value.id).filter(id=>id!==null);
 if(new Set(ids).size!==ids.length)throw harnessError('INVALID_SKILL_IMPORT','Each existing skill can appear only once per import',422);
 return values;
}
export function importedSkills(actor,values,limits){
 const at=new Date().toISOString();
 const skills=values.map(({id,value})=>{
  const revisions=id?actor.skills[id]:null;
  if(id&&!revisions)throw harnessError('SKILL_NOT_FOUND','Skill unavailable',404);
  const latest=revisions?.at(-1);
  if(latest&&latest.revision!==value.expectedRevision)throw harnessError('SKILL_REVISION_CONFLICT','Skill was edited; reload its current revision',409);
  return {id:id??randomUUID(),name:value.name,description:value.description,content:value.content,revision:(latest?.revision??0)+1,createdAt:latest?.createdAt??at,updatedAt:at};
 });
 const all=Object.values(actor.skills).flat(),bytes=[...all,...skills].reduce((sum,skill)=>sum+Buffer.byteLength(JSON.stringify(skill)),0);
 if(all.length+skills.length>limits.revisions||bytes>limits.bytes||Object.keys(actor.requests).length>=limits.receipts)throw harnessError('SKILL_CAPACITY','Private skill history capacity reached; no revisions were removed',429);
 return skills;
}

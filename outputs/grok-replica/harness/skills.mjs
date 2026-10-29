import {mkdir,readFile,open,rename,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {harnessError,identifier} from './store.mjs';
import {canonicalSkillImport,importedSkills} from './skill-import.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const SELECTED_SKILL_CONTEXT_BYTES=256*1024;
export const selectedSkillContext=selected=>'\n\nExplicitly selected private skills (user instructions):\n'+JSON.stringify(selected.map(({id,revision,name,description,content})=>({id,revision,name,description,content})));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export function normalizeSkillRefs(refs){
 if(refs===undefined)return undefined;
 if(!Array.isArray(refs)||refs.length>20||refs.some(ref=>!ref||typeof ref!=='object'||Array.isArray(ref)||!uuid(ref.id)||!Number.isSafeInteger(ref.revision)||ref.revision<1||Object.keys(ref).length!==2||Object.keys(ref).some(key=>!['id','revision'].includes(key)))||new Set(refs.map(ref=>ref.id)).size!==refs.length)throw harnessError('INVALID_SKILL_REFS','Use at most 20 unique immutable skill references',422);
 return structuredClone(refs);
}
function ownerKey(owner){if(typeof owner!=='string'||!owner||owner.length>1024)throw harnessError('INVALID_OWNER','Browser identity required',401);return digest(owner);}
function canonical(input,update){
 const fields=['requestId','name','description','content',...(update?['expectedRevision']:[])];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.includes(key))||!identifier(input.requestId))throw harnessError('INVALID_SKILL','Use exact bounded skill fields',422);
 for(const [field,max,required]of [['name',100,true],['description',2000,false],['content',32768,true]])if(typeof input[field]!=='string'||input[field].length>max||(required&&!input[field].trim())||/\u0000/.test(input[field])||(field==='name'&&/[\r\n]/.test(input[field])))throw harnessError('INVALID_SKILL',`${field} is missing or exceeds ${max} characters`,422);
 if(update&&(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1))throw harnessError('INVALID_SKILL','Positive expectedRevision required',422);
 return {name:input.name,description:input.description,content:input.content,...(update?{expectedRevision:input.expectedRevision}:{})};
}
// Independent local registry. Revisions and receipts are retained, never silently pruned.
export class SkillRegistry{
 constructor({dataDir,limits={}}){this.dir=path.join(dataDir,'skills');this.file=path.join(this.dir,'registry.json');this.limits={revisions:1000,bytes:8*1024*1024,receipts:2000,...limits};this.tail=Promise.resolve();}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700});await chmod(this.dir,0o700);try{this.data=JSON.parse(await readFile(this.file,'utf8'));await chmod(this.file,0o600);}catch(error){if(error.code!=='ENOENT')throw error;this.data={schema:1,owners:{}};}if(this.data.schema!==1||!this.data.owners||typeof this.data.owners!=='object')throw Error('Unsupported skills registry schema');return this;}
 assertReadable(){if(this.pendingDirectorySync)throw harnessError('SKILLS_PERSISTENCE_UNCERTAIN','Private skills await confirmed persistence; retry the original save',503,true);}
 list(owner){this.assertReadable();const data=this.data.owners[ownerKey(owner)];return {schema:1,skills:structuredClone(Object.values(data?.skills??{}).map(revisions=>revisions.at(-1)))};}
 resolve(owner,refs){this.assertReadable();const selected=normalizeSkillRefs(refs)??[],data=this.data.owners[ownerKey(owner)];const resolved=selected.map(ref=>{const revision=data?.skills[ref.id]?.find(skill=>skill.revision===ref.revision);if(!revision)throw harnessError('SKILL_NOT_FOUND','Selected skill revision is unavailable',422);return structuredClone(revision);});if(Buffer.byteLength(selectedSkillContext(resolved),'utf8')>SELECTED_SKILL_CONTEXT_BYTES)throw harnessError('SKILL_CONTEXT_TOO_LARGE','Selected private skill context exceeds the local 256 KiB UTF-8 limit',413);return resolved;}
 async ensureDirectorySync(){
  if(!this.pendingDirectorySync)return;
  const dir=await open(this.dir,'r');
  try{await dir.sync();this.pendingDirectorySync=false;}finally{await dir.close();}
 }
 async save(data){
  const temp=this.file+'.'+randomUUID()+'.tmp';
  try{
   const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(data));await file.sync();}finally{await file.close();}
   await rename(temp,this.file);
   // Rename publishes the new registry. Preserve its receipts in memory even when
   // later directory sync or cleanup fails and the caller receives an uncertain ACK.
   this.data=data;this.pendingDirectorySync=true;
   await this.ensureDirectorySync();
  }finally{await rm(temp,{force:true});}
 }
 create(owner,input){return this.change(owner,null,input);}
 update(owner,id,input){return this.change(owner,id,input);}
 async import(owner,input){
  const key=ownerKey(owner),values=canonicalSkillImport(input,canonical),requestKey=digest(input.requestId);
  const task=this.tail.then(async()=>{
   await this.ensureDirectorySync();
   const data=structuredClone(this.data),actor=data.owners[key]??={skills:{},requests:{}},hash=digest(JSON.stringify({kind:'skill-import',values})),prior=actor.requests[requestKey];
   if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Skill request identifier differs',409);return structuredClone(prior.response);}
   const imported=importedSkills(actor,values,this.limits);
   for(const skill of imported)(actor.skills[skill.id]??=[]).push(skill);
   const response={schema:1,skills:imported};actor.requests[requestKey]={hash,response};await this.save(data);return structuredClone(response);
  });this.tail=task.catch(()=>{});return task;
 }
 async change(owner,id,input){
  const key=ownerKey(owner),value=canonical(input,id!==null);if(id!==null&&!uuid(id))return Promise.reject(harnessError('INVALID_SKILL','Invalid skill ID',422));
  const task=this.tail.then(async()=>{
   await this.ensureDirectorySync();
   const data=structuredClone(this.data),actor=data.owners[key]??={skills:{},requests:{}},requestKey=digest(input.requestId),hash=digest(JSON.stringify({id,value})),prior=actor.requests[requestKey];
   if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Skill request identifier differs',409);return structuredClone(prior.response);}
   const revisions=id?actor.skills[id]:null;if(id&&!revisions)throw harnessError('SKILL_NOT_FOUND','Skill unavailable',404);
   const latest=revisions?.at(-1);if(latest&&latest.revision!==value.expectedRevision)throw harnessError('SKILL_REVISION_CONFLICT','Skill was edited; reload its current revision',409);
   const all=Object.values(actor.skills).flat(),bytes=all.reduce((sum,skill)=>sum+Buffer.byteLength(JSON.stringify(skill)),0),at=new Date().toISOString();
   const skill={id:id??randomUUID(),name:value.name,description:value.description,content:value.content,revision:(latest?.revision??0)+1,createdAt:latest?.createdAt??at,updatedAt:at};
   if(all.length>=this.limits.revisions||bytes+Buffer.byteLength(JSON.stringify(skill))>this.limits.bytes||Object.keys(actor.requests).length>=this.limits.receipts)throw harnessError('SKILL_CAPACITY','Private skill history capacity reached; no revisions were removed',429);
   (actor.skills[skill.id]??=[]).push(skill);const response={schema:1,skill};actor.requests[requestKey]={hash,response};await this.save(data);return structuredClone(response);
  });this.tail=task.catch(()=>{});return task;
 }
}

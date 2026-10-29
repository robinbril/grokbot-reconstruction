import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
for(const fault of ['directory-sync','cleanup','persistent-directory-sync'])test(`post-rename ${fault} failure retains state and requires confirmed durability before ACK`,async()=>{
 const skillsUrl=new URL('../harness/skills.mjs',import.meta.url).href;
 const shim=String.raw`import * as fs from 'node:fs/promises';
 export const {mkdir,readFile,rename,chmod}=fs;
 let armed=true;
 export async function open(file,flags,...rest){
  const handle=await fs.open(file,flags,...rest);
  if(flags==='r'){
   const sync=handle.sync.bind(handle);
   handle.sync=async()=>{
    globalThis.skillSyncAttempts=(globalThis.skillSyncAttempts??0)+1;
    if(globalThis.skillSyncFault==='persistent-directory-sync'||(armed&&globalThis.skillSyncFault==='directory-sync')){armed=false;throw Object.assign(new Error('injected directory sync failure'),{code:'EIO'});}
    return sync();
   };
  }
  return handle;
 }
 export async function rm(file,options){if(armed&&globalThis.skillSyncFault==='cleanup'){armed=false;throw Object.assign(new Error('injected cleanup failure'),{code:'EIO'});}return fs.rm(file,options);}`;
 const script=`
 import {registerHooks} from 'node:module';
 import {mkdtemp,readFile} from 'node:fs/promises';
 import {tmpdir} from 'node:os';
 import path from 'node:path';
 import assert from 'node:assert/strict';
 const skillsUrl=${JSON.stringify(skillsUrl)},fault=${JSON.stringify(fault)},shim=${JSON.stringify(shim)};
 globalThis.skillSyncFault=fault;
 registerHooks({resolve(specifier,context,next){if(specifier==='node:fs/promises'&&context.parentURL===skillsUrl)return {url:'data:text/javascript,'+encodeURIComponent(shim),shortCircuit:true};return next(specifier,context);}});
 const {SkillRegistry}=await import(skillsUrl),dataDir=await mkdtemp(path.join(tmpdir(),'skills-fault-')),skills=await new SkillRegistry({dataDir}).init();
 const input={requestId:'first',name:'First',description:'',content:'Retained body'};
 await assert.rejects(skills.create('owner',input),{code:'EIO'});
 const disk=JSON.parse(await readFile(path.join(dataDir,'skills','registry.json'),'utf8'));
 assert.equal(Object.values(disk.owners)[0].skills[Object.keys(Object.values(disk.owners)[0].skills)[0]][0].name,'First');
 const uncertain={code:'SKILLS_PERSISTENCE_UNCERTAIN',status:503,retryable:true};
 const firstSkill=Object.values(Object.values(disk.owners)[0].skills)[0][0],ref={id:firstSkill.id,revision:1};
 if(fault!=='cleanup'){
  assert.throws(()=>skills.list('owner'),uncertain,'unconfirmed revisions are not listed');
  assert.throws(()=>skills.resolve('owner',[ref]),uncertain,'unconfirmed revisions are not selectable');
  const {HarnessStore}=await import(new URL('./store.mjs',skillsUrl).href),{GrokRuntime}=await import(new URL('./grok-runtime.mjs',skillsUrl).href),{WorkflowEngine}=await import(new URL('./workflows.mjs',skillsUrl).href);
  const store=await new HarnessStore({dataDir}).init(),runtime=new GrokRuntime({store,skills,model:{status:()=>({state:'ready'}),complete:()=>assert.fail('model must not execute')}}),engine=await new WorkflowEngine({store,runtime,autoStart:false}).init();engine.wake=()=>{};
  try{
   const body={requestId:'uncertain',text:'',skillRefs:[ref]};
   await assert.rejects(runtime.start('owner','uncertain',body),uncertain);
   await assert.rejects(engine.enqueue('owner','uncertain',body),uncertain);
   await assert.rejects(engine.createSchedule('owner','uncertain',{requestId:'schedule',title:'Unconfirmed',enabled:false,rule:{kind:'once',at:'2099-01-01T00:00:00.000Z',timeZone:'UTC'},payload:body}),uncertain);
   assert.equal(store.states.size,0,'uncertain skills cannot create entries, queue rows or schedules');assert.equal(runtime.connections.size,0);
  }finally{await engine.close();await runtime.close();}
 }else assert.equal(skills.list('owner').skills.length,1);
 
 if(fault==='persistent-directory-sync'){
  await assert.rejects(skills.create('owner',input),{code:'EIO'},'receipt replay cannot ACK a still-unconfirmed directory sync');
  await assert.rejects(skills.create('owner',{...input,requestId:'blocked',name:'Blocked'}),{code:'EIO'});
  assert.throws(()=>skills.list('owner'),uncertain,'durability failure keeps reads closed');
  globalThis.skillSyncFault=null;
 }
 const attempts=globalThis.skillSyncAttempts;
 const original=await skills.create('owner',input);assert.equal(original.skill.name,'First');
 assert.equal(globalThis.skillSyncAttempts,attempts+(fault==='cleanup'?0:1),'only an unconfirmed barrier requires another sync');
 await skills.create('owner',{...input,requestId:'second',name:'Second'});
 const reopened=await new SkillRegistry({dataDir}).init();assert.equal(reopened.list('owner').skills.length,2);assert.deepEqual(await reopened.create('owner',input),original);
 process.stdout.write('retained both committed skills and original receipt after confirmed durability');
 `;
 const result=await run(process.execPath,['--input-type=module','--eval',script]);assert.match(result.stdout,/retained both committed skills/);
});

import {mkdir,readFile,open,rename,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {harnessError,identifier} from '../store.mjs';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const deny=()=>{throw harnessError('ACCESS_DENIED','You do not have permission for this action',403);};
export function text(value,label='Name'){
 if(typeof value!=='string'||!value.trim()||value.length>100||/[\x00-\x1f]/.test(value))throw harnessError('INVALID_ACCESS_INPUT',`${label} must contain 1–100 printable characters`);
 return value.trim();
}
export class AccessStorage {
 constructor(dataDir){this.dir=path.join(dataDir,'access');this.file=path.join(this.dir,'access.json');this.tail=Promise.resolve();this.inviteReceipts=new Map();}
 async init(){
  await mkdir(this.dir,{recursive:true,mode:0o700});await chmod(this.dir,0o700);
  try{this.data=JSON.parse(await readFile(this.file,'utf8'));await chmod(this.file,0o600);}catch(error){if(error.code!=='ENOENT')throw error;this.data={schema:1,principals:[],teams:[],bots:[],invites:[],grants:[],requests:{}};}
  if(this.data.schema!==1)throw Error('Unsupported access store schema');return this;
 }
 async save(data){
  const tmp=this.file+'.'+randomUUID()+'.tmp';
  try{const handle=await open(tmp,'wx',0o600);try{await handle.writeFile(JSON.stringify(data));await handle.sync();}finally{await handle.close();}await rename(tmp,this.file);const dir=await open(this.dir,'r');try{await dir.sync();}finally{await dir.close();}}finally{await rm(tmp,{force:true});}
 }
 transaction(operation){const result=this.tail.then(async()=>{const data=structuredClone(this.data),value=await operation(data);await this.save(data);this.data=data;return structuredClone(value);});this.tail=result.catch(()=>{});return result;}
 principal(data,owner){
  if(typeof owner!=='string'||!owner||owner.length>1024)throw harnessError('INVALID_OWNER','A browser identity is required',401);
  const ownerHash=digest(owner);let p=data.principals.find(p=>p.ownerHash===ownerHash);
  if(!p){p={id:randomUUID(),ownerHash,name:'Dit browserprofiel'};data.principals.push(p);}return p;
 }
 change(owner,kind,input,operation){
  if(!input||!identifier(input.requestId))return Promise.reject(harnessError('INVALID_REQUEST_ID','A valid requestId is required'));
  return this.transaction(async data=>{
   const actor=this.principal(data,owner),key=digest(actor.id+':'+input.requestId),hash=digest(JSON.stringify({kind,input})),prior=data.requests[key];
   if(prior){if(prior.hash!==hash)throw harnessError('IDEMPOTENCY_CONFLICT','Request identifier was already used for a different action',409);if(prior.invite){const receipt=this.inviteReceipts.get(key);if(!receipt)throw harnessError('INVITE_ALREADY_ISSUED','Start a new invitation; its token is only returned in this server session',409);return receipt;}return prior.result;}
   const result=await operation(data,actor);if(kind==='invite'){this.inviteReceipts.set(key,result);data.requests[key]={hash,invite:true};}else data.requests[key]={hash,result};return result;
  });
 }
}

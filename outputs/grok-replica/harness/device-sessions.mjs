import {mkdir,readFile,open,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {harnessError} from './store.mjs';
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const duration=300000;
const digest=value=>createHash('sha256').update(value).digest('hex');
const freshToken=()=>randomBytes(32).toString('base64url');
function deviceLabel(value='Dit apparaat'){
 if(typeof value!=='string'||!value.trim()||value.length>80||/[\u0000-\u001f\u007f]/.test(value))throw harnessError('INVALID_DEVICE','Device name must contain 1–80 printable characters',422);
 return value.trim();
}
const view=(session,current)=>({id:session.deviceId,label:session.label,createdAt:session.createdAt,lastSeenAt:session.lastSeenAt,current:session.deviceId===current});
// Local/shared-server identity adapter. Provider OAuth grants are not app sign-in.
// Only token digests are session lookup keys; bearer values never leave HTTP cookies.
export class DeviceSessions{
 constructor({dataDir,now=Date.now}={}){this.dataDir=path.resolve(dataDir);this.file=path.join(this.dataDir,'device-sessions.json');this.now=now;this.tail=Promise.resolve();this.state={schema:1,sessions:[],pairings:[],attempts:[]};}
 async init(){
  await mkdir(this.dataDir,{recursive:true,mode:0o700});
  try{const state=JSON.parse(await readFile(this.file,'utf8'));if(state.schema!==1||!['sessions','pairings','attempts'].every(key=>Array.isArray(state[key])))throw Error('Invalid device session registry');this.state=state;}
  catch(error){if(error.code!=='ENOENT')throw error;}return this;
 }
 async write(state){
  const temp=this.file+'.'+randomUUID()+'.tmp';
  try{
   const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(state));await file.sync();}finally{await file.close();}
   await rename(temp,this.file);this.state=state;
   const directory=await open(this.dataDir,'r');try{await directory.sync();}finally{await directory.close();}
  }finally{await rm(temp,{force:true});}
 }
 transaction(mutate){
  const task=this.tail.then(async()=>{
   const next=structuredClone(this.state),result=mutate(next);
   if(result.save!==false)await this.write(next);
   if(result.error)throw result.error;return result.value;
  });this.tail=task.catch(()=>{});return task;
 }
 session(state,token){
  const session=typeof token==='string'&&tokenPattern.test(token)?state.sessions.find(row=>row.tokenHash===digest(token)):null;
  if(!session||session.revokedAt!==null)throw harnessError('DEVICE_UNAUTHORIZED','Device session is unavailable',401);
  return session;
 }
 add(state,token,owner,label='Dit apparaat'){
  const timestamp=this.now(),session={tokenHash:digest(token),owner,deviceId:randomUUID(),label,createdAt:timestamp,lastSeenAt:timestamp,revokedAt:null};state.sessions.push(session);return session;
 }
 resolve(rawToken){
  return this.transaction(state=>{
   const known=typeof rawToken==='string'&&tokenPattern.test(rawToken)?state.sessions.find(row=>row.tokenHash===digest(rawToken)):null;
   if(known&&known.revokedAt===null){
    const refresh=this.now()-known.lastSeenAt>=60000;if(refresh)known.lastSeenAt=this.now();
    return {save:refresh,value:{owner:known.owner,deviceId:known.deviceId,token:rawToken,changed:false}};
   }
   // A known revoked digest is retained forever and never accepted as a legacy owner.
   const legacy=!known&&typeof rawToken==='string'&&tokenPattern.test(rawToken),token=legacy?rawToken:freshToken();
   const session=this.add(state,token,token);return {value:{owner:session.owner,deviceId:session.deviceId,token,changed:!legacy}};
  });
 }
 claimOwner(token){return this.transaction(state=>{const current=this.session(state,token);current.hasResources=true;return {value:{reserved:true}};});}
 publicSession(session){return {principalScope:digest(session.owner),deviceId:session.deviceId};}
 startPairing(token){
  return this.transaction(state=>{
   const current=this.session(state,token),timestamp=this.now();state.pairings=state.pairings.filter(row=>row.expiresAt>timestamp);
   if(state.pairings.filter(row=>row.owner===current.owner).length>=5)throw harnessError('PAIRING_RATE_LIMITED','Too many active pairing requests; wait until they expire',429,true);
   const code=freshToken(),expiresAt=timestamp+duration;
   state.pairings.push({codeHash:digest(code),owner:current.owner,sourceDeviceId:current.deviceId,expiresAt});
   return {value:{schema:1,code,expiresAt}};
  });
 }
 async acceptPairing(token,code,{label='Dit apparaat'}={}){
  const name=deviceLabel(label);
  return this.transaction(state=>{
   const current=this.session(state,token),timestamp=this.now();
   if(state.sessions.some(row=>row.owner===current.owner&&row.hasResources))throw harnessError('DEVICE_HAS_HISTORY','This device identity already owns server data. Use a fresh browser profile to pair.',409);
   state.attempts=state.attempts.filter(row=>timestamp-row.startedAt<duration);
   let attempts=state.attempts.find(row=>row.deviceId===current.deviceId);
   if(!attempts){attempts={deviceId:current.deviceId,startedAt:timestamp,count:0};state.attempts.push(attempts);}
   if(attempts.count>=8)return {error:harnessError('PAIRING_RATE_LIMITED','Too many pairing attempts; try again later',429,true)};
   attempts.count++;
   const pairing=typeof code==='string'&&tokenPattern.test(code)?state.pairings.find(row=>row.codeHash===digest(code)&&row.expiresAt>timestamp):null;
   if(!pairing)return {error:harnessError('PAIRING_INVALID','Pairing code is invalid or expired',422)};
   const source=state.sessions.find(row=>row.deviceId===pairing.sourceDeviceId);
   if(!source||source.revokedAt!==null)return {error:harnessError('PAIRING_INVALID','Pairing code is invalid or expired',422)};
   if(source.deviceId===current.deviceId)return {error:harnessError('PAIRING_SAME_DEVICE','Enter this code on the other device',409)};
   const nextToken=freshToken(),session=this.add(state,nextToken,pairing.owner,name);
   state.pairings=state.pairings.filter(row=>row!==pairing);current.revokedAt=timestamp;
   return {value:{schema:1,linked:true,owner:session.owner,deviceId:session.deviceId,token:nextToken,device:view(session,session.deviceId)}};
  });
 }
 list(token){
  return this.transaction(state=>{const current=this.session(state,token);return {save:false,value:{schema:1,devices:state.sessions.filter(row=>row.owner===current.owner&&row.revokedAt===null).map(row=>view(row,current.deviceId))}};});
 }
 revoke(token,deviceId){
  return this.transaction(state=>{
   const current=this.session(state,token),target=state.sessions.find(row=>row.deviceId===deviceId&&row.owner===current.owner);
   if(!target)throw harnessError('NOT_FOUND','Device not found',404);
   if(target.revokedAt===null)target.revokedAt=this.now();
   state.pairings=state.pairings.filter(row=>row.sourceDeviceId!==target.deviceId);
   return {value:{schema:1,revoked:true,deviceId:target.deviceId,current:target.deviceId===current.deviceId}};
  });
 }
}

import {randomBytes,randomUUID} from 'node:crypto';
import {harnessError,identifier} from '../store.mjs';
import {AccessStorage,digest,deny,text} from './storage.mjs';
const publicPrincipal=p=>({id:p.id,name:p.name});
const publicBot=(b,role,actorId)=>({id:b.id,name:b.name,teamId:b.teamId,role,canShare:b.ownerId===actorId,accountIds:[...b.accountIds]});
function teamFor(data,actor,id){const team=data.teams.find(t=>t.id===id);if(!team||!team.members.some(m=>m.id===actor.id))deny();return team;}
const roleFor=(team,actor)=>team.members.find(m=>m.id===actor.id)?.role;
function manageTeam(data,actor,id){const team=teamFor(data,actor,id);if(!['owner','admin'].includes(roleFor(team,actor)))deny();return team;}
function botFor(data,actor,id){const bot=data.bots.find(b=>b.id===id);if(!bot)deny();if(bot.ownerId!==actor.id&&(!bot.teamId||!data.teams.find(t=>t.id===bot.teamId)?.members.some(m=>m.id===actor.id)))deny();return bot;}
function manageBot(data,actor,id){const bot=botFor(data,actor,id);if(bot.ownerId!==actor.id&&(!bot.teamId||!['owner','admin'].includes(roleFor(teamFor(data,actor,bot.teamId),actor))))deny();return bot;}
export class AccessControl {
 constructor({dataDir,accountLookup=async()=>undefined,clock=Date.now}){this.storage=new AccessStorage(dataDir);this.accountLookup=accountLookup;this.clock=clock;}
 async init(){await this.storage.init();return this;}
 async availableAccounts(owner){
  await this.storage.tail;const data=this.storage.data,actor=data.principals.find(p=>p.ownerHash===digest(owner));if(!actor)return [];
  const ids=[...new Set(data.grants.filter(g=>g.enabled&&data.teams.find(t=>t.id===g.teamId)?.members.some(m=>m.id===actor.id)).map(g=>g.accountId))],result=[];
  for(const id of ids){const a=await this.accountLookup(id);if(a)result.push({id,name:a.name,status:a.status,resourceUrl:a.resourceUrl,shared:true});}return result;
 }
 async overview(owner){
  return this.storage.transaction(async data=>{
   const actor=this.storage.principal(data,owner),teams=data.teams.filter(t=>t.members.some(m=>m.id===actor.id));
   const visibleBots=data.bots.filter(b=>b.ownerId===actor.id||(b.teamId&&teams.some(t=>t.id===b.teamId)));
   const grants=[];for(const g of data.grants.filter(g=>g.enabled&&teams.some(t=>t.id===g.teamId))){const a=await this.accountLookup(g.accountId);if(a)grants.push({teamId:g.teamId,accountId:g.accountId,accountName:a.name,status:a.status});}
   return {principal:publicPrincipal(actor),teams:teams.map(t=>({id:t.id,name:t.name,role:roleFor(t,actor),members:t.members.map(m=>({...publicPrincipal(data.principals.find(p=>p.id===m.id)),role:m.role}))})),bots:visibleBots.map(b=>publicBot(b,b.ownerId===actor.id?'owner':roleFor(teams.find(t=>t.id===b.teamId),actor),actor.id)),grants};
  });
 }
 ensureBot(owner,input){return this.storage.change(owner,'ensureBot',input,(data,actor)=>{
  const clientKey=text(input.clientKey,'Local Bot identifier'),name=text(input.name);let b=data.bots.find(b=>b.ownerId===actor.id&&b.clientKey===clientKey);
  if(!b){b={id:randomUUID(),ownerId:actor.id,clientKey,name,teamId:null,accountIds:[]};data.bots.push(b);}return publicBot(b,'owner',actor.id);
 });}
 createTeam(owner,input){return this.storage.change(owner,'createTeam',input,(data,actor)=>{
  const team={id:randomUUID(),name:text(input.name),members:[{id:actor.id,role:'owner'}]};data.teams.push(team);return {id:team.id,name:team.name,role:'owner',members:[{...publicPrincipal(actor),role:'owner'}]};
 });}
 invite(owner,teamId,input){return this.storage.change(owner,'invite',{...input,teamId},(data,actor)=>{
  const team=manageTeam(data,actor,teamId);if(!['member','admin'].includes(input.role)||(input.role==='admin'&&roleFor(team,actor)!=='owner'))deny();
  const token=randomBytes(32).toString('base64url'),expiresAt=this.clock()+900000;
  data.invites=data.invites.filter(i=>i.expiresAt>this.clock()&&!i.used);data.invites.push({teamId,role:input.role,tokenHash:digest(token),expiresAt,issuedBy:actor.id});
  return {token,expiresAt,teamId,role:input.role};
 });}
 join(owner,input){return this.storage.change(owner,'join',input,(data,actor)=>{
  if(typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))throw harnessError('INVITE_INVALID','Invitation is invalid, expired or already used',403);
  const i=data.invites.find(i=>i.tokenHash===digest(input.token)&&!i.used&&i.expiresAt>this.clock());if(!i)throw harnessError('INVITE_INVALID','Invitation is invalid, expired or already used',403);
  const team=data.teams.find(t=>t.id===i.teamId),issuer=team?.members.find(m=>m.id===i.issuedBy);
  if(!issuer||!['owner','admin'].includes(issuer.role)||(i.role==='admin'&&issuer.role!=='owner'))throw harnessError('INVITE_INVALID','Invitation issuer is no longer authorized',403);
  if(team.members.some(m=>m.id===actor.id))throw harnessError('ALREADY_MEMBER','This browser profile already belongs to the team',409);
  i.used=true;team.members.push({id:actor.id,role:i.role});return {teamId:team.id,role:i.role};
 });}
 setMember(owner,teamId,principalId,input){return this.storage.change(owner,'setMember',{...input,teamId,principalId},(data,actor)=>{
  const team=manageTeam(data,actor,teamId),target=team.members.find(m=>m.id===principalId);if(!target)deny();
  if(target.role==='owner'||!['admin','member',null].includes(input.role))deny();
  if(roleFor(team,actor)==='admin'&&(target.role==='admin'||input.role==='admin'))deny();
  if(input.role===null)team.members=team.members.filter(m=>m.id!==principalId);else target.role=input.role;return {teamId,principalId,role:input.role};
 });}
 async accountFor(owner,id){
  if(!identifier(id))throw harnessError('INVALID_ACCESS_INPUT','A valid account identifier is required');
  const account=await this.accountLookup(id);if(!account)deny();return account;
 }
 hasGrant(data,actor,accountId,teamId=null){return data.grants.some(g=>g.enabled&&g.accountId===accountId&&(!teamId||g.teamId===teamId)&&data.teams.find(t=>t.id===g.teamId)?.members.some(m=>m.id===actor.id));}
 async canUse(data,actor,accountId,teamId=null){
  const account=await this.accountFor(null,accountId);if(account.status!=='connected')throw harnessError('ACCOUNT_UNAVAILABLE','The account is not connected',409);
  if(teamId){if(!this.hasGrant(data,actor,accountId,teamId))deny();}
  else if(digest(account.owner)!==actor.ownerHash&&!this.hasGrant(data,actor,accountId))deny();return account;
 }
 shareBot(owner,botId,input){return this.storage.change(owner,'shareBot',{...input,botId},async(data,actor)=>{
  const b=botFor(data,actor,botId);if(b.ownerId!==actor.id)deny();if(input.teamId!==null){manageTeam(data,actor,input.teamId);for(const id of b.accountIds)await this.canUse(data,actor,id,input.teamId);}
  b.teamId=input.teamId;return publicBot(b,'owner',actor.id);
 });}
 bindAccount(owner,botId,input){return this.storage.change(owner,'bindAccount',{...input,botId},async(data,actor)=>{
  const b=manageBot(data,actor,botId);await this.canUse(data,actor,input.accountId,b.teamId);if(!b.accountIds.includes(input.accountId))b.accountIds.push(input.accountId);return publicBot(b,b.ownerId===actor.id?'owner':roleFor(teamFor(data,actor,b.teamId),actor),actor.id);
 });}
 unbindAccount(owner,botId,input){return this.storage.change(owner,'unbindAccount',{...input,botId},(data,actor)=>{
  const b=manageBot(data,actor,botId);if(!identifier(input.accountId))throw harnessError('INVALID_ACCESS_INPUT','A valid account identifier is required');
  b.accountIds=b.accountIds.filter(id=>id!==input.accountId);return publicBot(b,b.ownerId===actor.id?'owner':roleFor(teamFor(data,actor,b.teamId),actor),actor.id);
 });}
 grantAccount(owner,teamId,input){return this.storage.change(owner,'grantAccount',{...input,teamId},async(data,actor)=>{
  manageTeam(data,actor,teamId);if(typeof input.enabled!=='boolean')throw harnessError('INVALID_ACCESS_INPUT','enabled must be boolean');
  const account=await this.accountFor(owner,input.accountId);if(input.enabled&&(digest(account.owner)!==actor.ownerHash||account.status!=='connected'))deny();
  let g=data.grants.find(g=>g.accountId===input.accountId&&g.teamId===teamId);if(!g&&digest(account.owner)!==actor.ownerHash)deny();if(!g){g={teamId,accountId:input.accountId,enabled:false};data.grants.push(g);}g.enabled=input.enabled;
  return {teamId,accountId:input.accountId,enabled:g.enabled};
 });}
 async accountUse(owner,botId,accountId){
  await this.storage.tail;const data=this.storage.data,actor=data.principals.find(p=>p.ownerHash===digest(owner));if(!actor)deny();
  const b=botFor(data,actor,botId);if(!b.accountIds.includes(accountId))deny();const account=await this.canUse(data,actor,accountId,b.teamId);
  return {accountId,accountOwner:account.owner,resourceUrl:account.resourceUrl,name:account.name,disabledTools:[...(account.disabledTools??[])]};
 }
 async botBindings(owner,botId){
  await this.storage.tail;const data=this.storage.data,actor=data.principals.find(p=>p.ownerHash===digest(owner));if(!actor)deny();const b=botFor(data,actor,botId),result=[];
  for(const id of b.accountIds)result.push(await this.accountUse(owner,botId,id));return result;
 }
}

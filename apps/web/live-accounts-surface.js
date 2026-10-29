import {createLiveAccessSurface} from './live-access-surface.js';
import {createAccountsController} from './live-accounts-controller.js';
import {accountsListMarkup,accountDetailMarkup,accountFlowMarkup,providerAccountsMarkup} from './live-accounts-view.js';

export function createLiveAccountsSurface({host,client,isLive,key,serverId,refresh,onChange=()=>{}}){
 let dialog=null,disposed=false,polling=false;
 const access=createLiveAccessSurface({host,client,isLive,key});
 const controller=createAccountsController({client,onBound:async(receipt,id)=>{await refresh?.(id);},onChange:()=>{paint();onChange();}}),esc=host.esc;
 function markup(){
  const state={esc,...controller.state(),providerId:dialog?.providerId};
  if(dialog?.kind==='account')return accountDetailMarkup({...state,account:controller.account(dialog.id),canBind:Boolean(serverId)});
  if(dialog?.kind==='flow')return accountFlowMarkup({...state,flow:controller.flow(dialog.id)});
  return dialog?.providerId?providerAccountsMarkup(state):accountsListMarkup(state);
 }
 function current(){return dialog&&host.overlay.open&&dialog.version===host.getDialogVersion()&&isLive();}
 function paint(){
  if(disposed||!current())return;
  const root=host.overlay.querySelector('[data-live-accounts-root]');if(!root)return;
  const values=new Map(Array.from(root.querySelectorAll('[data-account-field]')).map(input=>[input.dataset.accountField,input.value]));
  const next=markup();if(next===dialog.signature)return;
  const focused=root.contains(document.activeElement)?document.activeElement?.dataset.accountField:null;
  root.outerHTML=next;dialog.signature=next;
  for(const input of host.overlay.querySelectorAll('[data-account-field]'))if(values.has(input.dataset.accountField))input.value=values.get(input.dataset.accountField);
  if(focused)host.overlay.querySelector(`[data-account-field="${focused}"]`)?.focus({preventScroll:true});
 }
 function open(kind='list',id,providerId){
  host.closePopover();dialog={kind,id,providerId};const content=markup();
  host.showDialog('marketplace',kind==='list'?(providerId==='github'?'GitHub':providerId==='notion'?'Notion':'Accounts beheren'):kind==='flow'?'Account verbinden':'Account beheren',content);
  dialog={kind,id,providerId,version:host.getDialogVersion(),signature:content};
  void controller.refresh();return true;
 }
 const field=name=>host.overlay.querySelector(`[data-account-field="${name}"]`)?.value.trim()||'';
 function start(payload,providerId){const version=dialog?.version,scope=dialog?.providerId;return (providerId?controller.startProvider(providerId,payload):controller.start(payload)).then(receipt=>{if(receipt?.flowId&&current()&&dialog.version===version)open('flow',receipt.flowId,scope);return true;});}
 function handleAction({action,id,target}){
  if(!isLive())return false;
  const accessHandled=access.handleAction({action,id,target});if(accessHandled)return accessHandled;
  if(action==='live-accounts-open')return open();
  if(action==='live-account-provider-open')return openProvider(id);
  if(action==='live-account-open')return open('account',id,dialog?.providerId);
  if(action==='live-account-flow-open')return open('flow',id,dialog?.providerId);
  if(action==='live-accounts-refresh')return controller.refresh().then(()=>true);
  if(action==='live-account-provider-start')return start({},id);
  if(action==='live-account-create')return start({name:field('name'),resourceUrl:field('url'),...(field('clientId')?{clientId:field('clientId')}:{})});
  if(action==='live-account-authenticate'){const account=controller.account(id);return account?start({accountId:account.id,name:account.name,resourceUrl:account.resourceUrl},account.providerId):true;}
  if(action==='live-account-flow-refresh')return controller.poll(id).then(()=>true);
  if(action==='live-account-flow-cancel')return controller.cancel(id).then(()=>true);
  if(action==='live-account-rename')return controller.rename(id,field('rename')).then(()=>true);
  if(action==='live-account-default')return controller.makeDefault(id).then(()=>true);
  if(action==='live-account-disconnect')return controller.disconnect(id).then(()=>true);
  if(action==='live-account-bind'){const selected=key();return serverId?controller.bind(id,{clientKey:selected,name:host.getConversation?.(selected)?.name||host.getAgent?.(selected)?.name||selected,conversationId:serverId(selected)}).then(()=>true):true;}
  return false;
 }
 function openProvider(id){return ['github','notion'].includes(id)?open('list',undefined,id):false;}
 const timer=setInterval(()=>{
  if(disposed||polling||!current()||document.visibilityState==='hidden')return;
  const flow=dialog.kind==='flow'?controller.flow(dialog.id):null;
  if(!['pending','exchanging'].includes(flow?.status))return;
  polling=true;void controller.poll(flow.flowId).finally(()=>{polling=false;});
 },2000);
 return {handleAction,openProvider,handleChange:access.handleChange,buttonMarkup:()=>'<button class="outline-button" data-action="live-accounts-open">Accounts beheren</button>',
  beforeDialogChange(){access.beforeDialogChange();dialog=null;},afterDialogChange(){access.afterDialogChange();paint();},sync(){access.sync();paint();},
  destroy(){disposed=true;clearInterval(timer);access.destroy();controller.destroy();}};
}

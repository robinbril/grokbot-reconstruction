import {createAccessController} from './live-access-controller.js';
import {accessMarkup} from './live-access-view.js';
export function createLiveAccessSurface({host,client,isLive,key}){
 let dialog=null,disposed=false;
 const controller=createAccessController({client,onChange:paint}),esc=host.esc;
 const field=(name)=>host.overlay.querySelector(`[data-access-field="${name}"]`)?.value.trim()||'';
 function current(){return !disposed&&dialog&&host.overlay.open&&dialog.version===host.getDialogVersion()&&isLive();}
 function paint(){
  if(!current())return;const root=host.overlay.querySelector('[data-live-access-root]');if(!root)return;
  const fields=new Map(Array.from(root.querySelectorAll('[data-access-field]')).map(input=>[input.dataset.accessField,input]));
  const markup=accessMarkup({esc,...controller.state()});if(markup===dialog.signature)return;
  const focused=root.contains(document.activeElement)?document.activeElement:null;
  root.outerHTML=markup;dialog.signature=markup;
  // Keep the actual edit target when a background read completes during typing or fill.
  for(const input of host.overlay.querySelectorAll('[data-access-field]'))if(fields.has(input.dataset.accessField))input.replaceWith(fields.get(input.dataset.accessField));
  if(focused?.isConnected)focused.focus({preventScroll:true});
 }
 function open(){host.closePopover();const markup=accessMarkup({esc,...controller.state()});host.showDialog('marketplace','Bots en teams',markup);dialog={version:host.getDialogVersion(),signature:markup};void controller.refresh();return true;}
 function handleAction({action,id,target}){
  if(!isLive())return false;
  if(action==='live-access-open')return open();
  if(action==='live-access-refresh')return controller.refresh().then(()=>true);
  if(action==='live-access-team-create')return controller.createTeam(field('teamName')).then(()=>true);
  if(action==='live-access-team-join')return controller.join(field('invitation')).then(()=>true);
  if(action==='live-access-bot-ensure'){const selected=key();return controller.ensureBot({clientKey:selected,name:host.getConversation?.(selected)?.name||host.getAgent?.(selected)?.name||selected}).then(()=>true);}
  if(action==='live-access-invite'){const input=host.overlay.querySelector(`[data-access-invite-role="${id}"]`);return controller.invite(id,input?.value||'member').then(()=>true);}
  if(action==='live-access-member-save'){const teamId=target.dataset.teamId,input=host.overlay.querySelector(`[data-access-member-role="${id}"][data-team-id="${teamId}"]`);return controller.member(teamId,id,input?.value||'member').then(()=>true);}
  if(action==='live-access-member-revoke')return controller.member(target.dataset.teamId,id,null).then(()=>true);
  if(action==='live-access-bot-unbind')return controller.unbind(id,target.dataset.accountId).then(()=>true);
  if(action==='live-access-bot-share'){const input=host.overlay.querySelector(`[data-access-bot-team="${id}"]`);return controller.share(id,input?.value||null).then(()=>true);}
  if(action==='live-access-invite-copy'){const token=controller.state().invitation?.token;if(!token)return true;return navigator.clipboard.writeText(token).then(()=>true).catch(()=>{host.overlay.querySelector('[aria-label="Nieuwe uitnodigingscode"]')?.select();return true;});}
  return false;
 }
 function handleChange(event){const input=event.target;if(!isLive()||!input.dataset.accessGrant)return;const accountId=input.dataset.accessGrant,teamId=input.dataset.teamId,enabled=input.checked;input.checked=controller.state().grants.some(grant=>grant.teamId===teamId&&grant.accountId===accountId);return controller.grant(teamId,accountId,enabled);}
 return {handleAction,handleChange,beforeDialogChange(){dialog=null;},afterDialogChange:paint,sync:paint,destroy(){disposed=true;controller.destroy();}};
}

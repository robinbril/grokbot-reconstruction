import {createSourceChatAvatars} from './source-chat-avatars.js';
// 0.75.5 source geometry, adapted to the replica's existing product lifecycle.
// #reference-chat is an explicit synthetic fixture, never a replay of private chats.
const REFERENCE_ID='reference-chat-builder';
const isReference=()=>location.hash==='#reference-chat';
function referenceMessages(){
 const rows=[
  ['user','Bekijk deze synthetische werkruimte en verdeel de lokale voorbeeldtaken over meerdere agents. Controleer de bronbestanden, leg de voortgang vast en rapporteer de resultaten. Gebruik uitsluitend fictieve gegevens. Dit gesprek toont de interface en voert geen externe acties uit.'],
  ['bot','Ik lees eerst de beschikbare vaardigheden en controleer daarna de lokale projectstatus.'],
  ['bot','De voorbeeldtools zijn beschikbaar. Ik laad de instructies en controleer de taakverdeling.'],
  ['bot','Ik lees de fictieve taken en werk daarna de lokale voortgang bij.'],
  ['bot','De eerste controles zijn verdeeld. Ik start de parallelle voorbeeldronde.'],
  ['bot','Zes controles lopen; ik zet de overige taken klaar en controleer ondertussen de resultaten.'],
  ['bot','De taken staan klaar voor beoordeling. Ik hervat de lokale voorbeeldwerkruimte.'],
  ['bot','Het voorbeeldproject draait lokaal. De onderstaande verbindingskaart toont een onvoltooide autorisatie.'],
  ['bot','De parallelle controles zijn afgerond. Ik werk de lokale voortgang bij.'],
  ['bot','De beoordeling is klaar: geen bevindingen in deze synthetische demonstratie.']
 ];
 return rows.map(([role,text],index)=>({id:`reference-message-${index}`,role,text,createdAt:1760000000000+index*60000,referenceDemo:true}));
}
function prepareReference(host){
 if(!isReference())return;
 const state=host.getState();
 if(!state.agents.some(agent=>agent.id===REFERENCE_ID))state.agents.push({id:REFERENCE_ID,name:'Voorbeeld Builder',preview:'Synthetische interfaceproef',color:'#a57137',shape:12,description:'Synthetische interfaceproef, uitsluitend lokaal.'});
 state.pins=[REFERENCE_ID,...state.pins.filter(id=>id!==REFERENCE_ID)];
 state.selected=REFERENCE_ID;state.compact=true;state.context=true;state.contextTab='computer';state.theme='light';
 state.messages[REFERENCE_ID]=referenceMessages();
 // This fixture has no live conversation ownership and never chooses a model.
 document.documentElement.dataset.theme='light';
}
function rail(host,shell){
 const sidebar=shell.querySelector('.sidebar'),top=sidebar.querySelector('.sidebar-top');
 const lights=top.querySelector('.traffic-lights');if(lights)sidebar.prepend(lights);
 top.dataset.sourceRailActions='';sidebar.querySelector('.sidebar-bottom').before(top);
 let apps=top.querySelector('[data-reference-apps]');
 if(!apps){apps=document.createElement('button');apps.type='button';apps.className='icon-button';apps.dataset.action='market';apps.dataset.referenceApps='';apps.setAttribute('aria-label','Apps verbinden');apps.innerHTML=host.icon('group');top.append(apps);}
}
function inspector(host,shell){
 const pane=shell.querySelector('.context-pane'),body=pane.querySelector('.context-body'),preview=body.querySelector('.product-computer-preview');
 const nav=pane.querySelector('.context-nav'),close=nav.querySelector('[data-action=toggle-context]');
 if(close){const toolbar=document.createElement('div');toolbar.className='source-inspector-toolbar';toolbar.append(close);pane.prepend(toolbar);}
 if(preview&&!body.querySelector('.source-computer-caption')){
  const title=preview.nextElementSibling;if(title?.tagName==='H3'){title.className='source-computer-sleep-label';preview.append(title);}
  const caption=document.createElement('p');caption.className='source-computer-caption';caption.textContent=`Scherm van ${host.selectedBot()?.name||'Bot'}`;preview.after(caption);
 }
 const identity=pane.querySelector('.context-avatar .small');if(identity)identity.textContent='Label toevoegen';
 const input=shell.querySelector('#message-input');if(input)input.setAttribute('data-placeholder',`Bericht sturen naar ${host.selectedBot()?.name||'Bot'}`);
}
function delegation(host,row,label,count){
 const line=document.createElement('div');line.className='source-reference-delegation';line.dataset.referenceDelegation='';
 const title=document.createElement('span');title.textContent=label;line.append(title);
 const peers=document.createElement('span');peers.className='source-reference-peers';peers.innerHTML=Array.from({length:3},()=>host.avatar({shape:12,color:'#949494'},'static')).join('');line.append(peers);
 const detail=document.createElement('span');detail.textContent=`${count} agents`;line.append(detail);row.before(line);
}
function connectionCard(host,row){
 const card=document.createElement('section');card.className='source-reference-connector';card.dataset.referenceConnector='';card.setAttribute('aria-label','Synthetisch Gmail-verbindingsvoorbeeld');
 card.innerHTML=`<div class="source-reference-connector-head">${host.logo(host.appData.find(app=>app.id==='gmail'))}<div><strong>Gmail</strong><p>Laat Grok Bot Gmail gebruiken</p></div></div><div class="source-reference-connector-status"><span>De autorisatie van Gmail is niet voltooid</span><button type="button" data-reference-retry>Opnieuw proberen</button></div><p class="source-reference-retry-status" role="status" hidden></p>`;
 card.querySelector('[data-reference-retry]').addEventListener('click',()=>{const status=card.querySelector('[role=status]');status.hidden=false;status.textContent='Synthetisch voorbeeld. Er is geen autorisatie gestart.';});
 const boundary=document.createElement('p');boundary.className='source-reference-boundary';boundary.textContent='Synthetische verbindingskaart. Er worden geen accounts gekoppeld.';
 row.before(card,boundary);
}
function fixtureFrames(host,shell){
 if(host.getConversationKey()!==REFERENCE_ID)return;
 shell.dataset.referenceChat='';
 const find=id=>shell.querySelector(`[data-message-id="reference-message-${id}"]`);
 if(find(5)&&!shell.querySelector('[data-reference-delegation]')){delegation(host,find(5),'Bericht gestuurd',6);delegation(host,find(6),'Bericht gestuurd',3);}
 if(find(7)&&!shell.querySelector('[data-reference-connector]'))connectionCard(host,find(7));
}
export function createScreenshotChatLayout(host){
 prepareReference(host);
 const originalAvatars=createSourceChatAvatars();
 function afterRender(){
  const shell=host.app.querySelector('.shell'),state=host.getState();
  if(!shell||!state.compact||!state.context||!shell.querySelector('.context-pane')){originalAvatars.clear();return;}
  shell.dataset.sourceChatLayout='';shell.style.setProperty('--sand-sidebar-width','88px');
  shell.style.gridTemplateColumns='88px minmax(0,1fr)';
  rail(host,shell);inspector(host,shell);fixtureFrames(host,shell);
  if(shell.hasAttribute('data-reference-chat'))void originalAvatars.mount(shell);else originalAvatars.clear();
 }
 return{id:'source-chat-layout',afterRender,diagnostics:()=>({sourceVersion:'0.75.5',syntheticReference:isReference(),backendParityClaim:false})};
}

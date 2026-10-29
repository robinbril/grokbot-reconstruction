import {attachMemberPopup} from './composer-member-popup.js';
import {mentionCandidates,rankMentionCandidates} from './composer-mentions.js';
import {composerMcpCandidates} from './composer-mcp-view.js';
import {iconsReady,iconSvg} from './icon-library.js';
import {composerController,composerEventInput,composerQueryContext,composerSelection,composerText,replaceComposerText,setComposerSelection} from './composer-input.js';
/* Independent local reconstruction of 0.71.2 WF21–WF29.
 * Suggestions insert references or invoke already-wired local app actions.
 * They never execute skill bodies, call a remote tool, or interpret slash text.
 */
const ACTIONS = Object.freeze([
  {id:'new-bot',label:'Nieuwe Bot',keywords:'nieuw bot maken create agent',detail:'Maak een Bot',icon:'plus'},
  {id:'new-group-chat',label:'Nieuwe groepschat',keywords:'groep chat maken group',detail:'Begin een groepsgesprek',icon:'group'},
  {id:'settings:general',label:'Algemene instellingen',keywords:'instellingen settings algemeen voorkeuren',detail:'Open je voorkeuren',icon:'settings'},
  {id:'settings:computer',label:'Computerinstellingen',keywords:'computer instellingen desktop',detail:'Bekijk je computer',icon:'computer'},
  {id:'overlay:plugins',label:'Apps verbinden',keywords:'apps koppelen verbinden plugins plug-ins vaardigheden skills',detail:'Beheer je apps en vaardigheden',icon:'link'},
  {id:'theme:system',label:'Systeemthema',keywords:'thema theme systeem automatisch system appearance',detail:'Volg de weergave van je apparaat',icon:'computer'},
  {id:'theme:light',label:'Licht thema',keywords:'thema theme licht light weergave',detail:'Gebruik de lichte weergave',icon:'settings'},
  {id:'theme:dark',label:'Donker thema',keywords:'thema theme donker dark weergave',detail:'Gebruik de donkere weergave',icon:'settings'}
]);

const fold = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('nl');
const own = (object,key) => object && Object.hasOwn(object,key) ? object[key] : undefined;
// FNV-1a-128 is a bounded, deterministic local identity key, never an auth or
// integrity check. Original label/instructions remain on the reference snapshot.
function localSkillId(label,description) {
  let hash=0x6c62272e07bb014262b821756295c58dn;
  const content=JSON.stringify([label,description]);
  for(let i=0;i<content.length;i++)hash=BigInt.asUintN(128,(hash^BigInt(content.charCodeAt(i)))*0x0000000001000000000000000000013bn);
  return `local-skill:${hash.toString(16).padStart(32,'0')}`;
}

/** Only a slash beginning a whitespace-delimited token at a collapsed caret. */
export function composerSlashToken(value,start,end=start) {
  if(typeof value!=='string'||!Number.isInteger(start)||start<0||start>value.length||start!==end)return null;
  const match=value.slice(0,start).match(/(?:^|\s)\/([^\s/]*)$/u);
  return match ? {start:start-match[1].length-1,end:start,query:match[1]} : null;
}

// Native 0.71.2 skill plumbing scans a bounded text window and includes the
// remainder of the current word after the caret in the replaceable range.
const skillQueryPunctuation=`,\\+\\*\\?\\$\\@\\|#{}\\(\\)\\^\\-\\[\\]\\\\!%'"~=<>:;`;
export function composerSkillToken(value,start,end=start) {
  if(typeof value!=='string'||!Number.isInteger(start)||start<0||start>value.length||start!==end)return null;
  const before=value.slice(Math.max(0,start-200),start),after=value.slice(start).split(/\s/u,1)[0];
  const text=before+after,offset=start-before.length;
  for(const trigger of ['/','@']){
    const character=`[^${trigger}${skillQueryPunctuation}\\s]`;
    const separator=`(?:\\.[ |$]| |[${skillQueryPunctuation}/]|)`;
    const multiWord=new RegExp(`(^|\\s|\\()([${trigger}]((?:${character}${separator}){0,120}))$`);
    const singleWord=new RegExp(`(^|\\s|\\()([${trigger}]((?:${character}){0,50}))$`);
    const match=multiWord.exec(text)??singleWord.exec(text);
    if(!match||match[3].length>50)continue;
    const from=offset+match.index+match[1].length,to=from+match[2].length;
    if(from<start&&to>=start)return {start:from,end:to,query:match[3],trigger};
  }
  return null;
}

/** Existing privateSkills predate IDs; a content key stays stable across reload/reorder. */
export function composerSkillReference(skill) {
  if(!skill||typeof skill!=='object'||skill.trigger!=null||skill.spec?.trigger!=null)return null;
  const label=typeof skill.name==='string'?skill.name:skill.spec?.name;
  if(typeof label!=='string'||!label.trim())return null;
  const description=typeof skill.description==='string'?skill.description:typeof skill.spec?.description==='string'?skill.spec.description:'';
  const id=typeof skill.id==='string'&&skill.id?skill.id:localSkillId(label,description);
  return {kind:'skill',id,label,description,...(skill.storage==='harness'&&Number.isSafeInteger(skill.revision)&&skill.revision>0?{revision:skill.revision}:{})};
}

// Server skills travel as immutable version references; legacy snapshots retain their old text contract.
export function liveSkillPayload(references=[]) {
 const canonical=references.filter(ref=>Number.isSafeInteger(ref.revision)&&ref.revision>0);
 const legacy=references.filter(ref=>!Number.isSafeInteger(ref.revision)||ref.revision<1);
 return {...(canonical.length?{skillRefs:canonical.map(({id,revision})=>({id,revision}))}:{}),...(legacy.length?{skillReferences:legacy.map(ref=>JSON.stringify(ref,null,2))}:{})};
}

function savedReferences(state,key) {
  const list=own(state.composerSkillReferences,key);
  return Array.isArray(list)?list.filter(ref=>ref?.kind==='skill'&&typeof ref.id==='string'&&typeof ref.label==='string').map(ref=>({kind:'skill',id:ref.id,label:ref.label,description:typeof ref.description==='string'?ref.description:'',...(Number.isSafeInteger(ref.revision)&&ref.revision>0?{revision:ref.revision}:{})})):[];
}

export function composerSuggestions(skills=[],query='',{actions=true}={}) {
  const needle=fold(query),terms=needle.split(/\s+/).filter(Boolean);
  const match=item=>terms.every(term=>fold(`${item.label} ${item.keywords||''} ${item.detail||''}`).includes(term));
  const rank=item=>fold(item.label).startsWith(needle)?0:fold(item.label).includes(needle)?1:2;
  const byRank=(a,b)=>rank(a)-rank(b);
  const seen=new Set();
  const references=(Array.isArray(skills)?skills:[]).map(composerSkillReference).filter(ref=>{
    if(!ref||seen.has(ref.id))return false;seen.add(ref.id);return fold(ref.label).includes(needle);
  }).map(ref=>({...ref,key:`skill:${ref.id}`,detail:ref.description,icon:'book'})).sort(byRank);
  const candidates=(actions?ACTIONS:[]).filter(match).map(action=>({...action,kind:'action',key:`action:${action.id}`})).sort(byRank);
  const visibleSkills=references.slice(0,8-Math.min(3,candidates.length));
  return [...visibleSkills,...candidates.slice(0,8-visibleSkills.length)];
}

export function createComposerCommands(host) {
  const esc=host.esc,icon=host.icon||(()=>''),app=host.app;
  let input=null,menu=null,token=null,items=[],active=0,binding=null,closedAt=null,error='',destroyed=false;
  const rootAbort=new AbortController(),handledKeys=new WeakSet();let closedMention=null,mentionRecents=[],popup=null,blurredMention=null,noResultsMention=null,listObserver=null;
  const key=()=>String(host.getConversationKey?.()||'new');
  const refs=()=>savedReferences(host.getState(),key());
  const signature=field=>{const selection=composerSelection(field);return `${key()}\u0000${composerText(field)}\u0000${selection.start}\u0000${selection.end}`;};

  function setExpanded(open) {
    if(!input||!open&&input.getAttribute('aria-controls')!=='composer-command-list')return;
    input.setAttribute('aria-expanded',String(open));
    if(open){input.setAttribute('aria-controls','composer-command-list');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');}
    else {input.removeAttribute('aria-controls');input.removeAttribute('aria-activedescendant');}
  }
  const mcpState=()=>host.getMcpReferenceInventory?.()??{};
  const hasMcpState=()=>Boolean(mcpState().loading||mcpState().failed);
  const nativeMentionSession=()=>token?.trigger==='@'&&(hasMcpState()||!items.length||items.some(item=>item.kind==='mention'||item.kind==='mcp'));
  function close({suppress=false}={}) {
    if(suppress&&input){if(nativeMentionSession())closedMention={start:token.start,controller:composerController(input)};else closedAt=signature(input);}
    listObserver?.disconnect();listObserver=null;popup?.destroy();popup=null;menu?.remove();menu=null;token=null;items=[];active=0;setExpanded(false);
  }
  function referenceMarkup() {
    const selected=host.getState().draftRichTexts?.[key()]?[]:refs();
    return `<div class="composer-skill-references" data-composer-skill-references ${selected.length?'':'hidden'} aria-label="Geselecteerde vaardigheden">${selected.map(ref=>`<span class="composer-skill-reference" data-skill-reference-id="${esc(ref.id)}">${icon('book')}<span>${esc(ref.label)}${ref.revision?` · Versie ${esc(ref.revision)}`:''}</span><button type="button" data-action="composer-skill-remove" data-id="${esc(ref.id)}" aria-label="Vaardigheid ${esc(ref.label)} verwijderen">${icon('close')}</button></span>`).join('')}</div>`;
  }
  function refreshReferences() {
    const container=app.querySelector('[data-composer-skill-references]');
    if(container)container.outerHTML=referenceMarkup();
    host.onComposerPayloadChange?.();
  }
  function showError(message) {
    error=message;
    let status=app.querySelector('[data-composer-command-status]');
    if(!status){status=app.ownerDocument.createElement('p');status.className='composer-command-status';status.dataset.composerCommandStatus='';status.setAttribute('role','status');app.querySelector('.composer-wrap')?.append(status);}
    if(status){status.textContent=message;status.hidden=!message;}
  }
  function commit(build) {
    if(typeof host.commit!=='function')return false;
    const result=host.commit(build);
    return result===true||result?.ok===true;
  }
  function mentionRecentKeys(){return (Array.isArray(host.getState().mentionRecents)?host.getState().mentionRecents:[]).flatMap(item=>item&&typeof item.category==='string'&&typeof item.id==='string'?[`${item.category}:${item.id}`]:[]);}
  function recordMention(item){
    const category=item.category??'automations';
    commit(state=>({...state,mentionRecents:[{category,id:item.id},...(Array.isArray(state.mentionRecents)?state.mentionRecents:[]).filter(value=>value?.category!==category||value?.id!==item.id)].slice(0,20)}));
  }
  function currentToken(){
    const rich=composerController(input),native=rich?.getEmojiQueryContext();
    const local=native&&composerSkillToken(native.text,native.start,native.end);
    if(local?.trigger==='@')return native.toRange(local);
    const query=composerQueryContext(input),fallback=query&&composerSkillToken(query.text,query.start,query.end);return native&&fallback?.trigger==='@'?null:fallback;
  }
  function mentionRows(query){
    const state=host.getState(),current=host.selectedBot?.()??host.getAgent?.(key()),members=mentionCandidates(current,state.agents??[]);
    // Retain the existing ordinary @skill extension until its explicit product
    // policy is resolved. These still use immutable workflowReference metadata.
    const skills=composerSuggestions(state.privateSkills,query,{actions:typeof host.runComposerAction==='function'}).map(item=>({...item,category:item.kind==='action'?'local-actions':'automations',keywords:typeof item.keywords==='string'?[item.keywords]:item.keywords??[]}));
    return rankMentionCandidates([...members,...composerMcpCandidates(host.getMcpReferenceInventory?.()),...skills],query,mentionRecents);
  }
  function mentionIcon(item){
    if(item.kind==='mcp')return iconsReady()?`<span class="icon" aria-hidden="true">${iconSvg('plug',{size:16})}</span>`:icon('link');
    if(item.id==='__everyone__')return '<span class="icon" aria-hidden="true">@</span>';
    if(item.member?.group||item.member?.isGroup)return iconsReady()?`<span class="icon" aria-hidden="true">${iconSvg('people-3',{size:16})}</span>`:icon('group');
    return item.member&&host.avatar?host.avatar(item.member,'static'):icon(item.icon);
  }
  function optionMarkup(item,index,position=''){
    return `<button type="button" id="composer-command-option-${index}" class="composer-command-option" role="option" aria-label="${esc(item.label)}" aria-selected="${index===active}" aria-posinset="${index+1}" aria-setsize="${items.length}" tabindex="-1" data-action="composer-command-select" data-command-key="${esc(item.key)}" data-command-kind="${item.kind}" ${position}>${mentionIcon(item)}<span class="composer-command-copy"><strong>${esc(item.label)}</strong>${item.detail?`<span>${esc(item.detail)}</span>`:''}</span><span class="composer-command-kind">${item.typeLabel??(item.kind==='skill'?'Vaardigheid':'Actie')}</span></button>`;
  }
  function renderMemberRows(){
    const list=menu?.querySelector('[role=listbox]'),content=list?.querySelector('[data-member-rows]');if(!content)return;
    const offset=list.scrollTop-6,height=list.clientHeight||320,first=Math.min(Math.max(0,Math.floor(offset/30)-6),Math.max(0,items.length-1)),end=Math.max(Math.min(items.length,Math.floor((offset+height)/30)+7),first);
    const indices=new Set(Array.from({length:Math.max(0,end-first)},(_,i)=>first+i));if(items[active])indices.add(active);
    content.innerHTML=[...indices].sort((a,b)=>a-b).map(index=>optionMarkup(items[index],index,`style="top:${6+index*30}px"`)).join('');
  }
  function renderMenu({preserveScroll=false}={}) {
    if(!menu)return;
    const scroll=preserveScroll?menu.querySelector('[role=listbox]')?.scrollTop??0:0;
    const mentioning=token?.trigger==='@';menu.toggleAttribute('data-member-menu',mentioning);
    const rows=mentioning?`<div data-member-rows style="height:${12+items.length*30-2}px"></div>`:items.map((item,index)=>optionMarkup(item,index)).join('');
    const empty=mentioning?`<p class="composer-command-empty"><span>${esc(token.query.trim()?`Geen overeenkomsten voor “${token.query.trim()}”`:'Nog niets om te vermelden')}</span><span>Druk op Esc om te sluiten</span></p>`:'<p class="composer-command-empty">Geen vaardigheden of acties gevonden</p>';
    listObserver?.disconnect();listObserver=null;
    const inventory=mentioning?mcpState():{},state=inventory.failed?'<div class="composer-mcp-state" role="status"><span>Plug-ins konden niet worden ververst.</span><button type="button" data-mcp-reference-retry>Opnieuw proberen</button></div>':inventory.loading?'<div class="composer-mcp-state" role="status">Plug-ins laden…</div>':'';
    menu.innerHTML=`${state}${mentioning?'':'<div class="composer-command-heading" aria-hidden="true">Vaardigheden en acties</div>'}<div id="composer-command-list" role="listbox" aria-label="${mentioning?'Vermelding':'Vaardigheden en acties'}">${items.length?rows:state?'':empty}</div>`;
    if(mentioning){const list=menu.querySelector('[role=listbox]');if(list)list.scrollTop=scroll;list?.addEventListener('scroll',renderMemberRows,{passive:true});if(list&&typeof ResizeObserver!=='undefined'){listObserver=new ResizeObserver(renderMemberRows);listObserver.observe(list);}renderMemberRows();}
    if(mentioning&&composerController(input)?.getRangeRect){
      if(!popup)popup=attachMemberPopup(menu,input,()=>token&&composerController(input)?.getRangeRect(token));
      popup.update();
    }else if(popup){popup.destroy();popup=null;menu.removeAttribute('style');app.querySelector('.composer-wrap')?.append(menu);}
    setExpanded(items.length>0||Boolean(state));syncActive({reveal:!preserveScroll});
  }
  function syncActive({keyboard=false,reveal=false}={}) {
    if(!menu||!input)return;
    const list=menu.querySelector('[role=listbox]');
    if(token?.trigger==='@'&&items.length&&list){
      const top=6+active*30,bottom=top+28;
      if(reveal&&(top<list.scrollTop||bottom>list.scrollTop+list.clientHeight))list.scrollTop=Math.max(0,top-(list.clientHeight-28)/2);
      else if(keyboard){if(top<list.scrollTop)list.scrollTop=top;else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=bottom-list.clientHeight;}
      renderMemberRows();
    }
    menu.querySelectorAll('[role=option]').forEach(option=>option.setAttribute('aria-selected',String(option.id===`composer-command-option-${active}`)));
    if(items.length){input.setAttribute('aria-activedescendant',`composer-command-option-${active}`);if(token?.trigger!=='@')menu.querySelector(`[id="composer-command-option-${active}"]`)?.scrollIntoView?.({block:'nearest'});}
    else input.removeAttribute('aria-activedescendant');
  }
  function updateSuggestions({force=false}={}) {
    if(destroyed||!input||input.disabled||input.readOnly||input.getAttribute?.('contenteditable')==='false')return close();
    if(!force&&closedAt===signature(input))return;
    if(composerController(input)?.getRangeRect&&input.ownerDocument.activeElement!==input)return close();
    const nextToken=currentToken();
    const controller=composerController(input),plain=composerQueryContext(input)?.text??'';
    if(blurredMention&&(blurredMention.controller!==controller||plain[blurredMention.start]!=='@'||nextToken?.start!==blurredMention.start))blurredMention=null;
    if(noResultsMention&&(noResultsMention.controller!==controller||plain[noResultsMention.start]!=='@'||plain.length<noResultsMention.length||nextToken?.start!==noResultsMention.start))noResultsMention=null;
    if(!nextToken)return close();
    if(nextToken.trigger==='@'&&(blurredMention||noResultsMention))return close();
    if(closedMention){const rich=composerController(input),context=composerQueryContext(input);if(closedMention.controller!==rich||context.text[closedMention.start]!=='@')closedMention=null;else if(nextToken.trigger==='@'&&nextToken.start===closedMention.start)return close();}
    if(nextToken.trigger==='@'&&(!menu||token?.trigger!=='@'))mentionRecents=mentionRecentKeys();
    const nextItems=nextToken.trigger==='@'?mentionRows(nextToken.query):composerSuggestions(host.getState().privateSkills,nextToken.query,{actions:typeof host.runComposerAction==='function'});
    if(nextToken.trigger==='@'&&!hasMcpState()&&!nextItems.length&&nextToken.query.includes(' ')){noResultsMention={start:nextToken.start,controller,length:plain.length};return close();}
    if(nextToken.trigger==='@'&&!hasMcpState()&&!nextItems.length&&!nextToken.query.trim())return close();
    const oldKey=items[active]?.key;
    const sameQuery=token?.query===nextToken.query&&token?.trigger===nextToken.trigger;token=nextToken;items=nextItems;active=nextToken.trigger==='@'&&!sameQuery?0:Math.max(0,items.findIndex(item=>item.key===oldKey));
    if(!menu){
      menu=app.ownerDocument.createElement('div');menu.className='composer-command-menu';menu.dataset.composerCommandMenu='';
      menu.addEventListener('pointerdown',event=>{if(event.target.closest?.('[role=option],[data-mcp-reference-retry]'))event.preventDefault();});
      menu.addEventListener('click',event=>{if(event.target.closest?.('[data-mcp-reference-retry]')){event.preventDefault();event.stopPropagation();void host.refreshMcpReferences?.()?.catch(()=>{});}});
      menu.addEventListener('pointermove',event=>{
        const option=event.target.closest?.('[data-command-key]');
        const index=option?items.findIndex(item=>item.key===option.dataset.commandKey):-1;
        if(index>=0&&index!==active){active=index;syncActive();}
      });
      app.querySelector('.composer-wrap')?.append(menu);
    }
    renderMenu({preserveScroll:sameQuery});
  }
  function select(item) {
    if(!input||!token||!item)return false;
    // These are the local send-journal bounds, not a claim about Grok's limits.
    if(item.kind==='skill'){
      if(item.label.length>256||item.id.length>256||(item.description||'').length>4000){showError('Deze vaardigheid past niet in een lokaal bericht. Gebruik een naam van maximaal 256 tekens en instructies van maximaal 4000 tekens.');return false;}
      const selected=refs();
      if(selected.length>=50&&!selected.some(ref=>ref.id===item.id)){showError('Je kunt maximaal 50 vaardigheden aan een lokaal bericht toevoegen.');return false;}
    }
    const candidate=currentToken();
    if(!candidate||candidate.start!==token.start||candidate.end!==token.end||candidate.query!==token.query||candidate.trigger!==token.trigger){updateSuggestions();return false;}
    const rich=composerController(input);
    if(rich){
      if(item.kind==='mcp'){
        if(!rich.replaceMcpReference({start:token.start,end:token.end},{id:item.referenceId,label:item.label})){showError(rich.error?.()||'Je selectie kon niet worden opgeslagen. Probeer opnieuw.');return false;}
        recordMention(item);close();showError('');input.focus({preventScroll:true});return true;
      }
      if(item.kind==='mention'){
        if(!rich.replaceMention({start:token.start,end:token.end},{id:item.id,label:item.insertLabel})){showError(rich.error?.()||'Je selectie kon niet worden opgeslagen. Probeer opnieuw.');return false;}
        recordMention(item);close();showError('');input.focus({preventScroll:true});return true;
      }
      const reference=item.kind==='skill'?{kind:'skill',id:item.id,label:item.label,description:item.description||'',...(item.revision?{revision:item.revision}:{})}:null;
      if(!rich.replaceSuggestion({start:token.start,end:token.end},reference)){showError(rich.error?.()||'Je selectie kon niet worden opgeslagen. Probeer opnieuw.');return false;}
      close();showError('');refreshReferences();input.focus({preventScroll:true});
      if(item.kind==='action')host.runComposerAction(item.id);
      return true;
    }
    const field=input,conversation=key(),before=composerText(field),caret=token.start;
    const nextText=before.slice(0,token.start)+before.slice(token.end);
    const success=commit(current=>{
      const currentRefs=savedReferences(current,conversation);
      const nextRefs=item.kind==='skill'&&!currentRefs.some(ref=>ref.id===item.id)?[...currentRefs,{kind:'skill',id:item.id,label:item.label,description:item.description||'',...(item.revision?{revision:item.revision}:{})}]:currentRefs;
      const draftRichTexts={...current.draftRichTexts};delete draftRichTexts[conversation];
      return {...current,draftRichTexts,drafts:{...current.drafts,[conversation]:nextText},composerSkillReferences:{...current.composerSkillReferences,[conversation]:nextRefs}};
    });
    if(!success){showError('Je selectie kon niet worden opgeslagen. Probeer opnieuw.');return false;}
    replaceComposerText(field,nextText);setComposerSelection(field,caret,caret);close();showError('');refreshReferences();
    field.focus({preventScroll:true});
    field.dispatchEvent(new Event('input',{bubbles:true}));
    if(item.kind==='action')host.runComposerAction(item.id);
    return true;
  }
  function handleInput(event) {
    const field=composerEventInput(event.target);if(!field)return;
    input=field;
    if(event.isComposing){close();return;}
    if(closedAt!==signature(input))closedAt=null;
    if(error)showError('');updateSuggestions();
  }
  function handleKeyDown(event) {
    if(handledKeys.has(event))return true;const handled=processKeyDown(event);if(handled)handledKeys.add(event);return handled;
  }
  function processKeyDown(event) {
    const field=composerEventInput(event.target);if(!field||event.isComposing||event.keyCode===229||event.metaKey||event.ctrlKey||event.altKey)return false;
    input=field;
    if(!menu)return false;
    if(token?.trigger==='@'&&!items.length&&hasMcpState()&&['Enter','Tab','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();return true;}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close({suppress:true});return true;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      if(items.length){active=(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;syncActive({keyboard:true});}
      return true;
    }
    if((event.key==='Enter'&&!event.shiftKey)||(event.key==='Tab'&&!event.shiftKey)){
      if(!items.length){close({suppress:true});return false;}
      event.preventDefault();event.stopPropagation();if(!event.repeat)select(items[active]);return true;
    }
    return false;
  }
  function handleAction({action,target,id}) {
    if(action==='composer-command-select'){
      const selected=items.find(item=>item.key===target?.dataset.commandKey);
      if(selected)select(selected);return true;
    }
    if(action==='composer-skill-remove'){
      const conversation=key(),referenceId=id??target?.dataset.id;
      const rich=composerController(input);
      if(rich){if(!rich.removeReference(referenceId)){showError('De vaardigheid kon niet worden verwijderd. Probeer opnieuw.');return true;}refreshReferences();showError('');input.focus({preventScroll:true});return true;}
      const success=commit(current=>{
        const selected=savedReferences(current,conversation),remaining=selected.filter(ref=>ref.id!==referenceId);
        if(remaining.length===selected.length)return current;
        const draftRichTexts={...current.draftRichTexts};delete draftRichTexts[conversation];
        return {...current,draftRichTexts,composerSkillReferences:{...current.composerSkillReferences,[conversation]:remaining}};
      });
      if(!success){showError('De vaardigheid kon niet worden verwijderd. Probeer opnieuw.');return true;}
      refreshReferences();showError('');input?.focus({preventScroll:true});return true;
    }
    return false;
  }
  function blur(){if(nativeMentionSession())blurredMention={start:token.start,controller:composerController(input)};close();}
  function bind() {
    const next=app.querySelector('#message-input');
    if(next===input&&binding)return;
    composerController(input)?.setMentionHandlers?.(null);binding?.abort();input=next;if(!input)return;
    binding=new AbortController();const signal=binding.signal;
    composerController(input)?.setMentionHandlers?.({keyDown:handleKeyDown,transaction(){queueMicrotask(()=>{if(!destroyed){if(closedMention&&composerQueryContext(input)?.text[closedMention.start]!=='@')closedMention=null;updateSuggestions();}});},blur});
    input.setAttribute('aria-expanded','false');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');
    input.addEventListener('click',()=>updateSuggestions(),{signal});
    input.addEventListener('keyup',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))updateSuggestions();},{signal});
    input.addEventListener('compositionstart',()=>close(),{signal});
    input.addEventListener('compositionend',()=>updateSuggestions(),{signal});
    input.addEventListener('blur',blur,{signal});
  }
  app.ownerDocument.addEventListener('pointerdown',event=>{if(menu&&!menu.contains(event.target)&&!input?.contains?.(event.target)&&event.target!==input){if(nativeMentionSession())blurredMention={start:token.start,controller:composerController(input)};close({suppress:true});}},{signal:rootAbort.signal});
  app.ownerDocument.addEventListener('grok-mcp-references-changed',event=>{if(event.target===app&&event.detail?.conversationKey===key())updateSuggestions();},{signal:rootAbort.signal});
  return {
    id:'composer-commands',
    beforeRender(){close();composerController(input)?.setMentionHandlers?.(null);binding?.abort();binding=null;input=null;error='';},
    afterRender(){if(!destroyed)bind();},
    beforeDialogChange(){close({suppress:true});},
    handleInput,handleKeyDown,handleAction,
    renderSlot(name){if(name==='composerSkillReferences')return referenceMarkup();},
    destroy(){destroyed=true;close();composerController(input)?.setMentionHandlers?.(null);binding?.abort();rootAbort.abort();if(input){for(const attribute of ['aria-expanded','aria-controls','aria-activedescendant','aria-autocomplete','aria-haspopup'])input.removeAttribute(attribute);}},
    diagnostics:()=>({open:Boolean(menu),suggestions:items.length,selectedSkills:refs().length})
  };
}

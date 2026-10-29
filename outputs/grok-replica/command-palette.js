import {iconSvg,iconsReady} from './icon-library.js';
// Native 0.71.2 N02/N03: one command registry, with independent Bot search shortcut.
const themes=[['system','Systeem volgen','computer','appearance os auto follow'],['light','Licht','sun','appearance day bright'],['dark','Donker','moon','appearance night mode']];
const settings=[['general','Algemeen','settings','general preferences appearance'],['computer','Computer','computer','desktop permissions'],['usage','Gebruik en facturering','clock','usage billing'],['updates','Updates','download','updates version']];
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function paletteCommands(state){
 const bots=state.agents.filter(bot=>!state.hidden.includes(bot.id)).map(bot=>({id:`bot:${bot.id}`,label:bot.name,group:'Bots',bot,keywords:'bot chat conversation'}));
 return [...bots,
  {id:'new-bot',label:'Nieuwe Bot',icon:'plus',group:'Acties',keywords:'new bot create'},
  {id:'new-group-chat',label:'Nieuwe groepschat',icon:'group',group:'Acties',keywords:'new group chat'},
  ...settings.map(([id,label,icon,keywords])=>({id:`settings:${id}`,label:`${label} instellingen`,icon,group:'Instellingen',detail:'Instellingen',keywords})),
  {id:'overlay:plugins',label:'Apps verbinden',icon:'link',group:'Apps',keywords:'plugins marketplace tools skills mcp connectors customize apps'},
  ...themes.map(([id,label,icon,keywords])=>({id:`theme:${id}`,label,icon,group:'Thema',detail:'Thema',keywords:`theme thema ${keywords}`,active:state.theme===id})),
  ...(Array.isArray(state.workspaceDocuments)?state.workspaceDocuments:[]).map(page=>({id:`page:${page.id}`,label:page.title||'Naamloos document',icon:'file',group:'Pagina’s',detail:'Pagina',keywords:'page document',page}))];
}
export function filterPaletteCommands(commands,query,scope='all'){
 const terms=fold(query).trim().split(/\s+/).filter(Boolean);
 return commands.filter(row=>(scope!=='pages'||row.page)&&terms.every(term=>fold(`${row.label} ${row.detail||''} ${row.keywords||''}`).includes(term)));
}
export function paletteShortcut(event){
 if(event.isComposing||event.altKey||!(event.metaKey||event.ctrlKey))return null;
 const key=event.key.toLowerCase();
 if(key==='k'&&!event.shiftKey)return 'palette';
 if(key==='f'&&event.shiftKey)return 'search';
 return null;
}
export function createCommandPalette(host){
 const doc=host.app.ownerDocument;
 const css=doc.createElement('link');css.rel='stylesheet';css.href=new URL('./command-palette.css',import.meta.url).href;doc.head.append(css);
 let dialog=null,input=null,list=null,items=[],active=0,invoker=null,scope='all';
 function close({restore=true}={}){
  if(!dialog)return;
  dialog.close();dialog.remove();dialog=null;
  if(restore&&invoker?.isConnected)invoker.focus({preventScroll:true});
 }
 function select(index){
  const row=items[index];if(!row)return;
  close({restore:false});
  if(row.bot)host.openBot(row.bot.id);
  else if(row.page)host.openDocument(row.page.id);
  else if(row.id.startsWith('settings:'))host.renderSettings(row.id.slice(9));
  else host.runComposerAction(row.id);
  if(row.id.startsWith('theme:'))(invoker?.isConnected?invoker:host.app.querySelector('#message-input'))?.focus({preventScroll:true});
 }
 function syncActive(){
  list.querySelectorAll('[role=option]').forEach((node,index)=>node.setAttribute('aria-selected',String(index===active)));
  if(items.length){input.setAttribute('aria-activedescendant',`jump-option-${active}`);list.children[active]?.scrollIntoView({block:'nearest'});}
  else input.removeAttribute('aria-activedescendant');
 }
 function filter(){
  items=filterPaletteCommands(paletteCommands(host.getState()),input.value,scope);active=0;
  list.innerHTML=items.length?items.map((row,index)=>`<button type="button" role="option" aria-label="${host.esc(row.label)}" aria-selected="${index===active}" id="jump-option-${index}" data-palette-index="${index}" tabindex="-1">${row.bot?host.avatar(row.bot):(['sun','moon'].includes(row.icon)&&iconsReady()?`<span class="icon">${iconSvg(row.icon)}</span>`:host.icon(row.icon))}<span class="jump-label">${host.esc(row.label)}</span>${row.active?'<span class="jump-current">Huidig</span>':''}${row.detail?`<span class="jump-detail">${host.esc(row.detail)}</span>`:''}</button>`).join(''):'<p class="jump-empty" role="status">Geen resultaten</p>';
  syncActive();
 }
 function open(){
  if(dialog)return close();
  invoker=doc.activeElement;host.closePopover();scope='all';
  dialog=doc.createElement('dialog');dialog.className='command-palette';dialog.setAttribute('aria-label','Spring naar');
  dialog.innerHTML=`<label class="jump-search">${host.icon('search')}<input role="combobox" aria-label="Spring naar" placeholder="Spring naar..." aria-autocomplete="list" aria-expanded="true" aria-controls="jump-results" autocomplete="off" spellcheck="false"></label><nav class="jump-tabs" role="tablist" aria-label="Zoekbereik"><button type="button" role="tab" aria-selected="true" aria-controls="jump-results" data-palette-scope="all">Alle</button><button type="button" role="tab" aria-selected="false" aria-controls="jump-results" data-palette-scope="pages">Pagina’s</button></nav><div id="jump-results" role="listbox" aria-label="Bots en acties"></div>`;
  input=dialog.querySelector('input');list=dialog.querySelector('[role=listbox]');
  input.addEventListener('input',filter);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{
   const tab=event.target.closest('[data-palette-scope]');
   if(tab){scope=tab.dataset.paletteScope;dialog.querySelectorAll('[role=tab]').forEach(node=>node.setAttribute('aria-selected',String(node===tab)));filter();input.focus();return;}
   const option=event.target.closest('[data-palette-index]');if(option)select(Number(option.dataset.paletteIndex));
   else if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}
  });
  dialog.addEventListener('pointerdown',event=>{if(event.target.closest('[role=option]'))event.preventDefault();});
  dialog.addEventListener('pointermove',event=>{const option=event.target.closest('[data-palette-index]');if(option){active=Number(option.dataset.paletteIndex);syncActive();}});
  dialog.addEventListener('keydown',event=>{
   if(event.isComposing)return;
   if(event.target.matches('[role=tab]')){
    if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tabs=[...dialog.querySelectorAll('[role=tab]')],index=tabs.indexOf(event.target),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();}
    return;
   }
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&items.length){event.preventDefault();active=event.key==='Home'?0:event.key==='End'?items.length-1:(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;syncActive();}
   else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();select(active);}
  });
  doc.body.append(dialog);filter();dialog.showModal();input.focus();
 }
 return {open,close,handleKeyDown(event){
  const shortcut=paletteShortcut(event);if(!shortcut)return false;
  event.preventDefault();if(shortcut==='palette')open();else{close({restore:false});host.showSearch();}return true;
 }};
}

import {classifyPRLink,collectPRCandidates,resolvePRLabel} from './pr-reference.js';
import {iconsReady,fetchIconData,iconSvg} from './icon-library.js';
const originals=new WeakMap(),contexts=new WeakMap(),keyboardRoots=new WeakSet();
function bindKeyboard(root){
 if(keyboardRoots.has(root))return;keyboardRoots.add(root);
 root.addEventListener('keydown',event=>{
  const anchor=event.target.closest?.('a.pr-reference');
  if(!event.defaultPrevented&&event.key===' '&&anchor&&root.contains(anchor)){event.preventDefault();anchor.click();}
 });
}

/** Only generated markdown link classes reach this boundary; raw HTML is escaped upstream. */
export function decoratePRLinks(root,candidates){
 bindKeyboard(root);candidates??=contexts.get(root.closest?.('.transcript'))??new Map();
 for(const anchor of root.querySelectorAll('a.pr-reference-source')){
  const href=anchor.getAttribute('href'),link=classifyPRLink(href);if(!link)continue;
  if(!originals.has(anchor)||!anchor.classList.contains('pr-reference')){
   const previous=anchor.classList.contains('pr-reference')?[...anchor.children].find(node=>node.classList.contains('pr-reference-label')):null;
   originals.set(anchor,[...(previous??anchor).childNodes].map(node=>node.cloneNode(true)));
  }
  const authored=anchor.classList.contains('pr-reference-authored')&&originals.get(anchor).some(node=>node.textContent.trim()),label=resolvePRLabel(link,candidates);
  const glyph=anchor.ownerDocument.createElement('span');glyph.className='pr-reference-mark';glyph.setAttribute('aria-hidden','true');
  if(iconsReady())glyph.innerHTML=iconSvg('git-pull-request',{size:16});
  const text=anchor.ownerDocument.createElement('span');text.className='pr-reference-label';
  if(authored)text.append(...originals.get(anchor).map(node=>node.cloneNode(true)));else text.textContent=label;
  anchor.replaceChildren(glyph,text);anchor.classList.add('pr-reference');anchor.dataset.prNumber=String(link.prNumber);anchor.dataset.prHost=link.kind;
  anchor.dataset.sandCopyUrl=href;anchor.setAttribute('role','button');anchor.setAttribute('aria-label',`${authored?text.textContent:label} (${link.kind==='origin'?'Cursor':'GitHub'})`);
 }
}
export function createPRReferenceSurface(host){
 let disposed=false;
 const refresh=()=>{if(!disposed){const state=host.getState(),key=host.getConversationKey(),root=host.app.querySelector('.transcript')??host.app,candidates=collectPRCandidates(state.messages[key]??[]);contexts.set(root,candidates);decoratePRLinks(root,candidates);}};
 if(!iconsReady())void fetchIconData().then(refresh,()=>{});
 return {afterRender:refresh,destroy(){disposed=true;}};
}

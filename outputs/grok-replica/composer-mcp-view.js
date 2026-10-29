import {mcpReferenceServerId} from './composer-mcp-reference.js';
import {iconsReady,iconSvg} from './icon-library.js';

export const mcpStateLabel=state=>({connected:'verbonden',connecting:'verbinden',initializing:'verbinden',disabled:'uitgeschakeld',failed:'fout',error:'fout',disconnected:'verbinding verbroken',authenticationRequired:'authenticatie nodig',needsAuth:'authenticatie nodig',needsGrant:'heeft je goedkeuring nodig',unavailable:'niet beschikbaar'}[state]||'niet verbonden');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
// Local transport adapter: account-scoped native identifiers are unavailable.
// The row identity includes the actual conversation; insertion names its runtime.
export function composerMcpCandidates(inventory){
 if(typeof inventory?.conversationId!=='string'||!Array.isArray(inventory.servers))return [];
 return inventory.servers.filter(server=>object(server?.configuration)&&mcpReferenceServerId('mcp:'+server.id)&&typeof server.name==='string'&&server.name.length>0&&server.name.length<=256&&!/[\r\n\0]/u.test(server.name)).map(server=>{
  const identifier=`${inventory.conversationId}:${server.id}`;
  return {kind:'mcp',key:`tools:mcp:${identifier}`,id:`mcp:${identifier}`,referenceId:'mcp:'+server.id,category:'tools',label:server.name,insertLabel:server.name,keywords:[],icon:'plug',typeLabel:'Plug-in',detail:mcpStateLabel(server.state)};
 });
}
export function mcpGlyph(size=14){return iconsReady()?iconSvg('plug',{size}):'';}
export function populateMcpChip(dom,attrs){
 dom.className='composer-inline-skill composer-inline-mcp';dom.dataset.mcpReference=attrs.id;dom.dataset.type='skill-reference';dom.dataset.id=attrs.id;dom.dataset.label=attrs.label??'';
 dom.contentEditable='false';dom.setAttribute('role','img');dom.title=attrs.label??'';dom.setAttribute('aria-label',attrs.label??'');
 const glyph=dom.ownerDocument.createElement('span');glyph.className='mcp-reference-glyph';glyph.setAttribute('aria-hidden','true');glyph.innerHTML=mcpGlyph();dom.append(glyph,dom.ownerDocument.createTextNode(attrs.label??''));return dom;
}
export function renderMcpReference(attrs,esc){
 const id=mcpReferenceServerId(attrs.id);if(!id)return null;
 return `<button type="button" class="inline-mcp-reference" data-inline-mcp-reference="${esc(id)}" data-action="live-mcp-reference-open" data-id="${esc(id)}" title="${esc(attrs.label??'')}"><span class="mcp-reference-glyph" aria-hidden="true">${mcpGlyph()}</span><span>${esc(attrs.label??'')}</span></button>`;
}

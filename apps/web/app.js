import {createScreenshotChatLayout} from './screenshot-chat-layout.js';
import {createDeviceSurface} from './product-devices.js';
import {createLiveHarnessClient} from './live-harness-client.js';
import {renderAppWithCanvas} from './render-app-canvas.js';
import {mountComposerEditor} from './composer-editor.js';
import {createComposerDraftRetention,withComposerDraft,unsavedComposerWarning} from './composer-draft-retention.js';
import {bindComposerInput,composerText,composerEventInput,readComposerInput,setComposerSnapshot} from './composer-input.js';
import {normalizeComposerDocument} from './composer-document.js';
import {renderComposerDocument} from './composer-document-view.js';
import {createComposerCommands} from './composer-commands.js';
import {createComposerEmojiSurface} from './composer-emoji.js';
import {createCommandPalette} from './command-palette.js';
import {createWorkflowDelivery} from './workflow-delivery.js';
import {prepareRecoveredSendDraft} from './send-draft-recovery.js';
import {retainQueuedDraft} from './live-queued-drafts.js';
import {createLiveHarnessSurface} from './live-harness-surface.js';
import {hasLiveHarnessOwnership,liveHistoryResetMessage} from './live-harness-model.js';
import { createChatStateHost } from './chat-state-host.js';
import { createChatSurface } from './chat-surface.js';
import { createMessageActionsSurface } from './product-message-actions.js';
import { createProductSurfaces } from './product-surfaces.js';
import {createTranscriptCoordinator} from './transcript-coordinator.js';
import {createAgentExchangeSurface} from './product-exchange.js';
import { createPlatformSurface } from './product-platform.js';
import { createSettingsSurface } from './product-settings.js';
import { createRosterSurface } from './product-roster.js';
import { createWorkspaceSurface } from './product-workspace.js';
import { createTranscriptSurface } from './product-transcript.js';
import { brandMark } from './catalogue-logos.js';
import { avatarMarkup, startAvatarMotion } from './avatar-motion.js';
import { openMotionLab } from './motion-lab.js';
import { createMainMotion } from './ui-motion-main.js';
import { fetchIconData, iconsReady, iconSvg, SEMANTIC_ICONS } from './icon-library.js';
import { openIconLab } from './icon-lab.js';
import { createAttachmentStore, attachmentMarkup, attachmentPreview, attachmentPreviewKind, downloadAttachment, attachmentLimitLabel, attachmentSharingLabel } from './attachments.js';
import { renderRichText, normalizeReplyState, renderQuote, takeReplyQuote, renderQuestion, selectQuestion, richAction } from './rich-transcript.js';
import { openConversationExamples } from './conversation-examples.js';
import { normalizeTasks, taskForConversation, tasksForBot, pinnedTasksForBot, taskConversationAgent, setTaskPinned } from './tasks.js';
import { openVersionExamples } from './version-examples.js';
import { normalizeSettingsPreferences, applySettingsPreferences, openLanguagePicker } from './settings-controls.js';
/* Ordinary mode is independently reconstructed. The explicit synthetic reference
 * alone loads the extracted 0.75.5 avatar engine.
 * Local examples stay in browser state. Explicit live mode uses the owned local
 * Grok Bot harness and its dedicated workspace. Source references live in README. */
const $ = (selector, base = document) => base.querySelector(selector);
const $$ = (selector, base = document) => [...base.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const icons = {
 search:'<circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.3 4.3"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
 down:'<path d="m6 9 6 6 6-6"/>',right:'<path d="m9 5 7 7-7 7"/>',left:'<path d="m15 5-7 7 7 7"/>',
 arrow:'<path d="M7 17 17 7M7 7h10v10"/>',more:'<circle cx="5" cy="12" r=".8" fill="currentColor"/><circle cx="12" cy="12" r=".8" fill="currentColor"/><circle cx="19" cy="12" r=".8" fill="currentColor"/>',
 mic:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 10v2a6.5 6.5 0 0 0 13 0v-2M12 18.5V22"/>',
 send:'<path d="M12 20V4m-7 7 7-7 7 7"/>',download:'<path d="M8 18H6a4 4 0 0 1-1-7.8A7 7 0 0 1 19 9a4.5 4.5 0 0 1 0 9h-3M12 10v11m-4-4 4 4 4-4"/>',
 panel:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
 settings:'<path d="m10 3-1 3-3 1-2-1-2 4 2 2v3l-1 2 3 3 2-1 3 1 1 2h4l1-3 3-1 2-3-2-2v-3l1-2-3-3-2 1-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
 computer:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
 file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6"/>',
 copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
 pin:'<path d="m9 3 12 12-5 1-4 4-3-3-5 5m3-9-4-4 4-4z"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
 check:'<path d="m5 12 5 5L20 7"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 shield:'<path d="m12 2 9 4v6c0 5-6 9-9 10-3-1-9-5-9-10V6z"/><path d="m8 12 3 3 5-6"/>',
 logout:'<path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"/>',book:'<path d="M12 5c-4-3-8-2-10-1v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-3-1-6-2-10 1zm0 0v16"/>',
 link:'<path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3m-3 3-3 3a5 5 0 0 1-7-7l3-3m2 6 8-8"/>',
 refresh:'<path d="M20 9a8 8 0 1 0 0 7M20 3v6h-6"/>',folder:'<path d="M3 7V4h6l3 3h9v13H3z"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 6-3 7-3 8h18c0-1-3-2-3-8M9 20h6"/>',
 group:'<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m1-18a3 3 0 0 1 0 6m2 5a6 6 0 0 1 3 5v2"/>',
 edit:'<path d="m14 5 5 5M4 20l4-1L21 6l-5-5L3 14z"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 1 1 5 3c-2 1-2 2-2 3m0 3h.01"/>',
 speaker:'<path d="M11 5 6 9H2v6h4l5 4zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
 pause:'<path d="M8 4v16M16 4v16"/>',play:'<path d="m7 3 14 9-14 9z"/>',key:'<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-5-5 3-3m-7 7 3-3"/>'
};
const icon = name => `<span class="icon" data-icon-semantic="${esc(name)}" aria-hidden="true">${iconsReady()?iconSvg(SEMANTIC_ICONS[name]||'file'):`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.file}</svg>`}</span>`;
const button = (label, name, action, extra='') => `<button class="icon-button" aria-label="${esc(label)}" title="${esc(label)}" data-action="${action}" ${extra}>${icon(name)}</button>`;
const colors = [{name:'Zwart',value:'#000000'},{name:'Bruin',value:'#a57137'},{name:'Rood',value:'#ff293f'},{name:'Oranje',value:'#ff8c1a'},{name:'Geel',value:'#ffcf24'},{name:'Groen',value:'#38b76b'},{name:'Cyaan',value:'#35b6cd'},{name:'Blauw',value:'#1680f3'},{name:'Violet',value:'#9354ff'},{name:'Magenta',value:'#e458b3'},{name:'Grijs',value:'#949494'}];
const initialAgents = [
 {id:'marketing',name:'Marketing Agent',preview:'What should I focus on for you?',color:'#a57137',shape:0},
 {id:'autonomous',name:'Ambitious Autonomous Agent',preview:'De 24u-push is klaar. Preview ...',color:'#ff293f',shape:1},
 {id:'customers',name:'Find Customers',preview:'24u-ronde is om, die heb ik ui...',color:'#9354ff',shape:0},
 {id:'dealfinder',name:'dealfinder',preview:'Azerty, €3899, 1TB, voorraad i...',color:'#ff293f',shape:2}
];
const appData = [
 ['21st.dev','twentyone','Find UI components and themes for your next project.','Code','#0037ff','',true],
 ['Agent Compatibility','compatibility','CLI-backed repo compatibility scanning.','Code','#3f3d3a','☷',true],
 ['Aikido','aikido','Find, prioritize, and fix security risks in your code.','Code','#6c4cf6','▰',true],
 ['Aleph','aleph','Aleph MCP server. Your one source for financial data.','Finance','#fff','A',true],
 ['Algolia Productivity','algolia','Connect LLM tools to your Algolia indexes.','Productiviteit','#0037ff','a',true],
 ['Allo','allo','An AI receptionist that answers your calls.','Communicatie','#ffdd19','☎',true],
 ['1Password','onepassword','Deel een aparte 1Password-kluis met je Bot.','Wachtwoordbeheerders','#2f3035','◉'],
 ['Notion','notion','Search Notion pages and databases, create and update records, and publish content to your workspace.','Productiviteit','#f5f5f5','N'],
 ['Atlassian','atlassian','Atlassian plugin for Cursor with Confluence and Jira.','Productiviteit','#fff','A'],
 ['Google Drive','drive','Search and read files in Google Drive.','Productiviteit','#fff','△'],
 ['Google Calendar','calendar','Manage events, availability, and calendars.','Productiviteit','#1680f3','31'],
 ['Gmail','gmail','Read and search email, organize your inbox.','Communicatie','#fff','M'],
 ['Slack','slack','Search messages and work with your team.','Communicatie','#fff','#'],
 ['Microsoft Teams','teams','Connect with your team and conversations.','Communicatie','#6255b9','T'],
 ['WhatsApp','whatsapp','Read and send WhatsApp messages.','Communicatie','#24cb63','◔'],
 ['Canva','canva','Create and edit designs in Canva.','Ontwerp','#22c0bb','C'],
 ['Figma','figma','Bring design context into your work.','Ontwerp','#252525','F'],
 ['GitHub','github','Access repositories, issues, and pull requests.','Code','#262b32','GH'],
 ['Supabase','supabase','Manage your databases, tables, and projects.','Code','#303236','ϟ'],
 ['Vercel','vercel','Work with projects, builds, and deployments.','Code','#000','▲'],
 ['Linear','linear','Manage issues, projects, and team workflows.','Productiviteit','#5965dc','L'],
 ['Exact Online','exact','Werk met je financiële administratie.','Finance','#009d7f','E'],
 ['Stripe','stripe','Search payments, customers, and invoices.','Finance','#6554f6','S'],
 ['Salesforce','salesforce','Work with accounts, contacts, and opportunities.','Verkoop','#00a1e0','S'],
 ['HubSpot','hubspot','Manage contacts, deals, and your sales pipeline.','Verkoop','#ff7958','H'],
 ['Intercom','intercom','Find customer conversations and support context.','Ondersteuning','#286efa','I'],
 ['Parallel','parallel','Search and research information across the web.','Onderzoek','#000','P'],
 ['Context.dev','contextdev','Connect your work to current context.','Onderzoek','#111','C'],
 ['Ahrefs','ahrefs','Research search performance and backlinks.','Onderzoek','#ff8c1a','a'],
 ['Treg','treg','Find relevant research and information.','Onderzoek','#2766ef','T'],
 ['Semrush','semrush','Research search, competitors, and marketing.','Onderzoek','#ff6727','S'],
 ['Crustdata','crustdata','Research companies and people.','Onderzoek','#cf5123','C'],
 ['Context7','context','Find current library documentation.','Onderzoek','#171717','C'],
 ['SuperMe','superme','Explore relevant knowledge and context.','Onderzoek','#fff','S'],
 ['Harmonic','harmonic','Research companies and market intelligence.','Onderzoek','#ec6338','H'],
 ['UserTesting','usertesting','Find user research and customer insight.','Onderzoek','#2868f7','U'],
 ['You.com','you','Search and research the web.','Onderzoek','#7236ee','Y'],
 ['Adspirer Search Ads','adspirer','Research and manage search advertising.','Onderzoek','#129bf2','A'],
 ['Fullenrich','fullenrich','Research contact and company information.','Onderzoek','#1e3671','F']
].map(([name,id,description,category,bg,mark,recommended=false])=>({name,id,description,category,bg,mark,recommended}));
const initialState = {version:1,drafts:{},draftRichTexts:{},replyDrafts:{},composerSkillReferences:{},attachmentConsumedIds:[],attachmentDraftKeys:{},landingAttachmentKey:'new',tasks:[],agents:initialAgents,selected:null,compact:false,context:false,contextTab:'details',hidden:[],pins:[],sections:[],installed:['gmail','exact','github','supabase','drive','calendar','slack','vercel','linear','canva'],authenticated:['gmail','exact','supabase','drive','calendar','slack','vercel','linear','canva'],theme:'light',language:'Nederlands',accentColor:'bot',spellcheck:true,timezone:'Automatisch',autoUpdates:true,notifications:true,rules:[],messages:{},privateSkills:[],routines:[{id:'daily',name:'Dagelijkse marktscan',schedule:'Elke dag om 09:00',paused:false}],botName:'Grok Bot',botColor:'#000000',botShape:0};
const storageKey=location.hash==='#reference-chat'?'grok-local-replica-reference-v1':'grok-local-replica-v1';
let liveResetBlocked=false;
if(new URLSearchParams(location.search).get('reset')==='1'){try{if(hasLiveHarnessOwnership(JSON.parse(localStorage.getItem(storageKey))))liveResetBlocked=true;else localStorage.removeItem(storageKey);}catch{ /* A storage-denied browser can still display the local demo. */ }}
let state,initialSavedState=null;
try{const saved=JSON.parse(localStorage.getItem(storageKey));initialSavedState=saved?.version===1?saved:null;state=saved?.version===1?{...structuredClone(initialState),...saved}:structuredClone(initialState);}catch{state=structuredClone(initialState);}
let productSurfaces;
let groupMode=false,teamSearchScope=false,activeRoutineId='daily';
state.drafts ||= {};
if(!state.draftRichTexts||typeof state.draftRichTexts!=='object'||Array.isArray(state.draftRichTexts))state.draftRichTexts={};
if(!state.attachmentDraftKeys||typeof state.attachmentDraftKeys!=='object'||Array.isArray(state.attachmentDraftKeys))state.attachmentDraftKeys={};
if(typeof state.landingAttachmentKey!=='string')state.landingAttachmentKey='new';
normalizeReplyState(state);
normalizeSettingsPreferences(state);
// Repair malformed browser-local demo state without trusting saved object shapes.
for(const key of ['agents','hidden','pins','sections','installed','authenticated','rules','privateSkills','routines'])if(!Array.isArray(state[key]))state[key]=structuredClone(initialState[key]);
state.agents=state.agents.filter(agent=>agent&&typeof agent.id==='string'&&typeof agent.name==='string').map(agent=>({...agent,color:/^#[0-9a-f]{6}$/i.test(agent.color)?agent.color:'#000000',shape:Math.max(0,Math.min(12,Math.trunc(Number(agent.shape))||0))}));
if(!state.agents.length)state.agents=structuredClone(initialAgents);
normalizeTasks(state);
if(!state.messages||typeof state.messages!=='object'||Array.isArray(state.messages))state.messages={};
if(!state.drafts||typeof state.drafts!=='object'||Array.isArray(state.drafts))state.drafts={};
for(const [key,value]of Object.entries(state.messages))state.messages[key]=Array.isArray(value)?value.filter(message=>message&&typeof message.id==='string'&&typeof message.text==='string'&&['user','bot'].includes(message.role)):[];
for(const [key,value]of Object.entries(state.drafts))if(typeof value!=='string')delete state.drafts[key];
for(const [key,value]of Object.entries(state.draftRichTexts)){try{normalizeComposerDocument(value,{text:state.drafts[key]||'',references:state.composerSkillReferences?.[key]||[]});}catch{delete state.draftRichTexts[key];}}
state.sections=state.sections.filter(section=>section&&typeof section.id==='string'&&typeof section.name==='string');
state.rules=state.rules.filter(rule=>rule&&typeof rule.name==='string'&&['Eerst vragen','Altijd toestaan','Nooit toestaan'].includes(rule.behavior));
state.routines=state.routines.filter(routine=>routine&&typeof routine.id==='string'&&typeof routine.name==='string'&&typeof routine.schedule==='string');
if(!state.routines.length)state.routines=structuredClone(initialState.routines);
state.privateSkills=state.privateSkills.filter(skill=>skill&&typeof skill.name==='string'&&typeof skill.description==='string');
const validAppIds=new Set(appData.map(app=>app.id));state.installed=state.installed.filter(id=>validAppIds.has(id));state.authenticated=state.authenticated.filter(id=>validAppIds.has(id)&&state.installed.includes(id));
let modal=null,market={page:'browse',category:'Alle',query:'',detail:null,skillsExpanded:false},settingsTab='general',groupRecipients=[],searchText='',feedback='',currentPopover=null,ruleDraft=null,popoverInvoker=null;
const overlay=$('#overlay');
const chatFailures=new Map();
if(liveResetBlocked)chatFailures.set(state.selected||'new',liveHistoryResetMessage);
let taskFailure='',storageFailure=false,attachmentStore,sending=false,attachmentErrors={},previewCleanup=()=>{},dialogVersion=0;
const storageWarning='Opslaan in deze browser is niet beschikbaar. Wijzigingen blijven alleen tot het herladen bewaard.';
let chatSurface,workflowDelivery,liveHarnessSurface,composerEditor,composerEditorKey,unbindComposer=()=>{};
const composerDraftRetention=createComposerDraftRetention();
const chatStateHost=createChatStateHost({getState:()=>state,publishState:candidate=>{state=candidate;},storage:{setItem:(key,bytes)=>localStorage.setItem(key,bytes)},storageKey,initialSavedState,onSaveResult:result=>{
 storageFailure=!result.ok;if(storageFailure)feedback=storageWarning;
 if(result.ok){composerDraftRetention.saved();if(composerEditor)delete composerEditor.element.dataset.composerPersistenceError;composerSaveFeedback('');}
 const warning=$('#settings-storage-feedback');if(warning){warning.hidden=!storageFailure;warning.textContent=storageFailure?storageWarning:'';}
 queueMicrotask(()=>chatSurface?.syncStatuses());
}});
initialSavedState=null;
function persist(){const saved=chatStateHost.persist();applyTheme();return saved;}
function attachmentKey(key=state.selected||'new'){if(key==='new')return state.landingAttachmentKey||'new';const alias=Object.hasOwn(state.attachmentDraftKeys,key)?state.attachmentDraftKeys[key]:null;return typeof alias==='string'?alias:key;}
function refreshAttachments(key){
 if(key!==(state.selected||'new')&&key!==attachmentKey())return;
 render();
}
function initializeAttachments(){
 state.attachmentNamespace=typeof state.attachmentNamespace==='string'?state.attachmentNamespace:crypto.randomUUID();
 const sentIds=Object.values(state.messages).flatMap(messages=>messages.flatMap(message=>(Array.isArray(message.attachments)?message.attachments:[]).map(ref=>ref?.id)));
 state.attachmentConsumedIds=[...new Set([...(Array.isArray(state.attachmentConsumedIds)?state.attachmentConsumedIds:[]),...sentIds].filter(id=>typeof id==='string'))];persist();
 attachmentErrors={};const namespace=state.attachmentNamespace;
 const store=createAttachmentStore({namespace,canPersist:()=>attachmentStore===store&&state.attachmentNamespace===namespace&&persist(),consumedIds:state.attachmentConsumedIds,onChange:key=>{if(attachmentStore===store)refreshAttachments(key);},onError:(message,key)=>{if(attachmentStore===store)attachmentErrors[key]=message;}});
 attachmentStore=store;store.ready.then(()=>{if(attachmentStore===store)refreshAttachments(state.selected||'new');}).catch(()=>{});
}
function draftAttachments(key=state.selected||'new'){const physical=attachmentKey(key);return [...attachmentStore.list(physical),...attachmentStore.failed(physical)];}
function renderAttachmentDraft(key){
 const physical=attachmentKey(key),refs=draftAttachments(key),error=attachmentErrors[key]||attachmentErrors[physical];
 return `${refs.length?`<div class="attachment-list">${attachmentMarkup(refs,{draft:true})}</div>`:''}${refs.length||attachmentStore.busy(attachmentKey(key))?`<p class="attachment-limit small muted">${esc(attachmentStore.busy(attachmentKey(key))?'Bijlagen worden lokaal opgeslagen…':attachmentLimitLabel)}</p>`:''}${error?`<p class="attachment-error small" role="status">${esc(error)}</p>`:''}${attachmentStore.failed(attachmentKey(key)).length?'<button class="text-button small" data-action="attachment-retry">Bijlagen opnieuw opslaan</button>':''}`;
}
async function openAttachment(id){
 const store=attachmentStore,key=state.selected||'new',version=dialogVersion;
 try{
  const record=await store.read(id);
  if(attachmentPreviewKind(record)==='download'){downloadAttachment(record);return;}
  const preview=await attachmentPreview(record);
  if(store!==attachmentStore||key!==(state.selected||'new')||version!==dialogVersion){preview.dispose();return;}
  showDialog('preview-dialog',record.name,`<header class="preview-toolbar">${icon('file')}<strong class="fill">${esc(record.name)}</strong><button class="text-button" data-action="attachment-download" data-id="${esc(id)}">Downloaden</button></header><article class="preview-body attachment-preview">${preview.html}</article>`);
  previewCleanup=preview.dispose;
 }catch(error){if(store===attachmentStore){attachmentErrors[key]=error.message;refreshAttachments(key);}}
}
async function copyToClipboard(text){try{if(!navigator.clipboard?.writeText)return false;await navigator.clipboard.writeText(text);return true;}catch{return false;}}
function applyTheme(){document.documentElement.dataset.theme=state.theme==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):state.theme;applySettingsPreferences(state);}
applyTheme();
initializeAttachments();
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(state.theme==='system')applyTheme();});
const getAgent=id=>state.agents.find(agent=>agent.id===id)||taskConversationAgent(state,id);
const selectedBot=()=>{const task=taskForConversation(state,state.selected);return getAgent(task?.parentBotId||state.selected);};
const mainMotion=createMainMotion({root:$('#app'),getConversationKey:()=>state.selected||'new',onFiles:stageFiles});
window.uiMotionMain=mainMotion;
const productHost={app:$('#app'),overlay,getState:()=>state,getConversationKey:()=>state.selected||'new',
 update:(mutator,{render:shouldRender=true}={})=>{mutator(state);const saved=persist();if(shouldRender)render();return saved;},
 render,persist,showDialog,closeDialog,popover,closePopover,openDocument:id=>productSurfaces.handleAction({action:'open-document',id}),getAgent,selectedBot,avatar:avatarMarkup,icon,esc,mainMotion,
 commit:chatStateHost.commit,publishChatProgress:chatStateHost.publishChatProgress,getChatSaveState:chatStateHost.getChatSaveState,copyText:copyToClipboard,getMessageCopyText:message=>productSurfaces?.renderSlot('messageCopyText',{message}),showChatError:(message,conversationId=state.selected||'new')=>{chatFailures.set(conversationId,message);render();},clearChatError:conversationId=>{chatFailures.delete(conversationId);},
 formDialog,menuItem:(...args)=>menuItem(...args),logo,appData,colors,
 getDialogVersion:()=>dialogVersion,setPreviewCleanup:cleanup=>{previewCleanup();previewCleanup=cleanup||(()=>{});},
 getSettingsTab:()=>settingsTab,getFeedback:()=>feedback,renderSettings,
 readAttachment:id=>attachmentStore.read(id),clearLiveAttachments:snapshot=>attachmentStore.clear(attachmentKey(snapshot.conversationId),snapshot.attachments),stageFiles,draftAttachments,hasPendingAttachments:()=>attachmentStore.busy(attachmentKey()),ensureConversation,sendMessage:()=>sendMessage({bypassProduct:true}),
 prepareSendEnqueue,prepareQueuedDraftRecovery,prepareSendCancel,completeQueuedDraftRecovery,acceptLocalSend,lookupSavedSend,consumeLiveDraft:(snapshot,queueAcceptance)=>chatStateHost.commit(current=>{const retained=queueAcceptance?retainQueuedDraft(current,queueAcceptance):current,consumed=consumeSendDraft(retained,snapshot),pendingSends={...retained.liveHarness?.pendingSends};if(pendingSends[snapshot.conversationId]?.payload?.requestId===snapshot.requestId)delete pendingSends[snapshot.conversationId];return {...consumed,liveHarness:{...consumed.liveHarness,pendingSends}};},{reason:'live-draft-accepted'}),revokeChatConversation:conversationId=>chatSurface?.revokeConversation(conversationId),renderReplyQuote:renderQuote,attachmentMarkup,renderSkillReferences,runComposerAction,onComposerPayloadChange:refreshComposerPayload,
 getMcpReferenceInventory:()=>liveHarnessSurface?.mcpReferenceInventory(),refreshMcpReferences:()=>liveHarnessSurface?.refreshMcpReferences(),renderLiveMessage:message=>renderMessage(message,getAgent(state.selected)),afterSurfaceChange:()=>productSurfaces?.afterRender({reason:'surface-change'})};
productSurfaces=createProductSurfaces(productHost);
const transcriptCoordinator=createTranscriptCoordinator(productHost);
productHost.visibleTranscriptEntries=transcriptCoordinator.entriesFor;
productHost.revealTranscriptEntry=transcriptCoordinator.revealEntry;
productHost.noteTranscriptEntries=transcriptCoordinator.noteEntries;
productHost.onTranscriptContentChanged=transcriptCoordinator.refresh;
productHost.onTranscriptCoverageChange=()=>{transcriptCoordinator.refresh();productSurfaces.afterRender({reason:'transcript-coverage'});};
productHost.isTranscriptCovered=()=>productHost.agentExchange?.isCovered()===true;
productHost.clearReplyForExchange=()=>{if(!state.replyDrafts[state.selected])return true;const result=chatStateHost.commit(current=>{const replyDrafts={...current.replyDrafts};delete replyDrafts[state.selected];return {...current,replyDrafts};},{reason:'agent-exchange-open'});render();return result.ok;};
const agentExchange=createAgentExchangeSurface(productHost);
productHost.agentExchange=agentExchange;
productSurfaces.register(agentExchange);
liveHarnessSurface=createLiveHarnessSurface(productHost);
productSurfaces.register(liveHarnessSurface);
productSurfaces.register(createDeviceSurface(productHost,{client:createLiveHarnessClient(),onPaired:result=>productHost.onCloudDevicePaired(result)}));
productSurfaces.register(createSettingsSurface(productHost));
productSurfaces.register(createRosterSurface(productHost));
productSurfaces.register(createWorkspaceSurface(productHost));
productSurfaces.register(createMessageActionsSurface(productHost));
chatSurface=createChatSurface(productHost);
productSurfaces.register(chatSurface);
productSurfaces.register(createComposerEmojiSurface(productHost));
productSurfaces.register(createComposerCommands(productHost));
const commandPalette=createCommandPalette({...productHost,showSearch,openBot:id=>{closeDialog();state.selected=id;state.context=false;groupRecipients=[];groupMode=false;persist();render();}});
workflowDelivery=createWorkflowDelivery(productHost);
productSurfaces.register(workflowDelivery);
const transcriptSurface=createTranscriptSurface(productHost);
productHost.highlightTranscriptEntry=transcriptSurface.highlightEntry;
productSurfaces.register(transcriptSurface);
productSurfaces.register(createPlatformSurface(productHost));
productSurfaces.register(transcriptCoordinator);
productSurfaces.register(createScreenshotChatLayout(productHost));
window.productSurfaces=productSurfaces;
window.addEventListener('pagehide',()=>productSurfaces.destroy(),{once:true});
window.addEventListener('pagehide',()=>mainMotion.destroy(),{once:true});
function stageFiles(files,key=state.selected||'new'){const store=attachmentStore;delete attachmentErrors[key];return store.add(attachmentKey(key),files).catch(()=>{});}
function groupMembers(ids=groupRecipients){return [...new Set(Array.isArray(ids)?ids:[])].map(getAgent).filter(agent=>agent&&!agent.group);}
function createGroup(targetState=state){
 const participants=groupMembers();
 if(participants.length<2){
  if(!currentPopover?.querySelector('#recipient-results'))recipientMenu($('.recipient-button'));
  const result=$('#recipient-results');
  result.querySelector('.inline-feedback')?.remove();
  result.insertAdjacentHTML('beforeend','<p class="inline-feedback" role="status">Selecteer minstens twee Bots.</p>');
  return null;
 }
 const group={id:crypto.randomUUID(),name:participants.map(agent=>agent.name).join(', '),preview:'Nieuwe groepschat',color:'#1680f3',shape:0,group:true,memberIds:participants.map(agent=>agent.id)};
 targetState.agents.push(group);
 return group;
}
function ensureConversation(){
 const existing=getAgent(state.selected);if(existing)return existing;
 const candidate={...state,agents:[...state.agents],drafts:{...state.drafts},replyDrafts:{...state.replyDrafts},attachmentDraftKeys:{...state.attachmentDraftKeys}},physical=attachmentKey('new');
 const participants=groupMembers();let agent;
 if(groupMode||participants.length>1){agent=createGroup(candidate);if(!agent)return null;}
 else if(participants.length===1)agent=participants[0];
 else{agent={id:crypto.randomUUID(),name:state.botName,preview:'Nieuw gesprek',color:state.botColor,shape:state.botShape};candidate.agents.push(agent);}
 candidate.selected=agent.id;candidate.context=false;
 liveHarnessSurface?.promoteConversation(candidate,agent.id);
 if(Object.hasOwn(candidate.chatPreferences||{},'new')){candidate.chatPreferences={...candidate.chatPreferences,[agent.id]:candidate.chatPreferences.new};delete candidate.chatPreferences.new;}
 if(Object.hasOwn(candidate.composerSkillReferences||{},'new')){candidate.composerSkillReferences={...candidate.composerSkillReferences,[agent.id]:candidate.composerSkillReferences.new};delete candidate.composerSkillReferences.new;}
 if(Object.hasOwn(candidate.draftRichTexts||{},'new')){candidate.draftRichTexts={...candidate.draftRichTexts,[agent.id]:candidate.draftRichTexts.new};delete candidate.draftRichTexts.new;}
 const draft=candidate.drafts.new||'';if(draft)candidate.drafts[agent.id]=draft;delete candidate.drafts.new;
 if(candidate.replyDrafts.new){candidate.replyDrafts[agent.id]=candidate.replyDrafts.new;delete candidate.replyDrafts.new;}
 candidate.attachmentDraftKeys[agent.id]=physical;candidate.landingAttachmentKey='landing-'+crypto.randomUUID();
 if(!chatStateHost.commit(()=>candidate,{reason:'ensure-conversation'}).ok){attachmentErrors.new='Gesprek niet opgeslagen. Je concept, ontvangers en bijlagen blijven behouden.';render();return null;}
 groupRecipients=[];groupMode=false;
 if(chatFailures.has('new')){chatFailures.set(agent.id,chatFailures.get('new'));chatFailures.delete('new');}
 closePopover({restoreFocus:false});render();return agent;
}
function renderRecipients(){return `<div class="recipient-picker"><button class="recipient-button" data-action="recipient-menu" aria-label="Start a chat with..."><span class="recipient-label">Aan:</span>${groupRecipients.length?'':'Start a chat with...'}</button>${groupMembers().map(agent=>`<span class="recipient-chip"><span>${esc(agent.name)}</span>${button('Ontvanger verwijderen: '+agent.name,'close','remove-recipient',`data-id="${esc(agent.id)}"`)}</span>`).join('')}</div>`;}

const avatar=avatarMarkup;
const botIdentity=()=>({name:state.botName,color:state.botColor,shape:state.botShape,photo:state.botPhoto});
function logo(app){return `<span class="app-logo" data-logo="${esc(app.id)}" style="--logo-bg:${esc(app.bg)};--logo-ink:${['notion','aleph','drive','atlassian','slack','wikipedia','teams'].includes(app.id)?'#1c1c1c':'#fff'}" aria-hidden="true">${brandMark(app.id)||esc(app.mark)}</span>`;}
function agentRow(agent,recipient=false){return `<div class="agent-row ${state.selected===agent.id?'active':''}" ${recipient?'':'data-agent-id="'+esc(agent.id)+'"'}><button class="row fill" data-action="${recipient?'recipient-select':'select-agent'}" data-id="${esc(agent.id)}" style="text-align:left;min-width:0;gap:10px" aria-label="${esc(agent.name)}">${avatar(agent)}<span class="fill agent-copy"><span class="agent-name" style="display:block">${esc(agent.name)}</span><span class="agent-preview" style="display:block">${esc(agent.preview)}</span></span></button>${recipient?'':button('Meer opties voor '+agent.name,'more','agent-menu',`data-id="${esc(agent.id)}" class="row-actions"`).replace('class="icon-button"','class="icon-button row-actions"')}</div>`;}
function taskPin(task){const pinned=task.pinnedAtMs!==undefined;return `<button class="icon-button task-pin" aria-label="${esc((pinned?'Taak losmaken: ':'Taak vastmaken: ')+task.name)}" aria-pressed="${pinned}" data-action="pin-task" data-id="${esc(task.conversationId)}">${icon('pin')}</button>`;}
function renderPinnedTasks(agent){return pinnedTasksForBot(state,agent.id).map(task=>`<div class="pinned-task-row ${state.selected===task.conversationId?'active':''}" data-task-id="${esc(task.id)}"><button class="pinned-task-open" aria-label="${esc('Vastgemaakte taak: '+task.name)}" ${state.selected===task.conversationId?'aria-current="page"':''} data-action="open-task" data-id="${esc(task.conversationId)}">${esc(task.name)}</button>${taskPin(task)}</div>`).join('');}
function renderTasks(agent){const tasks=tasksForBot(state,agent.id);if(!tasks.length)return '';return `<section class="task-list" role="region" aria-label="Taken"><div class="task-list-heading"><h2>Taken</h2><span class="small muted">Lokaal voorbeeld</span></div>${tasks.map(task=>`<div class="task-list-row" data-task-id="${esc(task.id)}"><button class="task-open" aria-label="${esc('Taak openen: '+task.name)}" data-action="open-task" data-id="${esc(task.conversationId)}">${esc(task.name)}</button>${taskPin(task)}</div>`).join('')}</section>`;}
function renderTaskHeader(task){const parent=getAgent(task.parentBotId);return `<button class="task-parent" aria-label="${esc('Terug naar Bot: '+parent.name)}" data-action="close-task">${avatar(parent)}<span>${esc(parent.name)}</span></button><span class="task-header-title">${esc(task.name)}</span>${taskPin(task)}`;}
function render(options={}){
 const chatFailure=chatFailures.get(state.selected||'new')||'';
 const motionSnapshot=mainMotion.capture(options);
 productSurfaces?.beforeRender(options);
 const task=taskForConversation(state,state.selected),agent=getAgent(state.selected),messages=agent?productHost.visibleTranscriptEntries(agent.id,state.messages[agent.id]||[]):[],draft=state.drafts[state.selected||'new']||'',hasContent=Boolean(draft.trim()||draftAttachments().length||state.composerSkillReferences?.[state.selected||'new']?.length);
 const visibleAgents=state.agents.filter(item=>!state.hidden.includes(item.id));
 const sorted=[...visibleAgents.filter(item=>state.pins.includes(item.id)),...visibleAgents.filter(item=>!state.pins.includes(item.id))];
 renderAppWithCanvas($('#app'),`<main class="shell ${state.compact?'compact':''}"><aside class="sidebar" aria-label="Bots en gesprekken"><div class="sidebar-top"><div class="traffic-lights" aria-hidden="true"><i></i><i></i><i></i></div><div class="sidebar-tools"><button class="circle-button" aria-label="Zoeken" title="Zoeken" data-action="search">${icon('search')}</button><button class="circle-button" aria-label="Nieuwe chat" title="Nieuwe chat" data-action="new-menu">${icon('plus')}</button></div></div><div class="identity"><button class="identity-avatar" aria-label="Grok Bot aanpassen" data-action="identity-menu">${avatar(botIdentity(),'large')}<span class="star-badge" aria-hidden="true">★</span></button><button class="identity-name" data-action="identity-menu">${esc(state.botName)}</button></div><nav class="roster" aria-label="Gesprekken">${sorted.filter(item=>!item.section||!state.sections.some(section=>section.id===item.section)).map(item=>agentRow(item)+renderPinnedTasks(item)).join('')}${state.sections.map(section=>`<div class="section-label"><button data-action="section-collapse" data-id="${esc(section.id)}" aria-expanded="${!section.collapsed}">${esc(section.name)}</button>${button('Sectie-opties','more','section-menu',`data-id="${esc(section.id)}"`)}</div><div data-section-body data-section-id="${esc(section.id)}" ${section.collapsed?'data-collapsed inert aria-hidden="true"':''}>${sorted.filter(agent=>agent.section===section.id).map(agent=>agentRow(agent)+renderPinnedTasks(agent)).join('')}</div>`).join('')}</nav><div class="sidebar-bottom"><button class="account-button" aria-label="Accountmenu" title="Accountmenu" data-action="account-menu"><span class="avatar photo" aria-hidden="true"></span></button><button class="apps-button" data-action="market">Apps verbinden</button><button class="circle-button download-button" aria-label="Download Grok Bot" title="Download Grok Bot" data-action="download">${icon('download')}</button></div></aside><section class="conversation" aria-label="Gesprek" ${state.context&&agent?'data-info-open':''}><header class="conversation-header"><div class="${agent?'header-identity':'header-recipients'}" ${agent?'data-ui-header-identity':''}>${task?renderTaskHeader(task):agent?`<button class="row header-identity-button" data-action="toggle-context" aria-label="Gespreksdetails">${avatar(agent)}<span class="header-title">${esc(agent.name)}</span>${icon('down')}</button>`:renderRecipients()}</div><div class="header-buttons">${agent?button('Gespreksdetails','panel','toggle-context')+button('Gespreksopties','more','conversation-menu'):''}${button(task?'Taak sluiten':'Chat sluiten','close',task?'close-task':'close-chat')}</div></header><div class="thread-frame"><div class="transcript ${!messages.length?'is-empty':''}" aria-label="Berichten">${agent&&!task?renderTasks(agent):''}${messages.length?messages.map(message=>renderMessage(message,agent)).join(''):''}${productSurfaces?.renderSlot('workflowPendingRows',{agent})||''}</div></div>${state.context&&agent?renderContext(selectedBot()):''}<div class="composer-wrap">${productSurfaces?.renderSlot('liveExecutionSelector',{agent})||''}${productSurfaces?.renderSlot('liveSendError',{agent})||''}${productSurfaces?.renderSlot('liveQueue',{agent})||''}${chatFailure?`<p class="workflow-chat-feedback" role="status">${esc(chatFailure)}</p>`:''}${productSurfaces?.renderSlot('workflowSendNotice',{agent})||''}${productSurfaces?.renderSlot('runStatus',{agent})||''}${productSurfaces?.renderSlot('composerNotice',{agent})||''}${productSurfaces?.renderSlot('composerVoice',{agent})||''}${productSurfaces?.renderSlot('chatComposerNotice',{agent})||''}${renderQuote(state.replyDrafts[state.selected],true)}${productSurfaces?.renderSlot('liveAttachmentDraft',{agent})??renderAttachmentDraft(state.selected||'new')}${productSurfaces?.renderSlot('composerSkillReferences',{agent})||''}<form class="composer" id="composer-form"><button type="button" class="circle-button composer-plus" aria-label="Bijvoegen" title="Bijvoegen" data-action="composer-menu">${icon('plus')}</button><div class="composer-pad-shell" data-ui-composer-padding><div class="composer-editor-host" data-composer-editor-host><div id="message-input" spellcheck="${state.spellcheck}" aria-label="Bericht sturen naar Bot"></div></div></div><button type="button" class="circle-button send-button" aria-label="${hasContent?'Bericht sturen':'Spraakmodus'}" title="${hasContent?'Bericht sturen':'Spraakmodus'}" data-has-payload="${hasContent}" data-action="${hasContent?'send-message':'voice'}">${renderComposerGlyphs()}</button></form></div></section></main>`);
 setComposerSnapshot($('#message-input'),composerDraft());
 mainMotion.restore(motionSnapshot);
 syncComposerEditor();
 const field=$('#message-input');field.dataset.placeholder=state.replyDrafts[state.selected]?'Antwoorden…':`Bericht sturen naar ${agent?.name||'Bot'}`;field.setAttribute('aria-placeholder',field.dataset.placeholder);
 productSurfaces?.afterRender(options);refreshComposerPayload();if(storageFailure||taskFailure){$('#app').insertAdjacentHTML('beforeend',`<div class="storage-feedback" role="status" style="pointer-events:none">${esc(taskFailure||'Opslaan in deze browser is niet beschikbaar. Wijzigingen blijven bewaard tot je herlaadt.')}</div>`);}
}
function composerDraft(key=state.selected||'new'){return {text:state.drafts[key]||'',...(state.draftRichTexts?.[key]!==undefined?{richText:state.draftRichTexts[key]}:{}),references:structuredClone(state.composerSkillReferences?.[key]||[])};}
function composerSaveFeedback(message){
 let status=$('[data-composer-save-status]');
 if(!status&&message){status=document.createElement('p');status.dataset.composerSaveStatus='';status.className='workflow-chat-feedback';status.setAttribute('role','status');$('.composer-wrap')?.append(status);}
 if(status){status.textContent=message;status.hidden=!message;}
}
function acceptComposerDraft(key,snapshot){
 if(key!==(state.selected||'new'))return false;
 try{normalizeComposerDocument(snapshot.richText,{text:snapshot.text,references:snapshot.references});}catch{composerSaveFeedback('Deze invoer kan niet worden opgeslagen. Je vorige concept blijft behouden.');return false;}
 if(!composerDraftRetention.has(key)&&JSON.stringify(composerDraft(key))===JSON.stringify(snapshot))return true;
 const result=chatStateHost.commit(current=>withComposerDraft(current,key,snapshot),{reason:'composer-document'});
 composerSaveFeedback(result.ok?'':composerDraftRetention.has(key)?unsavedComposerWarning:'Opslaan is mislukt. Je vorige concept blijft behouden. Maak ruimte vrij en probeer opnieuw.');
 return result.ok;
}
function retainComposerDraft(key,snapshot){
 if(key!==(state.selected||'new'))return false;
 state=composerDraftRetention.retain(state,key,snapshot);composerSaveFeedback(unsavedComposerWarning);return true;
}
function syncComposerSaveFeedback(key){
 const pending=composerDraftRetention.has(key);
 if(composerEditor){if(pending)composerEditor.element.dataset.composerPersistenceError='';else delete composerEditor.element.dataset.composerPersistenceError;}
 composerSaveFeedback(pending?unsavedComposerWarning:'');
}
function syncComposerEditor(){
 const input=$('#message-input'),key=state.selected||'new',snapshot=composerDraft(key);
 if(input===composerEditor?.element&&composerEditorKey===key){composerEditor.restore(snapshot);syncComposerSaveFeedback(key);return;}
 unbindComposer();composerEditor?.destroy();composerEditor=null;composerEditorKey=key;
 const host=input.parentElement;input.remove();
 try{
  composerEditor=mountComposerEditor(host,{snapshot,onChange:next=>acceptComposerDraft(key,next),onUnsaved:next=>retainComposerDraft(key,next),queueOnShiftEnter:()=>Boolean(liveHarnessSurface?.isLive()),resolveMentionMember:id=>getAgent(id)});
  unbindComposer=bindComposerInput(composerEditor.element,composerEditor);
  composerEditor.element.spellcheck=state.spellcheck;
  syncComposerSaveFeedback(key);
  const stale=$('[data-composer-skill-references]');if(state.draftRichTexts[key]&&stale)stale.hidden=true;
 }catch{
  host.replaceChildren(input);input.textContent=snapshot.text;input.setAttribute('role','textbox');input.setAttribute('aria-readonly','true');input.contentEditable='false';input.dataset.editorUnavailable='';
  const error=document.createElement('p');error.className='workflow-chat-feedback';error.setAttribute('role','status');error.textContent='De editor kon niet veilig worden opgeslagen. Je concept blijft behouden. Probeer opnieuw na herladen.';host.closest('.composer-wrap').append(error);
  $('.send-button').disabled=true;
 }
}
function renderComposerGlyphs(){return `<span data-composer-glyph="mic" aria-hidden="true">${icon('mic')}</span><span data-composer-glyph="send" aria-hidden="true">${icon('send')}</span>`;}
function renderTimestamp(message){const candidate=Number.isFinite(message.createdAt)?new Date(message.createdAt):null,date=candidate&&Number.isFinite(candidate.getTime())?candidate:null;return `<time id="message-time-${encodeURIComponent(message.id)}" data-message-timestamp ${date?`datetime="${date.toISOString()}"`:''}>${date?esc(date.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})):'Lokaal'}</time>`;}
function renderReactions(message){const reactions=Array.isArray(message.reactions)?message.reactions.filter(id=>['useful','agree'].includes(id)):[];return `<div data-reaction-list>${reactions.map(id=>`<button data-action="reaction-toggle" data-id="${esc(message.id)}" data-value="${id}" data-reaction-id="${id}" aria-label="Reactie: ${id==='useful'?'Nuttig':'Eens'}" aria-pressed="true">${id==='useful'?'Nuttig':'Eens'} 1</button>`).join('')}</div>`;}
function renderMessage(message,agent){
 if(message.role==='user')return `<article class="message user" data-message-id="${esc(message.id)}"><div class="bubble">${productSurfaces?.renderSlot('chatEntryPeerReferences',{message})||''}${renderQuote(message.quote)}${renderUserContent(message)}${productSurfaces?.renderSlot('liveMessageAttachments',{message})??attachmentMarkup(message.attachments||[])}</div>${productSurfaces?.renderSlot('messageActions',{message})||''}${renderTimestamp(message)}</article>`;
 return `<article class="message bot" data-message-id="${esc(message.id)}" ${message.transcript?`aria-labelledby="message-author-${encodeURIComponent(message.id)} message-time-${encodeURIComponent(message.id)}"`:''}><div class="sender" id="message-author-${encodeURIComponent(message.id)}">${avatar(agent)}${esc(agent.name)}</div>${productSurfaces?.renderSlot('chatEntryPeerReferences',{message})||''}${productSurfaces?.renderSlot('chatEntryBody',{message,agent})??`<div class="message-body">${message.localExample?'<p class="demo-notice">Lokaal gespreksvoorbeeld · geen modeluitvoering</p>':''}${renderRichText(message.text)}</div>`}${productSurfaces?.renderSlot('chatEntryStatus',{message,agent})||''}${productSurfaces?.renderSlot('transcriptCard',{message,agent})??(message.card?renderCard(message.card,message):'')}${productSurfaces?.renderSlot('messageActions',{message})||''}${renderReactions(message)}${renderTimestamp(message)}</article>`;
}
function renderCard(type,message={}){
 if(type==='question')return renderQuestion(message);
 if(type==='routine'){const routine=state.routines.find(item=>item.id===message.cardRoutineId)||state.routines[0];return `<section class="transcript-card"><div class="row between"><h3>${esc(routine.name)}</h3><span class="status-dot ${routine.paused?'paused':''}"></span></div><p>${esc(routine.schedule)} · Europe/Amsterdam</p><div class="card-actions"><button class="outline-button" data-action="routine-detail" data-id="${esc(routine.id)}">Details bekijken</button><button class="pill" data-action="routine-toggle" data-id="${esc(routine.id)}">${routine.paused?'Hervatten':'Pauzeren'}</button></div></section>`;}
 if(type==='approval'&&message.cardOutcome)return `<section class="transcript-card"><h3>${message.cardOutcome==='approved'?'Lokaal goedgekeurd':'Lokaal afgewezen'}</h3><p>Er is geen externe actie uitgevoerd.</p></section>`;
 if(type==='approval')return `<section class="transcript-card" data-message-id="${esc(message.id)}"><h3>Toestemming nodig</h3><p>Deze lokale voorbeeldactie wacht op je beoordeling. Er wordt niets verstuurd.</p><div class="card-actions"><button class="primary-button" data-action="local-approval" data-value="approved">Goedkeuren</button><button class="outline-button" data-action="local-approval" data-value="rejected">Afwijzen</button></div></section>`;
 if(type==='secret'&&message.secretConfirmed)return '<section class="transcript-card"><h3>Voorbeeld bevestigd</h3><p>De fictieve waarde is gewist en niet opgeslagen.</p></section>';
 if(type==='secret')return `<section class="transcript-card" data-message-id="${esc(message.id)}"><h3>Geheime waarde nodig</h3><p>Voer uitsluitend een fictieve waarde in voor deze lokale demonstratie.</p><label class="sr-only" for="demo-secret-${esc(message.id)}">Fictieve geheime waarde</label><input class="field-input demo-secret" id="demo-secret-${esc(message.id)}" type="password" autocomplete="off" placeholder="Fictieve geheime waarde"><div class="card-actions" style="margin-top:10px"><button class="outline-button" data-action="demo-secret">Lokaal bevestigen</button></div></section>`;
 if(type==='artifact')return `<section class="transcript-card"><div class="row">${icon('file')}<h3>Marktonderzoek.md</h3></div><p>Voorbeeldbestand · versie 1 · alleen lokaal</p><div class="card-actions"><button class="outline-button" data-action="artifact-preview">Openen</button><button class="pill" data-action="artifact-download">Downloaden</button></div></section>`;
 return '';
}
function renderContext(agent){
 if(agent.group)return renderGroupContext(agent);
 if(!['details','library','computer'].includes(state.contextTab))state.contextTab='details';
 const librarySlot=productSurfaces?.renderSlot('libraryPanel',{agent}),computerSlot=productSurfaces?.renderSlot('computerPanel',{agent}),identitySlot=productSurfaces?.renderSlot('contextIdentity',{agent});
 return `<aside class="context-pane" aria-label="Gespreksdetails">${identitySlot||''}<nav class="context-nav" role="tablist" aria-label="Botcontext">${[['details','Details'],['library','Bibliotheek'],['computer','Computer']].map(([id,label])=>`<button role="tab" aria-selected="${state.contextTab===id}" class="context-tab ${state.contextTab===id?'active':''}" data-action="context-tab" data-id="${id}">${label}</button>`).join('')}<span class="fill"></span>${button('Details sluiten','close','toggle-context')}</nav><div class="context-body" role="tabpanel">${state.contextTab==='details'?`${identitySlot?'':`<div class="context-avatar"><button data-action="avatar-picker" data-id="${esc(agent.id)}" aria-label="Bot-avatar wijzigen">${avatar(agent,'large')}</button><h2>${esc(agent.name)}</h2><span class="small muted">Alleen jij</span></div>`}<label class="field-label" for="bot-name">Naam</label><input class="field-input" id="bot-name" data-field="agent-name" value="${esc(agent.name)}"><label class="field-label" for="bot-label">Beschrijving</label><textarea id="bot-label" class="field-input" rows="3" data-field="agent-label" placeholder="Wat moet deze Bot voor je doen?">${esc(agent.description||'')}</textarea><button class="context-link" data-action="market"><span>Apps en vaardigheden</span>${icon('right')}</button><button class="context-link" data-action="routines"><span>Routines</span><span class="muted" data-live-routine-count>${productSurfaces?.renderSlot('liveRoutineCount',{agent})??state.routines.length}</span></button><button class="context-link" data-action="share-bot"><span>Bot delen</span>${icon('arrow')}</button><button class="context-link" data-action="templates"><span>Bot-sjablonen</span>${icon('right')}</button>`:state.contextTab==='library'?(librarySlot??`<div class="empty"><span class="row" style="justify-content:center;margin-bottom:18px">${icon('folder')}</span><p>Pagina’s, bestanden en apps die deze Bot maakt, verschijnen hier</p></div>${(state.messages[agent.id]||[]).some(message=>message.card==='artifact')?`<button class="file-row" data-action="artifact-preview"><span class="file-mark">MD</span><span>Marktonderzoek.md</span></button>`:''}`):(computerSlot??`<div class="screen-preview">${icon('computer')}</div><h3 style="font-size:14px;font-weight:500">De computer slaapt</h3><p class="context-hint">Je Bot maakt de computer wakker wanneer die nodig is.</p><button class="outline-button" data-action="wake-computer">Computer activeren</button><p class="context-hint">Computeracties blijven in deze lokale reconstructie.</p><button class="context-link" data-action="computer-settings"><span>Computerinstellingen</span>${icon('right')}</button>`)}</div></aside>`;}
function renderGroupContext(group){
 if(!['members','library'].includes(state.contextTab))state.contextTab='members';
 const members=groupMembers(group.memberIds);
 return `<aside class="context-pane" aria-label="Gespreksdetails"><nav class="context-nav" role="tablist" aria-label="Groepscontext">${[['members','Leden'],['library','Bibliotheek']].map(([id,label])=>`<button role="tab" aria-selected="${state.contextTab===id}" class="context-tab ${state.contextTab===id?'active':''}" data-action="context-tab" data-id="${id}">${label}</button>`).join('')}<span class="fill"></span>${button('Details sluiten','close','toggle-context')}</nav><div class="context-body" role="tabpanel">${state.contextTab==='members'?`<h2 class="group-members-heading">Leden</h2>${members.length?members.map(member=>`<div class="file-row">${avatar(member)}<span>${esc(member.name)}</span></div>`).join(''):'<p class="context-hint">Geen opgeslagen leden.</p>'}`:`<div class="empty"><span class="row" style="justify-content:center;margin-bottom:18px">${icon('folder')}</span><p>Pagina’s, bestanden en apps uit deze groep verschijnen hier</p></div>${(state.messages[group.id]||[]).some(message=>message.card==='artifact')?`<button class="file-row" data-action="artifact-preview"><span class="file-mark">MD</span><span>Marktonderzoek.md</span></button>`:''}`}</div></aside>`;
}
function closePopover({restoreFocus=true}={}){if(currentPopover){currentPopover.remove();currentPopover=null;const invoker=popoverInvoker;popoverInvoker=null;if(invoker?.isConnected){invoker.setAttribute('aria-expanded','false');if(restoreFocus)invoker.focus({preventScroll:true});}}}
function popover(anchor,content,extra='',{mode='auto'}={}){
 closePopover();const el=document.createElement('div');el.className='popover '+extra;el.setAttribute('popover',mode==='manual'?'manual':'auto');el.innerHTML=content;
 (overlay.open?overlay:$('#popover-root')).append(el);currentPopover=el;popoverInvoker=anchor;el.showPopover();
 const menuRows=[...el.querySelectorAll('[role=menuitem],[role=menuitemradio]')];
 if(menuRows.length&&!el.querySelector('input,textarea,[role=group]')){el.setAttribute('role','menu');el.setAttribute('aria-label',anchor.getAttribute('aria-label')||anchor.textContent.trim()||'Menu');anchor.setAttribute('aria-haspopup','menu');anchor.setAttribute('aria-expanded','true');menuRows.forEach((row,index)=>row.tabIndex=index===0?0:-1);el.addEventListener('keydown',event=>{const rows=menuRows.filter(row=>!row.disabled&&!row.hidden),index=rows.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?rows.length-1:event.key==='ArrowDown'?(index+1+rows.length)%rows.length:event.key==='ArrowUp'?(index-1+rows.length)%rows.length:null;if(next!==null&&rows.length){event.preventDefault();rows.forEach((row,i)=>row.tabIndex=i===next?0:-1);rows[next].focus();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePopover();}else if(event.key==='Tab')closePopover({restoreFocus:false});});menuRows[0]?.focus({preventScroll:true});}
 const rect=anchor.getBoundingClientRect(),bounds=el.getBoundingClientRect();
 let left=Math.min(rect.left,innerWidth-bounds.width-10),top=rect.bottom+6;
 if(top+bounds.height>innerHeight-10)top=Math.max(10,rect.top-bounds.height-6);
 el.style.left=Math.max(10,left)+'px';el.style.top=top+'px';
 el.addEventListener('toggle',event=>{if(event.newState==='closed'&&currentPopover===el){el.remove();currentPopover=null;const invoker=popoverInvoker;popoverInvoker=null;invoker?.setAttribute('aria-expanded','false');}});
 productSurfaces?.afterRender({reason:'popover'});return el;
}
const menuItem=(label,ic,action,extra='',sub='')=>`<button class="menu-row" role="menuitem" data-action="${action}" ${extra}>${ic?icon(ic):''}<span class="fill">${esc(label)}${sub?`<span style="display:block;font-size:11px;color:var(--secondary)">${esc(sub)}</span>`:''}</span></button>`;
function showDialog(kind,label,content){productSurfaces?.beforeDialogChange({kind:modal,nextKind:kind,nextLabel:label,close:false});previewCleanup();previewCleanup=()=>{};dialogVersion++;closePopover();modal=kind;overlay.className=kind;overlay.setAttribute('aria-label',label);overlay.innerHTML=`${button('Sluiten','close','close-modal').replace('class="icon-button"','class="icon-button modal-close"')}${content}`;if(!overlay.open)overlay.showModal();productSurfaces?.afterDialogChange({kind,label});}
function closeDialog(){productSurfaces?.beforeDialogChange({kind:modal,nextKind:null,close:true});previewCleanup();previewCleanup=()=>{};dialogVersion++;closePopover();overlay.close();modal=null;productSurfaces?.afterDialogChange({close:true});feedback='';market.query='';}
overlay.addEventListener('click',event=>{if(event.target===overlay){const rect=overlay.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();}});
overlay.addEventListener('cancel',()=>{productSurfaces?.beforeDialogChange({kind:modal,nextKind:null,close:true});previewCleanup();previewCleanup=()=>{};dialogVersion++;closePopover();modal=null;});
function openMarket(){market={page:'browse',category:'Alle',query:'',detail:null,skillsExpanded:false};feedback='';renderMarket();}
function marketHeader(title='Apps verbinden'){return `<div class="market-top"><h1>${esc(title)}</h1><button class="connected-button" data-action="market-installed" aria-label="${state.installed.length} verbonden"><span class="connected-icons">${['gmail','exact','github','supabase'].map(id=>logo(appData.find(app=>app.id===id))).join('')}</span><span>${state.installed.length} verbonden</span>${icon('right')}</button></div>`;}
function marketSearch(){return `<div class="market-search-row"><div style="position:relative;flex:1;min-width:0"><label class="search-field">${icon('search')}<input role="combobox" aria-expanded="false" aria-controls="catalog-search-results" aria-autocomplete="list" autocomplete="off" id="catalog-search" aria-label="Zoeken in apps en vaardigheden" placeholder="Zoeken in apps en vaardigheden" value="${esc(market.query)}"><button aria-label="Zoekopdracht wissen" data-action="clear-catalog-search" class="${market.query?'':'hidden'}" id="clear-search">${icon('close')}</button></label><div id="catalog-search-results"></div></div><button class="outline-button template-button" data-action="templates">${avatar()}Bot-sjablonen${icon('arrow')}</button></div>`;}
function appRow(app,installedView=false){const installed=state.installed.includes(app.id);return `<article class="app-row" data-app="${esc(app.id)}">${logo(app)}<button class="app-info" data-action="plugin-detail" data-id="${esc(app.id)}" aria-label="${esc(app.name)}"><strong>${esc(app.name)}</strong><p>${installedView&&app.id==='github'?'Kan connector niet laden':esc(app.description)}</p></button><button class="pill app-action" data-action="${installed?'plugin-detail':'plugin-add'}" data-id="${esc(app.id)}" aria-label="${installed?'Beheren':app.id==='onepassword'?'Verbinden':'Toevoegen'} ${esc(app.name)}">${installed?'Beheren':app.id==='onepassword'?'Verbinden':'Toevoegen'}</button></article>`;}
function appSection(name,apps,all=true){return `<section class="market-section"><header class="section-heading"><h2>${esc(name)}</h2>${all?`<button data-action="market-category" data-value="${esc(name)}">Alles bekijken</button>`:''}</header><div class="app-grid">${apps.map(app=>appRow(app)).join('')}</div></section>`;}
function renderMarket(){
 if(market.page==='detail'){renderPluginDetail();return;}
 if(market.page==='installed'){renderInstalled();return;}
 const featured=['Alle','Wachtwoordbeheerders','Productiviteit','Communicatie','Ontwerp','Code'];
 const moreSelected=market.category!=='Alle'&&!featured.includes(market.category);
 const categories=featured.map(name=>`<button class="pill ${market.category===name?'selected':''}" data-action="market-category" data-value="${esc(name)}">${esc(name)}</button>`).join('');
 let sections='';
 if(market.category==='Alle'){sections=appSection('Aanbevolen voor jou',appData.filter(app=>app.recommended)) + ['Wachtwoordbeheerders','Productiviteit','Communicatie','Ontwerp','Code','Onderzoek','Finance','Verkoop','Ondersteuning'].map(name=>appSection(name,appData.filter(app=>app.category===name&&!app.recommended),name!=='Wachtwoordbeheerders')).join('');}
 else sections=appSection(market.category,appData.filter(app=>app.category===market.category),false);
 showDialog('marketplace','Apps verbinden',`<div class="market-scroll">${marketHeader()}${marketSearch()}<nav class="category-filters" aria-label="Appcategorieën">${categories}<button class="pill ${moreSelected?'selected':''}" data-action="market-more">${moreSelected?esc(market.category):'Meer'}${icon('down')}</button></nav><div id="catalog-sections">${sections}</div></div>`);
}
function updateSearch(){
 const input=$('#catalog-search');if(!input)return;
 const results=$('#catalog-search-results'),clear=$('#clear-search');clear.classList.toggle('hidden',!market.query);input.setAttribute('aria-expanded',String(Boolean(market.query)));
 if(!market.query){results.innerHTML='';return;}
 const query=market.query.toLowerCase().trim();const matches=appData.map(app=>({app,score:app.name.toLowerCase().includes(query)?2:app.description.toLowerCase().includes(query)?1:0})).filter(item=>item.score).sort((a,b)=>b.score-a.score).slice(0,8).map(item=>item.app);
 results.innerHTML=`<div class="search-popup" role="listbox" aria-label="Zoekresultaten">${matches.length?matches.map(app=>`<button class="search-option" role="option" aria-selected="false" data-action="plugin-detail" data-id="${esc(app.id)}">${logo(app)}<span class="fill"><strong>${esc(app.name)}</strong><span>${esc(app.description)}</span></span>${icon('right')}</button>`).join(''):`<div class="no-results">Geen resultaten voor &quot;${esc(market.query)}&quot;</div>`}</div>`;
}
function renderInstalled(){
 const apps=appData.filter(app=>state.installed.includes(app.id));
 showDialog('marketplace','Plug-ins en vaardigheden beheren',`<div class="market-scroll"><button class="market-back" data-action="market-back" aria-label="Terug">${icon('left')}Terug</button><div class="market-top"><h1>Plug-ins en vaardigheden beheren</h1><button class="outline-button" data-action="market">Apps toevoegen</button></div><section class="market-section"><header class="section-heading"><h2>Privévaardigheden</h2>${productSurfaces?.renderSlot('installedSkillsControls')||''}<button data-action="skill-new">Toevoegen</button></header>${state.privateSkills.length?state.privateSkills.map(skill=>`<div class="tool-row"><strong>${esc(skill.name)}</strong>${skill.storage==='harness'?`<span class="small muted"> · Versie ${esc(skill.revision)}</span>`:''}<p>${esc(skill.description)}</p></div>`).join(''):'<p class="small muted">Vaardigheden die je zelf toevoegt, zijn alleen voor jou beschikbaar.</p>'}</section><section class="market-section"><header class="section-heading"><h2>Plug-ins</h2><span class="small muted">${apps.length} geïnstalleerd</span></header><div class="app-grid">${apps.map(app=>appRow(app,true)).join('')}</div></section></div>`);
}
const notionSkills=['create-database-row','create-page','create-task','database-query','find','knowledge-capture','meeting-intelligence','research-documentation','search','spec-to-implementation','tasks-build','tasks-explain-diff','tasks-plan','tasks-setup'];
function renderPluginDetail(){
 const app=appData.find(item=>item.id===market.detail);if(!app){market.page='browse';renderMarket();return;}
 const installed=state.installed.includes(app.id),authed=state.authenticated.includes(app.id),isNotion=app.id==='notion';
 const skills=isNotion?notionSkills:['Search '+app.name,'Read details','List resources'];
 const visible=market.skillsExpanded?skills:skills.slice(0,5);
 showDialog('marketplace',app.name,`<div class="market-scroll"><button class="market-back" data-action="market-back" aria-label="Terug">${icon('left')}Terug</button><div class="detail-hero">${logo(app)}<div class="fill"><h1>${esc(app.name)}</h1><p>${esc(app.id==='notion'?'github.com/makenotion/cursor-notion-plugin':app.name+' MCP')}</p></div>${button('Delen','arrow','share-plugin')}<button class="primary-button" data-action="${installed?'plugin-remove':'plugin-add'}" data-id="${esc(app.id)}">${installed?'Verwijderen':'Toevoegen'}</button></div><p class="detail-description">${esc(app.description)}</p>${installed?`<div class="account-state"><span>${app.id==='github'?'Kan connector niet laden':authed?'Verbonden als demo@example.test':'Verbind je account om deze app te gebruiken'}</span><button class="outline-button" data-action="plugin-auth" data-id="${esc(app.id)}">${authed?'Account beheren':app.id==='github'?'Opnieuw proberen':'Verbinden'}</button></div>`:''}<section class="detail-section"><h2>Apps <span class="muted">1</span></h2><div class="account-state">${logo(app)}<span class="fill">${esc(app.name)}</span>${icon('right')}</div></section><section class="detail-section"><h2>Vaardigheden <span class="muted">${skills.length}</span></h2>${visible.map((name,i)=>`<details class="tool-row"><summary><strong>${esc(name)}</strong></summary><p>Deze gereconstrueerde vaardigheid toont de interface en het invoercontract. Er wordt geen externe tool aangeroepen.</p><code class="small mono">${esc(app.id)}_${String(i+1).padStart(2,'0')}</code></details>`).join('')}${skills.length>5&&!market.skillsExpanded?`<button class="pill" data-action="expand-skills">${skills.length-5} meer</button>`:''}</section><section class="detail-section"><h2>Informatie</h2><div class="setting-row"><span>Ontwikkelaar</span><span class="muted">${esc(app.name)}</span></div>${isNotion?'<div class="setting-row"><span>Mogelijkheden</span><span class="muted">1 toepassing · 14 vaardigheden</span></div>':''}<div class="setting-row"><span>Categorie</span><button class="text-button" data-action="market-category" data-value="${esc(app.category)}">${isNotion?'Uitgelicht':esc(app.category)}</button></div>${isNotion?'<div class="setting-row"><span>Website</span><span class="muted">www.notion.so</span></div>':''}<div class="setting-row"><span>Beschikbaarheid</span><span class="muted">${isNotion?'Openbaar':'Lokale demonstratie'}</span></div></section>${feedback?`<p class="inline-feedback" role="status">${esc(feedback)}</p>`:''}</div>`);
}
function renderSettings(tab='general'){
 settingsTab=tab;const tabs=[['general','Algemeen','settings'],['computer','Computer','computer'],['usage','Gebruik en facturering','clock'],['updates','Updates','download']];
 showDialog('settings','Instellingen',`<div class="settings-layout"><nav class="settings-nav" aria-label="Instellingen"><h1>Instellingen</h1>${tabs.map(([id,label,ic])=>`<button class="${id===tab?'active':''}" data-action="settings-tab" data-id="${id}">${icon(ic)}${label}</button>`).join('')}</nav><div class="settings-main">${settingsContent(tab)}</div></div>`);
}
function switchControl(key,label){return `<button class="switch" role="switch" aria-checked="${Boolean(state[key])}" aria-label="${label}" data-action="setting-switch" data-key="${key}"></button>`;}
function settingsContent(tab){
 const surface=productSurfaces?.renderSlot('settingsPanel',{tab});if(surface!==undefined)return surface;
 if(tab==='general')return `<h2>Algemeen</h2><p id="settings-storage-feedback" class="inline-feedback" role="status" ${storageFailure?'':'hidden'}>${storageFailure?storageWarning:''}</p><div class="setting-row"><span>Thema</span><select aria-label="Thema" data-field="theme"><option value="system" ${state.theme==='system'?'selected':''}>Systeem volgen</option><option value="light" ${state.theme==='light'?'selected':''}>Licht</option><option value="dark" ${state.theme==='dark'?'selected':''}>Donker</option></select></div><div class="setting-row"><span>Botkleur</span><button data-action="avatar-picker" data-id="identity" aria-label="Botkleur wijzigen">${avatar(botIdentity())}</button></div><div class="setting-row"><span>Accentkleur</span><select aria-label="Accentkleur" data-field="accent-color"><option value="bot" ${state.accentColor==='bot'?'selected':''}>Botkleur</option><option value="black" ${state.accentColor==='black'?'selected':''}>Zwart</option></select></div><div class="setting-row"><span>Taal</span><button class="setting-language" data-action="language-picker" aria-haspopup="dialog" aria-label="Taal, ${esc(state.language)}"><span data-language-label>${esc(state.language)}</span>${icon('down')}</button></div><div class="setting-row"><span>Spelling controleren tijdens het typen</span>${switchControl('spellcheck','Spelling controleren tijdens het typen')}</div><div class="setting-row"><span>Tijdzone</span><button class="pill" data-action="timezone">${esc(state.timezone)}${icon('down')}</button></div><div class="setting-row"><span>Meldingen<p>Ontvang een melding als je Bot je nodig heeft.</p></span>${switchControl('notifications','Meldingen')}</div><h3 class="setting-group-title">Automatische beoordeling</h3><p class="small muted">Regels bepalen welke acties automatisch mogen worden uitgevoerd. Bij tegenstrijdige regels geldt Eerst vragen.</p>${state.rules.map((rule,i)=>`<div class="rules-row"><div class="row between"><span>${esc(rule.name)}</span><button class="pill" data-action="edit-rule" data-id="${i}">${esc(rule.behavior)}</button></div></div>`).join('')}<button class="outline-button" style="margin-top:12px" data-action="new-rule">Regel toevoegen</button><h3 class="setting-group-title">Weergave</h3><div class="setting-row"><span>Compacte zijbalk</span><button class="switch" role="switch" aria-label="Compacte zijbalk" aria-checked="${state.compact}" data-action="compact"></button></div>`;
 if(tab==='computer')return `<h2>Computer</h2><div class="setting-row"><span>Computer van Bot<p>Persoonlijke computer voor alle Bots.</p></span><span class="small muted">Slaapt</span></div><div class="screen-preview">${icon('computer')}</div><p class="small muted">Deze computerinstellingen zijn lokale voorbeelden. In de modus Echte harness toont Computer de eigen werkmap, terminal en browser op deze Mac.</p><div class="setting-row"><span>Computer bijwerken<p>Je computer gebruikt de nieuwste versie.</p></span><span class="small muted">Bijgewerkt</span></div><div class="setting-row"><span>Update plannen</span><button class="outline-button" data-action="schedule-update">Plannen</button></div><div class="setting-row"><span>Opgeslagen inloggegevens</span><button class="outline-button" data-action="settings-tab" data-id="vault">Kluis openen</button></div><div class="setting-row"><span>Browsercookies<p>Een lokale demonstratie van de importselector.</p></span><button class="outline-button" data-action="cookie-import">Importeren</button></div><div class="setting-row"><span>Computer opnieuw instellen<p>Bekijk eerst welke gegevens worden verwijderd.</p></span><button class="outline-button" data-action="reset-computer">Opnieuw instellen</button></div>${feedback?`<p class="inline-feedback" role="status">${esc(feedback)}</p>`:''}`;
 if(tab==='usage')return `<h2>Gebruik en facturering</h2><div class="row between"><div><strong style="font-size:17px;font-weight:500">Grok Bot</strong><p class="small muted">Voorbeeldperiode: 1–31 oktober 2026</p></div><span class="pill">Pro</span></div><div class="setting-row"><span>Inbegrepen gebruik</span><span>38%</span></div><div class="usage-meter"><span></span></div><p class="small muted">Alle gebruikswaarden zijn vaste lokale voorbeeldgegevens.</p><div class="setting-row"><span>Op aanvraag</span><span>€ 0,00</span></div><div class="setting-row"><span>Tegoed</span><span>€ 20,00</span></div><h3 class="setting-group-title">Per bron</h3><table class="usage-table"><thead><tr><th>Bron</th><th>Gebruik</th></tr></thead><tbody><tr><td>Chats</td><td>€ 6,20</td></tr><tr><td>Routines</td><td>€ 1,10</td></tr><tr><td>Bot-naar-Bot</td><td>€ 0,20</td></tr><tr><td>Groepschats</td><td>€ 0,10</td></tr></tbody></table><p class="small muted">Gebruiksgegevens kunnen tot vijf minuten vertraagd zijn.</p>`;
 if(tab==='vault')return `<h2>Kluis</h2><div class="empty">${icon('key')}<h3>Nog geen opgeslagen inloggegevens</h3><p class="small">Gebruik uitsluitend fictieve gegevens in deze lokale replica.</p><button class="outline-button" data-action="vault-new">Inloggegevens toevoegen</button></div>${state.vault?`<div class="tool-row"><strong>${esc(state.vault.name)}</strong><p>${esc(state.vault.username)}</p><button class="text-button" data-action="vault-delete">Verwijderen</button></div>`:''}`;
 return `<h2>Updates</h2><div class="row" style="gap:16px;margin:24px 0">${avatar(botIdentity(),'large')}<div><strong>Grok Bot</strong><p class="small muted" style="margin:4px 0">Versie 0.71.2 · lokale reconstructie</p><button class="text-button small" data-action="copy-version">Versie kopiëren</button></div></div><div class="setting-row"><span>Updatestatus</span><span class="small muted">Je bent up-to-date</span></div><div class="setting-row"><span>Automatische updates</span>${switchControl('autoUpdates','Automatische updates')}</div><div class="setting-row"><span>Updatekanaal</span><select aria-label="Updatekanaal"><option>Stabiel</option><option>Nightly</option></select></div><button class="outline-button" style="margin-top:24px" data-action="check-updates">Controleren op updates</button>${feedback?`<p class="inline-feedback" role="status">${esc(feedback)}</p>`:''}`;
}
function recipientResults(query=''){
 return state.agents.filter(agent=>(!teamSearchScope||agent.team)&&!state.hidden.includes(agent.id)&&(!groupMode||(!agent.group&&!groupRecipients.includes(agent.id)))&&agent.name.toLowerCase().includes(query.toLowerCase())).map(agent=>teamSearchScope?agentRow(agent,true).replace('data-action="recipient-select"','data-action="product-team-open"'):agentRow(agent,true)).join('')||'<div class="empty">Geen resultaten</div>';
}
function recipientMenu(anchor,group=groupMode,query=''){
 const el=popover(anchor,`${teamSearchScope?`<span class="product-team-scope"><span>Team-Bots</span><button type="button" class="product-team-scope-remove" data-action="team-search-close" aria-label="Team-Bots sluiten" data-source-instance="INSTANCE-035">${icon('close')}</button></span>`:''}<label class="search-field">${icon('search')}<input id="recipient-search" aria-label="Zoek een Bot of persoon" placeholder="Zoek een Bot of persoon" value="${esc(query)}"></label><div id="recipient-results">${recipientResults(query)}</div><div class="menu-divider"></div>${menuItem(group?'Groep maken':'Nieuwe groep','group',group?'commit-group':'new-group')}${menuItem('Nieuwe Bot','plus','new-bot')}${menuItem('Team-Bots','group','team-bots')}${!teamSearchScope?menuItem('Team-Bots zoeken','search','team-search-open'):''}`,'recipient-menu');
 $('#recipient-search',el)?.focus();
}
function avatarPicker(anchor,id){
 const agent=id==='identity'?botIdentity():getAgent(id);if(!agent)return;
 popover(anchor,`<div class="shape-grid" role="group" aria-label="Botvorm">${Array.from({length:13},(_,shape)=>`<button class="shape-button ${agent.shape===shape?'selected':''}" aria-label="Vorm ${shape+1}" aria-pressed="${agent.shape===shape}" data-action="choose-shape" data-id="${esc(id)}" data-value="${shape}">${avatar({...agent,shape},'static')}</button>`).join('')}</div><div class="color-grid" role="group" aria-label="Botkleur">${colors.map(color=>`<button class="color-swatch ${agent.color===color.value?'selected':''}" style="--swatch:${color.value}" aria-label="${color.name}" aria-pressed="${agent.color===color.value}" data-action="choose-color" data-id="${esc(id)}" data-value="${color.value}"></button>`).join('')}</div><button class="outline-button picker-upload" data-action="avatar-photo" data-id="${esc(id)}">${icon('file')}Afbeelding uploaden</button><button class="text-button picker-upload" data-action="avatar-editor" data-id="${esc(id)}">Avatar bewerken</button>`,'avatar-picker');
}
function templates(){showDialog('marketplace','Bot-sjablonen',`<div class="market-scroll"><div class="market-top"><h1>Bot-sjablonen</h1></div><p class="detail-description">Kies een vertrekpunt of maak je eigen Bot.</p><div class="template-grid">${[{name:'Marketing Agent',description:'Een partner voor campagnes, content en onderzoek.',color:'#a57137'},{name:'Onderzoeksassistent',description:'Verken onderwerpen en organiseer je bevindingen.',color:'#9354ff'},{name:'Programmeur',description:'Werk samen aan code en technische vraagstukken.',color:'#1680f3'},{name:'Maak je eigen Bot',description:'Begin met een naam en pas de identiteit aan.',color:'#000'}].map((item,i)=>`<button class="template-card" data-action="create-template" data-id="${i}">${avatar(item)}<h3>${item.name}</h3><p>${item.description}</p></button>`).join('')}</div></div>`);}
function formDialog(title,fields,submit,cancel='close-modal',description=''){showDialog('small-dialog',title,`<form class="form-dialog" id="local-form" data-submit="${submit}"><h1>${esc(title)}</h1>${description?`<p>${esc(description)}</p>`:''}${fields}<div class="form-actions"><button type="button" class="outline-button" data-action="${cancel}">Annuleren</button><button class="primary-button" type="submit">Opslaan</button></div></form>`);}
function showSearch(){showDialog('small-dialog','Zoeken',`<div class="search-dialog"><h1>Zoeken</h1><label class="search-field">${icon('search')}<input id="global-search" aria-label="Zoeken in Bots en gesprekken" placeholder="Zoeken in Bots en gesprekken" autocomplete="off"></label><div class="search-results" id="global-search-results">${state.agents.map(agent=>agentRow(agent,true)).join('')}</div></div>`);$('#global-search').focus();}
function renderUserContent(message){return renderComposerDocument(message,esc,{resolveMentionMember:getAgent,renderMentionAvatar:member=>avatarMarkup(member,'static')})??`${esc(message.text).replace(/\n/g,'<br>')}${renderSkillReferences(message.skillReferences)}`;}
function renderSkillReferences(refs){return Array.isArray(refs)&&refs.length?`<div class="message-skill-references" aria-label="Vaardigheidsreferenties">${refs.filter(ref=>ref&&typeof ref.label==='string').map(ref=>`<span class="message-skill-reference">${esc(ref.label)}${Number.isSafeInteger(ref.revision)&&ref.revision>0?` · Versie ${esc(ref.revision)}`:''}</span>`).join('')}</div>`:'';}
function refreshComposerPayload(){const input=$('#message-input');if(!input)return;input.style.height='20px';input.style.height=Math.min(180,input.scrollHeight)+'px';mainMotion.updateComposer({hasPayload:Boolean(composerText(input).trim()||draftAttachments().length||state.composerSkillReferences?.[state.selected||'new']?.length)});}
function runComposerAction(id){
 if(id==='settings:general'||id==='settings:computer'){renderSettings(id.split(':')[1]);return;}
 if(id==='overlay:plugins'){market.page='browse';market.query='';renderMarket();return;}
 if(id.startsWith('theme:')){state.theme=id.split(':')[1];persist();render();return;}
 if(id==='new-bot'){productSurfaces.handleAction({action:'new-bot'});return;}
 if(id==='new-group-chat'){state.selected=null;state.context=false;teamSearchScope=false;groupMode=true;groupRecipients=[];closePopover();closeDialog();render();recipientMenu($('.recipient-button'),true);}
}
function sendDraftMatches(current,snapshot){
 const key=snapshot.conversationId,physical=typeof current.attachmentDraftKeys?.[key]==='string'?current.attachmentDraftKeys[key]:key;
 const stagedIds=[...attachmentStore.list(physical),...attachmentStore.failed(physical)].map(ref=>ref.id).sort();
 return !attachmentStore.busy(physical)&&JSON.stringify(stagedIds)===JSON.stringify(snapshot.attachments.map(ref=>ref.id).sort())&&(current.drafts[key]||'')===snapshot.text&&current.draftRichTexts?.[key]===snapshot.richText&&JSON.stringify(current.replyDrafts[key])===JSON.stringify(snapshot.quote)&&JSON.stringify(current.composerSkillReferences?.[key]||[])===JSON.stringify(snapshot.skillReferences||[]);
}
function consumeSendDraft(current,snapshot){
 const key=snapshot.conversationId,consumed=[...new Set([...(current.attachmentConsumedIds||[]),...snapshot.attachments.map(ref=>ref.id)])];
 if(!sendDraftMatches(current,snapshot))return {...current,attachmentConsumedIds:consumed};
 const replyDrafts={...current.replyDrafts};delete replyDrafts[key];
 const draftRichTexts={...current.draftRichTexts};delete draftRichTexts[key];
 // The physical alias may still own files added after this immutable snapshot.
 return {...current,drafts:{...current.drafts,[key]:''},draftRichTexts,replyDrafts,composerSkillReferences:{...current.composerSkillReferences,[key]:[]},attachmentConsumedIds:consumed};
}
function prepareSendEnqueue(current,snapshot){
 if(!sendDraftMatches(current,snapshot))throw new Error('Concept gewijzigd');
 // A held browser-offline intent owns its payload durably. Immediate local sends
 // retain the composer until the actual transcript acceptance transaction succeeds.
 const held=navigator.onLine===false||(current.sendJournal?.records||[]).some(record=>record.snapshot.conversationId===snapshot.conversationId);
 return held?consumeSendDraft(current,snapshot):current;
}
const preparedDraftRecoveries=new Map();
function recoveryContext(physical){return {attachments:attachmentStore.list(physical),failed:attachmentStore.failed(physical),busy:attachmentStore.busy(physical)};}
async function prepareQueuedDraftRecovery(snapshot){
 const store=attachmentStore,physical=attachmentKey(snapshot.conversationId);await store.ready;await store.idle();
 if(store!==attachmentStore)throw Error('stale-recovery');
 prepareRecoveredSendDraft(state,snapshot,recoveryContext(physical));
 if(snapshot.attachments.length)await store.prepareRecovery(physical,snapshot.attachments);
 if(store!==attachmentStore||physical!==attachmentKey(snapshot.conversationId))throw Error('stale-recovery');
 preparedDraftRecoveries.set(JSON.stringify(snapshot),{store,physical});
}
function prepareSendCancel(current,snapshot){
 const prepared=preparedDraftRecoveries.get(JSON.stringify(snapshot));
 if(!prepared||prepared.store!==attachmentStore||prepared.physical!==attachmentKey(snapshot.conversationId)||!prepared.store.recoveryReady(prepared.physical,snapshot.attachments))throw Error('stale-recovery');
 return prepareRecoveredSendDraft(current,snapshot,recoveryContext(prepared.physical));
}
function completeQueuedDraftRecovery(snapshot,succeeded){
 const prepared=preparedDraftRecoveries.get(JSON.stringify(snapshot));
 preparedDraftRecoveries.delete(JSON.stringify(snapshot));
 if(succeeded&&snapshot.attachments.length&&prepared?.store===attachmentStore)prepared.store.completeRecovery(prepared.physical,snapshot.attachments);
}
function lookupSavedSend(payload){try{const saved=JSON.parse(localStorage.getItem(storageKey));if(!saved||saved.version!==1||!saved.messages||!Array.isArray(saved.messages[payload.conversationId]))return {status:'not-found'};const rows=saved.messages[payload.conversationId],user=rows.find(row=>row.id===payload.inputEntryId&&row.clientNonce===payload.nonce&&row.role==='user'),notice=rows.find(row=>row.id===payload.noticeEntryId&&row.role==='bot');return {status:user&&notice?'found':'not-found'};}catch{return {status:'unknown'};}}
async function acceptLocalSend(payload){
 const store=attachmentStore,physical=attachmentKey(payload.conversationId);
 if(lookupSavedSend(payload).status==='found')return {accepted:true};
 const result=chatStateHost.commit(current=>{
  if(!getAgent(payload.conversationId))throw new Error('Gesprek ontbreekt');
  const messages=[...(current.messages[payload.conversationId]||[])];
  if(messages.some(message=>message.clientNonce===payload.nonce||message.id===payload.inputEntryId||message.id===payload.noticeEntryId))throw new Error('Ontvangst onduidelijk');
  const text=payload.text.trim(),card=/routine|schedule|dagelijks|plan/i.test(text)?'routine':/toestemming|approval|goedkeur/i.test(text)?'approval':/secret|geheim|api.?key/i.test(text)?'secret':/bestand|artifact|rapport|onderzoek/i.test(text)?'artifact':null;
  messages.push({id:payload.inputEntryId,clientNonce:payload.nonce,role:'user',createdAt:payload.createdAt||Date.now(),text:payload.richText!==undefined?payload.text:text,...(payload.richText!==undefined?{richText:payload.richText}:{}),attachments:payload.attachments,...(payload.quote?{quote:payload.quote}:{}),...(payload.skillReferences?.length?{skillReferences:payload.skillReferences}:{})});
  messages.push({id:payload.noticeEntryId,role:'bot',createdAt:Date.now(),transcript:{schema:1,kind:'notice',revision:0,status:'stable'},text:'Dit is een lokale voorbeeldreactie. Je bericht is in deze browser opgeslagen; er is geen model of externe dienst aangeroepen.',card,cardRoutineId:card==='routine'?current.routines[0]?.id:undefined});
  const consumed=consumeSendDraft(current,payload);
  return {...consumed,messages:{...current.messages,[payload.conversationId]:messages},agents:current.agents.map(agent=>agent.id===payload.conversationId?{...agent,preview:text||payload.attachments.map(ref=>ref.name).join(', ')||payload.skillReferences?.map(ref=>ref.label).join(', ')}:agent)};
 },{reason:'ordinary-send'});
 if(!result.ok){attachmentErrors[payload.conversationId]='Bericht niet opgeslagen. Je concept en bijlagen blijven behouden.';render();return {accepted:false,code:result.error?.code||'storage'};}
 delete attachmentErrors[payload.conversationId];chatFailures.delete(payload.conversationId);
 if(store===attachmentStore&&payload.attachments.length)await store.clear(physical,payload.attachments).catch(()=>{});
 return {accepted:true};
}
async function sendMessage({bypassProduct=false}={}){
 if($('#message-input')?.dataset.editorUnavailable!==undefined)return;
 if(bypassProduct&&liveHarnessSurface?.isLive()){
  chatFailures.set(state.selected||'new','De lokale wachtrij verzendt niet naar de echte harness. Je concept blijft behouden.');render();return;
 }
 if(bypassProduct&&chatSurface?.usesLocalOperation()){
  chatFailures.set(state.selected||'new','Kies eerst Normaal bericht om deze wachtrij te verzenden. Je concept en lokale bewerking blijven behouden.');render();return;
 }
 if(!bypassProduct){const handled=productSurfaces?.handleAction({action:'send-message',target:$('.send-button')});if(handled===true)return;if(handled&&typeof handled.then==='function'&&await handled)return;}
 if(sending)return;
 const input=$('#message-input'),rawText=composerText(input),richText=readComposerInput(input).richText,text=rawText.trim(),key=state.selected||'new',physical=attachmentKey(key),store=attachmentStore;
 sending=true;
 try{
 await store.ready.catch(()=>{});await store.idle();
 if(store!==attachmentStore||key!==(state.selected||'new')||composerText($('#message-input'))!==rawText||readComposerInput($('#message-input')).richText!==richText||store.busy(physical))return;
 if(store.failed(physical).length){attachmentErrors[key]='Sla je bijlagen eerst opnieuw op. Je concept blijft behouden.';refreshAttachments(key);return;}
 const refs=store.list(physical),skillReferences=structuredClone(state.composerSkillReferences?.[key]||[]);if(!text&&!refs.length&&!skillReferences.length)return;
 const agent=ensureConversation();if(!agent)return;
 const snapshot={conversationId:agent.id,text:rawText,...(richText!==undefined?{richText}:{}),createdAt:Date.now(),attachments:refs,skillReferences,...(state.replyDrafts[agent.id]?{quote:structuredClone(state.replyDrafts[agent.id])}:{})};
 const retained=workflowDelivery.journal.records(agent.id).find(record=>record.phase==='failed'&&record.snapshot.text===snapshot.text&&record.snapshot.richText===snapshot.richText&&JSON.stringify(record.snapshot.attachments)===JSON.stringify(snapshot.attachments)&&JSON.stringify(record.snapshot.quote)===JSON.stringify(snapshot.quote)&&JSON.stringify(record.snapshot.skillReferences||[])===JSON.stringify(snapshot.skillReferences||[]));
 if(retained){await workflowDelivery.journal.retry(retained.nonce);render({explicitSend:true});return;}
 const result=workflowDelivery.enqueue(snapshot);
 if(!result.ok){attachmentErrors[agent.id]='Bericht niet opgeslagen. Je concept en bijlagen blijven behouden.';render();return;}
 const consumedRefs=refs.filter(ref=>state.attachmentConsumedIds.includes(ref.id));
 if(consumedRefs.length)await store.clear(physical,consumedRefs).catch(()=>{});
 render({explicitSend:true});await workflowDelivery.drain();
 }finally{sending=false;}
}
function routines(){showDialog('small-dialog','Routines',`<div class="form-dialog"><h1>Routines</h1>${state.routines.map(routine=>`<div class="tool-row"><div class="row between"><strong>${esc(routine.name)}</strong><span class="status-dot ${routine.paused?'paused':''}"></span></div><p>${esc(routine.schedule)}</p><button class="text-button" data-action="routine-detail" data-id="${esc(routine.id)}">Details bekijken</button></div>`).join('')}<button class="outline-button" data-action="routine-new">Routine toevoegen</button></div>`);}
function routineDetail(id=activeRoutineId){activeRoutineId=id;const routine=state.routines.find(item=>item.id===id)||state.routines[0];showDialog('small-dialog',routine.name,`<div class="form-dialog"><h1>${esc(routine.name)}</h1><div class="setting-row"><span>Status</span><span>${routine.paused?'Gepauzeerd':'Actief'}</span></div><div class="setting-row"><span>Planning</span><span>${esc(routine.schedule)}</span></div><div class="setting-row"><span>Tijdzone</span><span>Europe/Amsterdam</span></div><h3 class="setting-group-title">Geschiedenis</h3><p class="small muted">Er zijn geen echte uitvoeringen. Dit is een lokaal voorbeeld.</p><div class="form-actions"><button class="outline-button" data-action="routine-toggle" data-id="${esc(routine.id)}">${routine.paused?'Hervatten':'Pauzeren'}</button><button class="primary-button" data-action="routine-test">Lokaal testen</button></div>${feedback?`<p class="inline-feedback" role="status">${esc(feedback)}</p>`:''}</div>`);}
function artifactPreview(){showDialog('preview-dialog','Marktonderzoek.md',`<header class="preview-toolbar">${icon('file')}<strong class="fill">Marktonderzoek.md</strong><span class="small muted">Versie 1</span><button class="text-button" data-action="artifact-download">Downloaden</button></header><article class="preview-body"><h1>Marktonderzoek</h1><p class="muted">Lokaal voorbeeldbestand, gemaakt om de preview en versiehiërarchie te reconstrueren.</p><h2>Bronnen en bevindingen</h2><table><thead><tr><th>Onderdeel</th><th>Status</th><th>Herkomst</th></tr></thead><tbody><tr><td>Interface</td><td>Gereconstrueerd</td><td>Screenshots en statische bronanalyse</td></tr><tr><td>Uitvoering</td><td>Lokaal voorbeeld</td><td>Browseropslag</td></tr></tbody></table><h2>Volgende stappen</h2><p>Open de bibliotheek om het bestand terug te vinden. Externe verbindingen zijn niet actief.</p></article>`);}
function downloadText(name,text){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// One delegated event surface keeps every rendered branch reachable and deterministic.
document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-action]');if(!target)return;
 const action=target.dataset.action,id=target.dataset.id,value=target.dataset.value;
 const handled=productSurfaces?.handleAction({action,id,value,target,event});
 if(handled===true){event.productHandled=true;return;}
 if(handled&&typeof handled.then==='function'){event.productHandled=true;if(await handled)return;event.productHandled=false;}
 switch(action){
 case 'copy-code':case 'reply-message':case 'remove-reply':case 'confirm-question':case 'skip-question':await richAction(action,target,state,persist,render,copyToClipboard);break;
 case 'version-examples':openVersionExamples(state);groupMode=false;groupRecipients=[];taskFailure='';persist();closeDialog();render();break;
 case 'open-task':{const task=taskForConversation(state,id);if(!task)break;state.selected=task.conversationId;state.context=false;groupMode=false;groupRecipients=[];persist();closePopover();render();break;}
 case 'close-task':{const task=taskForConversation(state,state.selected);if(task){state.selected=task.parentBotId;state.context=false;persist();render();}break;}
 case 'pin-task':{const task=taskForConversation(state,id);if(!task)break;taskFailure=setTaskPinned(state,id,task.pinnedAtMs===undefined,persist)?'':'Taakwijziging kon niet worden opgeslagen.';closePopover();render();break;}
 case 'conversation-examples':openConversationExamples(state);groupMode=false;groupRecipients=[];persist();closeDialog();render();break;
 case 'close-modal':closeDialog();break;
 case 'market':openMarket();break;
 case 'market-installed':market.page='installed';market.query='';renderInstalled();break;
 case 'market-back':market.page='browse';market.detail=null;market.query='';feedback='';renderMarket();break;
 case 'market-category':market.page='browse';market.category=value==='Aanbevolen voor jou'?'Alle':value;market.query='';closePopover();renderMarket();break;
 case 'market-more':popover(target,['Data','Verkoop','Finance','Onderzoek','Ondersteuning'].map(name=>menuItem(name,null,'market-category',`data-value="${name}"`)).join(''));break;
 case 'clear-catalog-search':market.query='';$('#catalog-search').value='';updateSearch();$('#catalog-search').focus();break;
 case 'plugin-detail':closePopover();market.page='detail';market.detail=id;market.query='';market.skillsExpanded=false;feedback='';renderPluginDetail();break;
 case 'plugin-add':if(!state.installed.includes(id))state.installed.push(id);persist();market.page='detail';market.detail=id;feedback='Plug-in lokaal toegevoegd. Verbind een voorbeeldaccount om de andere toestanden te bekijken.';renderPluginDetail();break;
 case 'plugin-remove':state.installed=state.installed.filter(app=>app!==id);state.authenticated=state.authenticated.filter(app=>app!==id);persist();feedback='De plug-in is uit deze lokale browser verwijderd.';renderPluginDetail();break;
 case 'plugin-auth':if(id==='github'){feedback='Kan connector niet laden. Deze lokale reconstructie heeft geen GitHub-verbinding.';}else if(state.authenticated.includes(id)){state.authenticated=state.authenticated.filter(app=>app!==id);feedback='Het lokale voorbeeldaccount is losgekoppeld.';}else{state.authenticated.push(id);feedback='Lokaal voorbeeldaccount verbonden. Er is geen OAuth-verzoek verstuurd.';}persist();renderPluginDetail();break;
 case 'expand-skills':market.skillsExpanded=true;renderPluginDetail();break;
 case 'share-plugin':popover(target,menuItem('Link kopiëren','copy','copy-plugin-link'));break;
 case 'copy-plugin-link':feedback=await copyToClipboard(location.origin+'/?plugin='+market.detail)?'Lokale link gekopieerd.':'Kopiëren is niet beschikbaar. De lokale link staat in de adresbalk bij het openen van een plug-inlink.';closePopover();renderPluginDetail();break;
 case 'templates':templates();break;
 case 'create-template':{const names=['Marketing Agent','Onderzoeksassistent','Programmeur','Nieuwe Bot'];closeDialog();formDialog('Nieuwe Bot',`<label class="field-label" for="new-bot-name">Naam</label><input class="field-input" id="new-bot-name" name="name" required value="${names[Number(id)]||'Nieuwe Bot'}"><label class="field-label" for="new-bot-description">Instructies</label><textarea class="field-input" id="new-bot-description" name="description" rows="4" placeholder="Waar helpt deze Bot je mee?"></textarea>`,'new-bot');break;}
 case 'select-agent':case 'recipient-select':if(groupMode&&action==='recipient-select'){const query=$('#recipient-search')?.value||'';if(getAgent(id)&&!getAgent(id).group&&!groupRecipients.includes(id))groupRecipients.push(id);closePopover();render();recipientMenu($('.recipient-button'),true,query);}else{state.selected=id;state.context=false;groupRecipients=[];groupMode=false;closeDialog();closePopover();persist();render();}break;
 case 'close-chat':state.selected=null;state.context=false;groupRecipients=[];groupMode=false;persist();render();break;
 case 'toggle-context':mainMotion.prepare('info-toggle');state.context=!state.context;persist();render();break;
 case 'context-tab':state.contextTab=id;persist();render();break;
 case 'new-menu':popover(target,menuItem('Nieuwe chat','plus','new-chat')+menuItem('Nieuwe groep','group','new-group')+menuItem('Nieuwe Bot','plus','new-bot')+menuItem('Team-Bots','group','team-bots')+'<div class="menu-divider"></div>'+menuItem('Nieuwe sectie','folder','new-section'));break;
 case 'new-chat':state.selected=null;state.context=false;groupRecipients=[];groupMode=false;teamSearchScope=false;closePopover();persist();render();recipientMenu($('.recipient-button'));break;
 case 'recipient-menu':recipientMenu(target);break;
 case 'team-search-open':teamSearchScope=true;closePopover();recipientMenu($('.recipient-button'),groupMode);break;
 case 'team-search-close':teamSearchScope=false;closePopover();recipientMenu($('.recipient-button'),groupMode);break;
 case 'remove-recipient':{const chooserOpen=Boolean(currentPopover?.querySelector('#recipient-search')),query=$('#recipient-search')?.value||'';groupRecipients=groupRecipients.filter(recipient=>recipient!==id);closePopover();render();if(chooserOpen)recipientMenu($('.recipient-button'),groupMode,query);else $('.recipient-button')?.focus();break;}
 case 'new-group':state.selected=null;state.context=false;teamSearchScope=false;groupMode=true;groupRecipients=[];closePopover();closeDialog();render();recipientMenu($('.recipient-button'),true);break;
 case 'commit-group':{const group=createGroup();if(!group)break;state.selected=group.id;groupRecipients=[];groupMode=false;persist();closePopover();render();break;}
 case 'new-bot':closePopover();formDialog('Nieuwe Bot','<label class="field-label" for="new-bot-name">Naam</label><input class="field-input" id="new-bot-name" name="name" required placeholder="Geef je Bot een naam"><label class="field-label" for="new-bot-description">Instructies</label><textarea class="field-input" id="new-bot-description" name="description" rows="4" placeholder="Wat moet je Bot weten?"></textarea>','new-bot');break;
 case 'team-bots':showDialog('small-dialog','Team-Bots',`<div class="form-dialog"><h1>Team-Bots</h1><label class="search-field">${icon('search')}<input aria-label="Team-Bots zoeken" placeholder="Zoeken in Team-Bots"></label><div class="empty"><h3>Geen Team-Bots beschikbaar</h3><p>Gedeelde Bots van je team verschijnen hier.</p></div></div>`);break;
 case 'agent-menu':{const agent=getAgent(id);popover(target,menuItem(state.pins.includes(id)?'Losmaken':'Vastmaken','pin','pin-agent',`data-id="${esc(id)}"`)+menuItem('Naam wijzigen','edit','rename-agent',`data-id="${esc(id)}"`)+menuItem('Avatar wijzigen','edit','avatar-picker',`data-id="${esc(id)}"`)+menuItem('Verplaatsen naar sectie','folder','move-section',`data-id="${esc(id)}"`)+menuItem('Een kopie maken','copy','copy-agent',`data-id="${esc(id)}"`)+`<div class="menu-divider"></div>`+menuItem('Verbergen','trash','hide-agent',`data-id="${esc(id)}"`));break;}
 case 'pin-agent':state.pins=state.pins.includes(id)?state.pins.filter(item=>item!==id):[...state.pins,id];persist();closePopover();render();break;
 case 'hide-agent':state.hidden.push(id);if(state.selected===id)state.selected=null;persist();closePopover();render();break;
 case 'rename-agent':closePopover();formDialog('Naam wijzigen',`<label class="field-label" for="rename-name">Naam</label><input class="field-input" id="rename-name" name="name" required value="${esc(getAgent(id)?.name)}"><input type="hidden" name="id" value="${esc(id)}">`,'rename-agent');break;
 case 'copy-agent':{const original=getAgent(id);state.agents.push({...original,id:crypto.randomUUID(),name:original.name+' (kopie)',preview:'Nieuwe kopie'});persist();closePopover();render();break;}
 case 'move-section':popover(target,state.sections.length?state.sections.map(section=>menuItem(section.name,'folder','assign-section',`data-id="${esc(id)}" data-value="${esc(section.id)}"`)).join(''):menuItem('Nieuwe sectie','plus','new-section'));break;
 case 'assign-section':getAgent(id).section=value;persist();closePopover();render();break;
 case 'new-section':formDialog('Nieuwe sectie','<label class="field-label" for="section-name">Naam</label><input class="field-input" id="section-name" name="name" required placeholder="Sectienaam">','new-section');break;
 case 'section-collapse':{mainMotion.prepare('section-toggle',{sectionId:id});const section=state.sections.find(item=>item.id===id);section.collapsed=!section.collapsed;persist();render();break;}
 case 'section-menu':popover(target,menuItem('Naam wijzigen','edit','rename-section',`data-id="${esc(id)}"`)+menuItem('Sectie verwijderen','trash','delete-section',`data-id="${esc(id)}"`));break;
 case 'rename-section':{const section=state.sections.find(item=>item.id===id);formDialog('Sectie hernoemen',`<input type="hidden" name="id" value="${esc(id)}"><label class="field-label" for="section-name">Naam</label><input class="field-input" id="section-name" name="name" required value="${esc(section?.name)}">`,'rename-section');break;}
 case 'delete-section':state.sections=state.sections.filter(item=>item.id!==id);state.agents.forEach(agent=>{if(agent.section===id)delete agent.section;});persist();closePopover();render();break;
 case 'identity-menu':popover(target,menuItem('Avatar wijzigen','edit','avatar-picker','data-id="identity"')+menuItem('Naam wijzigen','edit','rename-identity')+menuItem('Bot-sjablonen','book','templates'));break;
 case 'rename-identity':formDialog('Naam wijzigen',`<label class="field-label" for="identity-name">Naam</label><input class="field-input" id="identity-name" name="name" required value="${esc(state.botName)}">`,'rename-identity');break;
 case 'avatar-picker':avatarPicker(target,id);break;
 case 'choose-shape':case 'choose-color':{const agent=id==='identity'?null:getAgent(id);if(id==='identity'){if(action==='choose-shape')state.botShape=Number(value);else state.botColor=value;}else if(agent){if(action==='choose-shape')agent.shape=Number(value);else agent.color=value;}persist();render();if(modal==='settings')renderSettings(settingsTab);else closePopover();break;}
 case 'avatar-photo':closePopover();formDialog('Afbeelding uploaden','<label class="field-label" for="avatar-file">Afbeelding</label><input id="avatar-file" name="photo" type="file" accept="image/*" required><p class="small muted">De afbeelding blijft in deze browser. Gebruik een eigen foto.</p><input type="hidden" name="id" value="'+esc(id)+'">','avatar-upload');break;
 case 'account-menu':popover(target,`<div class="menu-heading">Robin · lokaal voorbeeld</div>${menuItem('Instellingen','settings','settings')}${menuItem('Apparaten','panel','devices-open')}${menuItem('Apps en vaardigheden beheren','link','market-installed')}${menuItem('Verborgen Bots','folder','hidden-agents')}${menuItem(state.compact?'Zijbalk uitvouwen':'Zijbalk inklappen','panel','compact')}<div class="menu-divider"></div>${menuItem('Profielfoto wijzigen','edit','product-profile-photo')}${menuItem('Introductie','book','intro')}${menuItem('Help en feedback','help','help')}${menuItem('Over Grok Bot','help','about')}`);break;
 case 'hidden-agents':showDialog('small-dialog','Verborgen Bots',`<div class="form-dialog"><h1>Verborgen Bots</h1>${state.hidden.length?state.hidden.map(hidden=>`<div class="setting-row"><span>${esc(getAgent(hidden)?.name)}</span><button class="pill" data-action="restore-agent" data-id="${esc(hidden)}">Herstellen</button></div>`).join(''):'<p>Geen verborgen Bots.</p>'}</div>`);break;
 case 'restore-agent':state.hidden=state.hidden.filter(item=>item!==id);persist();render();closeDialog();break;
 case 'compact':state.compact=!state.compact;persist();closePopover();render();if(modal==='settings')renderSettings(settingsTab);break;
 case 'settings':renderSettings();break;
 case 'language-picker':openLanguagePicker(target,state,persist,icon);break;
 case 'computer-settings':renderSettings('computer');break;
 case 'settings-tab':feedback='';renderSettings(id);break;
 case 'setting-switch':state[target.dataset.key]=!state[target.dataset.key];persist();renderSettings(settingsTab);break;
 case 'timezone':{const zones=['Automatisch','Africa/Abidjan','Africa/Accra','Africa/Addis_Ababa','America/Los_Angeles','America/New_York','Asia/Dubai','Asia/Tokyo','Europe/Amsterdam','Europe/Berlin','Europe/London','Europe/Paris'];popover(target,`<label class="search-field">${icon('search')}<input id="timezone-search" aria-label="Tijdzone zoeken" placeholder="Zoeken"></label><div id="timezone-results">${zones.map(zone=>menuItem(zone,null,'choose-timezone',`data-value="${zone}"`)).join('')}</div>`);$('#timezone-search').focus();break;}
 case 'choose-timezone':state.timezone=value;persist();closePopover();renderSettings('general');break;
 case 'new-rule':case 'edit-rule':ruleDraft=action==='edit-rule'?Number(id):null;formDialog(ruleDraft===null?'Regel toevoegen':'Regel bewerken',`<label class="field-label" for="rule-name">Actie</label><input class="field-input" id="rule-name" name="name" required placeholder="Beschrijf de actie" value="${esc(ruleDraft===null?'':state.rules[ruleDraft].name)}"><label class="field-label" for="rule-behavior">Gedrag</label><select class="field-input" id="rule-behavior" name="behavior">${['Eerst vragen','Altijd toestaan','Nooit toestaan'].map(behavior=>`<option ${ruleDraft!==null&&state.rules[ruleDraft].behavior===behavior?'selected':''}>${behavior}</option>`).join('')}</select>`,'save-rule','settings','Eerst vragen heeft voorrang bij tegenstrijdige regels.');break;
 case 'check-updates':feedback='Je bent up-to-date. Dit is de vaste lokale voorbeeldstatus.';renderSettings('updates');break;
 case 'copy-version':feedback=await copyToClipboard('Grok Bot 0.71.2 · lokale reconstructie')?'Versie gekopieerd.':'Kopiëren is niet beschikbaar in deze browser.';renderSettings('updates');break;
 case 'schedule-update':formDialog('Update plannen','<label class="field-label" for="update-time">Datum en tijd</label><input class="field-input" id="update-time" name="time" type="datetime-local" required>','schedule-update','computer-settings','Je Bot onderbreekt lopend werk in deze voorbeeldstatus niet.');break;
 case 'cookie-import':formDialog('Browsercookies importeren',`<p>Alleen lokale voorbeeldsites. Er worden geen echte browsercookies gelezen.</p><label class="search-field">${icon('search')}<input name="search" aria-label="Sites zoeken" placeholder="Sites zoeken"></label>${['example.test','docs.example.test','app.example.test'].map(site=>`<label class="check-label"><input type="checkbox" name="sites" value="${site}">${site}</label>`).join('')}`,'cookie-import','computer-settings');break;
 case 'reset-computer':formDialog('Computer opnieuw instellen','<p>Een echte reset verwijdert geïnstalleerde pakketten en niet gesynchroniseerd werk. In deze replica wordt uitsluitend een lokale voorbeeldstatus gewijzigd.</p><label class="check-label"><input type="checkbox" required name="confirmed">Ik begrijp de voorbeeldactie</label>','reset-computer','computer-settings');break;
 case 'vault-new':formDialog('Inloggegevens toevoegen','<p>Gebruik fictieve gegevens. Dit is geen beveiligde wachtwoordkluis.</p><label class="field-label" for="vault-name">Naam</label><input id="vault-name" class="field-input" name="name" required><label class="field-label" for="vault-user">Gebruikersnaam</label><input id="vault-user" class="field-input" name="username" required><label class="field-label" for="vault-password">Fictief wachtwoord</label><input id="vault-password" class="field-input" type="password" name="password" autocomplete="off" required>','vault-new','settings');break;
 case 'vault-delete':delete state.vault;persist();renderSettings('vault');break;
 case 'skill-new':formDialog('Privévaardigheid toevoegen','<label class="field-label" for="skill-name">Naam</label><input class="field-input" id="skill-name" name="name" required><label class="field-label" for="skill-description">Instructies</label><textarea class="field-input" id="skill-description" name="description" rows="5" required></textarea>','skill-new');break;
 case 'conversation-menu':if(taskForConversation(state,state.selected)){popover(target,menuItem('Berichten exporteren','download','export-chat')+'<div class="menu-divider"></div>'+menuItem('Gesprek wissen','trash','clear-chat'));break;}popover(target,menuItem('Bot delen','arrow','share-bot')+menuItem('Naam wijzigen','edit','rename-agent',`data-id="${esc(state.selected)}"`)+menuItem('Routines','clock','routines')+menuItem('Zoeken in gesprek','search','product-find')+menuItem('Gespreksinhoud','book','product-outline')+menuItem('Berichten exporteren','download','export-chat')+'<div class="menu-divider"></div>'+menuItem('Gesprek wissen','trash','clear-chat'));break;
 case 'share-bot':popover(target,menuItem('Een kopie maken','copy','share-template','','Een sjabloonlink delen'));break;
 case 'share-template':formDialog('Een sjabloonlink delen','<p>Deze link verwijst naar de lokale reconstructie en deelt geen gesprek of externe gegevens.</p><label class="field-label" for="share-link">Lokale link</label><input id="share-link" class="field-input" value="'+esc(location.origin+'/?template='+(selectedBot()?.id||state.selected))+'" readonly>','share-template');break;
 case 'clear-chat':if(!workflowDelivery.clearConversation(state.selected))break;chatFailures.delete(state.selected);closePopover();render();break;
 case 'export-chat':downloadText('gesprek.txt',(state.messages[state.selected]||[]).map(message=>message.role+': '+message.text).join('\n\n'));closePopover();break;
 case 'reaction-menu':popover(target,menuItem('Nuttig',null,'reaction-toggle',`data-id="${esc(id)}" data-value="useful"`)+menuItem('Eens',null,'reaction-toggle',`data-id="${esc(id)}" data-value="agree"`));break;
 case 'reaction-toggle':{const message=(state.messages[state.selected]||[]).find(item=>item.id===id);if(!message||!['useful','agree'].includes(value))break;mainMotion.prepare('reaction',{messageId:id});const reactions=Array.isArray(message.reactions)?message.reactions:[];message.reactions=reactions.includes(value)?reactions.filter(item=>item!==value):[...reactions,value];persist();closePopover();render();break;}
 case 'composer-menu':popover(target,menuItem('Bestanden bijvoegen','file','attach-files','',attachmentSharingLabel(liveHarnessSurface?.isLive()))+menuItem('Een taak aanleren','book','teach-task')+menuItem('App koppelen','link','connect-app-chat')+menuItem('Lokale taak','computer','product-task-new')+menuItem('Spraakmemo','mic','product-voice-new')+menuItem('E-mailconcept','edit','product-draft-new')+menuItem('Lokale wachtrij','clock','product-queue-settings')+(productSurfaces?.renderSlot('composerMenu',{})||''));break;
 case 'attach-files':closePopover();$('#attachment-input').click();break;
 case 'remove-attachment':await attachmentStore.remove(attachmentKey(),id).catch(()=>{});break;
 case 'attachment-open':await openAttachment(id);break;
 case 'attachment-download':try{downloadAttachment(await attachmentStore.read(id));}catch(error){feedback=error.message;}break;
 case 'attachment-retry':{const key=state.selected||'new',store=attachmentStore;await store.retry(attachmentKey(key)).then(()=>{if(store===attachmentStore){delete attachmentErrors[key];refreshAttachments(key);}}).catch(()=>{});break;}
 case 'teach-task':formDialog('Een taak aanleren','<label class="field-label" for="task-name">Naam van de taak</label><input class="field-input" id="task-name" name="name" required><label class="field-label" for="task-instructions">Instructies</label><textarea id="task-instructions" class="field-input" name="description" rows="5" required></textarea>','skill-new');break;
 case 'voice':popover(target,`<div style="padding:12px;max-width:240px"><strong>Spraakmodus</strong><p class="small muted">Spraakbediening is zichtbaar als interfacevoorbeeld. Microfoon en externe spraakdiensten worden niet gestart.</p></div>`);break;
 case 'routines':routines();break;
 case 'routine-detail':feedback='';routineDetail(id||activeRoutineId);break;
 case 'routine-toggle':{const routine=state.routines.find(item=>item.id===(id||activeRoutineId))||state.routines[0];routine.paused=!routine.paused;activeRoutineId=routine.id;persist();if(overlay.open)routineDetail(routine.id);else render();break;}
 case 'routine-test':feedback='De lokale voorbeeldtest is voltooid. Er is geen taak uitgevoerd.';routineDetail();break;
 case 'routine-new':formDialog('Routine toevoegen','<label class="field-label" for="routine-name">Naam</label><input id="routine-name" class="field-input" name="name" required><label class="field-label" for="routine-schedule">Planning</label><input id="routine-schedule" class="field-input" name="schedule" value="Elke dag om 09:00" required>','routine-new');break;
 case 'wake-computer':target.closest('.context-body').innerHTML=`<div class="screen-preview">${icon('computer')}</div><h3 style="font-size:14px;font-weight:500">Computer niet beschikbaar</h3><p class="context-hint">Er is geen externe computer verbonden met deze lokale replica.</p><button class="outline-button" data-action="context-tab" data-id="computer">Opnieuw proberen</button>`;break;
 case 'artifact-preview':artifactPreview();break;
 case 'artifact-download':downloadText('Marktonderzoek.md','# Marktonderzoek\n\nDit is een lokaal voorbeeldbestand.\n');break;
 case 'copy-message':{const message=(state.messages[state.selected]||[]).find(item=>item.id===id);const copied=message?await copyToClipboard(message.text):false;target.setAttribute('aria-label',copied?'Gekopieerd':'Kopiëren mislukt');target.title=copied?'Gekopieerd':'Kopiëren mislukt';break;}
 case 'retry-message':{const message=(state.messages[state.selected]||[]).find(item=>item.id===id);if(message)message.text='De lokale voorbeeldreactie is opnieuw gegenereerd. Er is geen model aangeroepen.';persist();render();break;}
 case 'local-approval':{const card=target.closest('.transcript-card'),message=(state.messages[state.selected]||[]).find(item=>item.id===card.dataset.messageId);if(message){message.cardOutcome=value;persist();render();}break;}
 case 'demo-secret':{const field=target.closest('.transcript-card').querySelector('.demo-secret');if(!field?.value){field?.focus();break;}field.value='';const card=target.closest('.transcript-card'),message=(state.messages[state.selected]||[]).find(item=>item.id===card.dataset.messageId);if(message){message.secretConfirmed=true;persist();render();}break;}
 case 'search':showSearch();break;
 case 'download':showDialog('small-dialog','Download Grok Bot','<div class="form-dialog"><h1>Grok Bot voor macOS</h1><p>Je gebruikt een lokale browserreconstructie. Er wordt geen app geïnstalleerd of gedownload.</p><button class="outline-button" data-action="about">Over deze reconstructie</button></div>');break;
 case 'help':showDialog('small-dialog','Help en feedback','<div class="form-dialog"><h1>Help en feedback</h1><p>Gebruik de catalogus, botdetails en instellingen om de gereconstrueerde interface te verkennen. Lokale voorbeelden blijven in deze browser. Echte harness voert opdrachten uit via de eigen Grok Bot-harness op deze Mac en bewaart geschiedenis op de lokale server.</p><button class="outline-button" data-action="conversation-examples">Gespreksvoorbeelden openen</button><button class="outline-button" data-action="version-examples">0.71.2 voorbeelden openen</button><button class="outline-button" data-action="motion-lab">Bewegingslab openen</button><button class="outline-button" data-action="icon-lab">Iconenlab openen</button><button class="outline-button" data-action="reset-demo">Voorbeeldgegevens herstellen</button><nav class="motion-help-links" aria-label="Bewegingsonderzoek"><a href="/ui-motion.html">UI-overgangen</a><a href="/ui-motion-catalogue.html">Volledige bewegingscatalogus</a></nav></div>');break;
 case 'icon-lab':{const requestedVersion=dialogVersion;const cleanup=await openIconLab({showDialog,closeDialog,isCurrent:()=>dialogVersion===requestedVersion&&overlay.open&&overlay.getAttribute('aria-label')==='Help en feedback'});if(cleanup)previewCleanup=cleanup;break;}
 case 'motion-lab':{const requestedVersion=dialogVersion;const cleanup=await openMotionLab({showDialog,closeDialog,isCurrent:()=>dialogVersion===requestedVersion&&overlay.open&&overlay.getAttribute('aria-label')==='Help en feedback'});if(cleanup)previewCleanup=cleanup;break;}
 case 'about':showDialog('small-dialog','Over deze reconstructie','<div class="form-dialog"><h1>Grok Bot</h1><p>Afzonderlijke lokale reconstructie van de zichtbare interface en statisch traceerbare interacties uit Grok Bot 0.71.2. De hier gereconstrueerde lokale functies zijn gebaseerd op waargenomen bediening en statische bronanalyse; dit is geen claim van volledige platformpariteit.</p><p>Dit is een onafhankelijke reconstructie. In Lokale voorbeelden blijven chats en instellingen in de browser. In de modus Echte harness draaien chats, tools en terminalopdrachten via de eigen Grok Bot-harness op deze Mac. Browseracties gebruiken een aparte Chromium-sessie.</p><p class="small muted">Zie het begeleidende onderzoeksdossier voor herkomst, verificatie en openstaande hiaten.</p></div>');break;
 case 'reset-demo':workflowDelivery.journal.destroy();chatSurface.reset();taskFailure='';chatFailures.clear();state=structuredClone(initialState);workflowDelivery.reset();chatSurface.reconcileReload();groupMode=false;groupRecipients=[];initializeAttachments();persist();closeDialog();render();break;
 }
});
document.addEventListener('input',event=>{
 productSurfaces?.handleInput(event);
 const input=event.target;
 if(input.id==='catalog-search'){market.query=input.value;updateSearch();}
 if(input.id==='global-search'){const query=input.value.toLowerCase();$('#global-search-results').innerHTML=state.agents.filter(agent=>(agent.name+' '+agent.preview).toLowerCase().includes(query)).map(agent=>agentRow(agent,true)).join('')||'<div class="empty">Geen resultaten</div>';}
 if(input.id==='recipient-search')$('#recipient-results').innerHTML=recipientResults(input.value);
 if(input.id==='timezone-search'){$$('#timezone-results .menu-row').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(input.value.toLowerCase()));}
 if(composerEventInput(input)){
  if(composerEventInput(input).dataset.richComposer!==undefined){
   refreshComposerPayload();return;
  }
  // Native multiline insertion can dispatch the same completed value repeatedly.
  // Persist and measure once for each distinct draft, preserving immediate saves.
  if(state.drafts[state.selected||'new']===input.value)return;
  state.drafts[state.selected||'new']=input.value;delete state.draftRichTexts[state.selected||'new'];persist();
  input.style.height='20px';input.style.height=Math.min(180,input.scrollHeight)+'px';
  refreshComposerPayload();
 }
});
document.addEventListener('paste',event=>{
 const files=[...(event.clipboardData?.files||[])];
 if(!composerEventInput(event.target)||!files.length)return;
 event.preventDefault();event.stopPropagation();void stageFiles(files,state.selected||'new');
},true);
document.addEventListener('change',event=>{
 productSurfaces?.handleChange(event);
 const input=event.target,field=input.dataset.field;
 if(input.dataset.questionId)selectQuestion(state,input,persist);
 if(field==='theme'){state.theme=input.value;persist();}
 if(field==='accent-color'&&['bot','black'].includes(input.value)){state.accentColor=input.value;persist();}
 if(field==='agent-name'){const agent=selectedBot();if(agent&&input.value.trim()){agent.name=input.value.trim();persist();render();}}
 if(field==='agent-label'){const agent=selectedBot();if(agent){agent.description=input.value;persist();}}
 if(input.id==='attachment-input'){const files=[...input.files],key=state.selected||'new';input.value='';stageFiles(files,key);}
});
document.addEventListener('keydown',event=>{
 if(productSurfaces?.handleKeyDown(event))return;
 if(commandPalette.handleKeyDown(event))return;
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'){event.preventDefault();state.selected=null;state.context=false;groupMode=false;groupRecipients=[];persist();render();}
 if(composerEventInput(event.target)&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!event.repeat)sendMessage();}
 if(event.target.id==='catalog-search'&&event.key==='Enter'){const option=$('#catalog-search-results [data-action="plugin-detail"]');if(option){event.preventDefault();option.click();}}
 if(event.target.id==='catalog-search'&&event.key==='Escape'){market.query='';event.target.value='';updateSearch();event.stopPropagation();}
});
document.addEventListener('click',event=>{
 const target=event.target.closest('[data-action]');if(!target)return;
 if(target.dataset.action==='send-message'&&!event.productHandled)sendMessage();

});
document.addEventListener('submit',event=>{
 const surfaceForm=event.target;const handled=productSurfaces?.handleSubmit({submit:surfaceForm.dataset.submit||surfaceForm.id,form:surfaceForm,data:new FormData(surfaceForm),event});
 if(handled===true||(handled&&typeof handled.then==='function')){event.preventDefault();if(handled?.catch)handled.catch(console.error);return;}
 if(event.target.id==='composer-form'){event.preventDefault();sendMessage();return;}
 if(event.target.id!=='local-form')return;event.preventDefault();
 const form=event.target,data=new FormData(form),submit=form.dataset.submit;
 const name=String(data.get('name')||'').trim();
 if(submit==='new-bot'){const agent={id:crypto.randomUUID(),name:name||'Nieuwe Bot',description:String(data.get('description')||''),preview:'Nieuw gesprek',color:'#1680f3',shape:0};state.agents.push(agent);state.selected=agent.id;state.context=true;state.contextTab='details';persist();closeDialog();render();}
 if(submit==='rename-agent'){const agent=getAgent(String(data.get('id')));if(agent)agent.name=name;persist();closeDialog();render();}
 if(submit==='rename-identity'){state.botName=name;persist();closeDialog();render();}
 if(submit==='new-section'){state.sections.push({id:crypto.randomUUID(),name,collapsed:false});persist();closeDialog();render();}
 if(submit==='rename-section'){const section=state.sections.find(item=>item.id===data.get('id'));if(section)section.name=name;persist();closeDialog();render();}
 if(submit==='save-rule'){const rule={name,behavior:String(data.get('behavior'))};if(ruleDraft===null)state.rules.push(rule);else state.rules[ruleDraft]=rule;persist();renderSettings('general');}
 if(submit==='schedule-update'){feedback='Lokale update gepland voor '+String(data.get('time')).replace('T',' om ')+'.';renderSettings('computer');}
 if(submit==='cookie-import'){feedback=data.getAll('sites').length+' voorbeeldsites geselecteerd. Er zijn geen cookies gelezen.';renderSettings('computer');}
 if(submit==='reset-computer'){feedback='Lokale computerstatus hersteld. Er is geen echte computer gewijzigd.';renderSettings('computer');}
 if(submit==='vault-new'){state.vault={name,username:String(data.get('username'))};persist();renderSettings('vault');}
 if(submit==='skill-new'){state.privateSkills.push({name,description:String(data.get('description'))});persist();market.page='installed';renderInstalled();}
 if(submit==='routine-new'){state.routines.push({id:crypto.randomUUID(),name,schedule:String(data.get('schedule')),paused:false});persist();routines();}
 if(submit==='share-template')closeDialog();
 if(submit==='avatar-upload'){const file=data.get('photo');if(file instanceof File&&file.type.startsWith('image/')){if(file.size>2*1024*1024){const old=$('.upload-feedback',form);if(old)old.remove();form.insertAdjacentHTML('beforeend','<p class="upload-feedback inline-feedback" role="status">Kies een afbeelding kleiner dan 2 MB.</p>');return;}const reader=new FileReader();reader.onload=()=>{if(!overlay.contains(form))return;const id=String(data.get('id'));if(id==='identity')state.botPhoto=reader.result;else{const agent=getAgent(id);if(agent)agent.photo=reader.result;}persist();closeDialog();render();};reader.readAsDataURL(file);}}
});
productSurfaces.ready.catch(error=>console.error('Product surfaces failed to load',error));
startAvatarMotion();
await chatSurface.reconcileReload();
render();
fetchIconData().then(()=>{for(const node of document.querySelectorAll('.icon[data-icon-semantic]'))node.innerHTML=iconSvg(SEMANTIC_ICONS[node.dataset.iconSemantic]||'file');}).catch(()=>{});
const deepLink=new URLSearchParams(location.search);if(deepLink.has('plugin')){market.page='detail';market.detail=deepLink.get('plugin');renderPluginDetail();}

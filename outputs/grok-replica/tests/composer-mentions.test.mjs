import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComposerDocument,projectComposerDocument} from '../composer-document.js';
import {renderComposerDocument} from '../composer-document-view.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const document=attrs=>({type:'doc',content:[{type:'paragraph',content:[{type:'mention',attrs}]}]});
test('member mentions retain identity and native projection without acquiring skill authority',()=>{
 const doc=document({id:'bot-alpha',label:'Alpha',mentionSuggestionChar:'@'}),richText=JSON.stringify(doc);
 assert.equal(projectComposerDocument(doc),'@Alpha');
 assert.equal(normalizeComposerDocument(richText,{text:'@Alpha',references:[]}),richText);
 assert.throws(()=>normalizeComposerDocument(richText,{text:'@Alpha',references:[{id:'bot-alpha'}]}));
 assert.equal(projectComposerDocument(document({id:'bot-alpha',label:null,mentionSuggestionChar:'@'})),'@bot-alpha');
});
test('mention attributes are closed and safe escaped presentation cannot become an authority or external resource',()=>{
 const doc=document({id:'member-1',label:'<img src=x>',mentionSuggestionChar:'@'}),text=projectComposerDocument(doc);
 const html=renderComposerDocument({text,richText:JSON.stringify(doc)},esc);
 assert.match(html,/data-inline-mention/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img/);
 for(const attrs of [{id:'x',label:'A',role:'owner'},{id:'x',label:'A\0B'},{id:'x',label:'A',mentionSuggestionChar:'<script>'}]){
  const value=document(attrs);assert.throws(()=>normalizeComposerDocument(JSON.stringify(value),{text:projectComposerDocument(value),references:[]}));
 }
});

const {mentionRoster,mentionCandidates,normalizeMentionSearch,rankMentionCandidates}=await import('../composer-mentions.js');
test('canonical member roster excludes self, keeps groups containing current member, and preserves group membership order',()=>{
 const alpha={id:'a',name:'Alpha'},beta={id:'b',name:'Beta'},shared={id:'g',name:'Shared',group:true,memberIds:['b','a','missing']},other={id:'o',name:'Other',group:true,memberIds:['b']};
 assert.deepEqual(mentionRoster(null,[alpha,beta]),[]);
 assert.deepEqual(mentionRoster(alpha,[alpha,beta,shared,other]).map(item=>item.id),['b','g']);
 assert.deepEqual(mentionRoster(shared,[alpha,beta,shared]).map(item=>item.id),['b','a']);
 const rows=mentionCandidates(shared,[alpha,beta,shared]);assert.equal(rows[0].id,'__everyone__');assert.equal(rows[0].label,'iedereen');assert.equal(rows[0].insertLabel,'everyone');assert.equal(rows[0].typeLabel,'Bot');
 assert.equal(mentionCandidates(alpha,[alpha,beta]).some(item=>item.id==='__everyone__'),false);
});
test('native fuzzy search normalizes marks punctuation and sigma then ranks subsequences and recents with stable empty order',()=>{
 assert.equal(normalizeMentionSearch('  Écho---Καφές  '),'echo καφεσ');assert.equal(normalizeMentionSearch('Iıİ','tr'),'iii');
 const rows=[{key:'assistants:a',label:'Marketing Agent'},{key:'assistants:b',label:'Marketeer'},{key:'assistants:c',label:'Other'},{key:'assistants:a',label:'Duplicate'}];
 assert.deepEqual(rankMentionCandidates(rows,'',['assistants:b']).map(item=>item.key),['assistants:a','assistants:b','assistants:c']);
 assert.deepEqual(rankMentionCandidates(rows,'mkt').map(item=>item.key),['assistants:b','assistants:a']);
 const tied=[{key:'a',label:'Alpha'},{key:'b',label:'Alpha'}];assert.deepEqual(rankMentionCandidates(tied,'alp',['b']).map(item=>item.key),['b','a']);
 assert.deepEqual(rankMentionCandidates(rows,'???'),[]);
});


test('transcript navigation is available only for an actually resolved member',()=>{
 const doc=document({id:'known',label:'Known',mentionSuggestionChar:'@'}),message={text:'@Known',richText:JSON.stringify(doc)};
 const known=renderComposerDocument(message,esc,{resolveMentionMember:id=>id==='known'?{id,name:'Known'}:undefined,renderMentionAvatar:()=>'<span aria-hidden="true">icon</span>'});
 assert.match(known,/<button/);assert.match(known,/data-action="select-agent" data-id="known"/);assert.match(known,/>Known<\/span>/);
 const unresolved=renderComposerDocument(message,esc);assert.doesNotMatch(unresolved,/<button|data-action=/);
});


test('source special member display names preserve raw insertion and distinct empty-label display contracts',async()=>{
 const {mentionMemberLabel,mentionDisplayLabel}=await import('../composer-mentions.js');
 assert.equal(mentionMemberLabel({name:'New Bot'}),'Nieuwe Bot');assert.equal(mentionMemberLabel({name:'New team bot'}),'Nieuwe teambot');
 assert.equal(mentionMemberLabel({name:'Disk Saver',purpose:'disk-saver'}),'Schijfopruimer');assert.equal(mentionMemberLabel({name:'Disk Saver'}),'Disk Saver');
 assert.equal(mentionCandidates({id:'a',name:'A'},[{id:'b',name:'New Bot'}])[0].insertLabel,'New Bot');
 assert.equal(mentionDisplayLabel({id:'b',label:'New Bot'},{id:'b',name:'New Bot'}),'Nieuwe Bot');
 assert.equal(mentionDisplayLabel({id:'b',label:'Old name'},{id:'b',name:'New name'}),'Old name');
 assert.equal(mentionDisplayLabel({id:'b',label:''},undefined,{prompt:true}),'b');assert.equal(mentionDisplayLabel({id:'b',label:''},undefined),'');
});
test('resolved mention controls have one navigation owner even when the document contains a link mark',()=>{
 const doc=document({id:'known',label:'Known',mentionSuggestionChar:'@'});doc.content[0].content[0].marks=[{type:'link',attrs:{href:'https://external.example'}}];
 const message={text:'@Known',richText:JSON.stringify(doc)};
 const known=renderComposerDocument(message,esc,{resolveMentionMember:id=>({id,name:'Known'})});assert.match(known,/<button/);assert.doesNotMatch(known,/<a |external.example/);
 assert.match(renderComposerDocument(message,esc),/<a href="https:\/\/external.example"/);
});


test('nullable everyone aliases localize only without an actual resolved member and glyphs follow native entity kind',async()=>{
 const {mentionDisplayLabel,mentionGlyphName}=await import('../composer-mentions.js');
 assert.equal(mentionDisplayLabel({id:null,label:'everyone'},undefined,{prompt:true}),'iedereen');assert.equal(mentionDisplayLabel({id:null,label:'all'},undefined),'iedereen');
 assert.equal(mentionDisplayLabel({id:'__everyone__',label:'unrelated'},undefined),'unrelated');assert.equal(mentionDisplayLabel({id:'known',label:'all'},{id:'known',name:'all'}),'all');
 assert.equal(mentionGlyphName({id:'__everyone__',label:'everyone'},undefined),'people-3');assert.equal(mentionGlyphName({id:'unknown',label:'Unknown'},undefined),'person');assert.equal(mentionGlyphName({id:'g',label:'Group'},{id:'g',group:true}),'people-3');
});

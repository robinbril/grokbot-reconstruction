import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComposerDocument,projectComposerDocument} from '../composer-document.js';
import {normalizeRichText} from '../harness/rich-text.mjs';
import {renderComposerDocument} from '../composer-document-view.js';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const encode=attrs=>JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'todoReference',attrs}]}]});

test('passive todo identity and raw status retain exact bytes without skill authority',()=>{
 const richText=encode({id:'synthetic-todo',label:'Controleer bewijs',status:'in_progress'}),text='Over de taak "Controleer bewijs":';
 assert.equal(normalizeComposerDocument(richText,{text,references:[]}),richText);
 assert.equal(normalizeRichText({text,richText}),richText);
 assert.equal(projectComposerDocument(JSON.parse(richText)),text);
 assert.throws(()=>normalizeComposerDocument(richText,{text,references:[{id:'synthetic-todo'}]}));
});
test('nullable and unknown todo attributes are presentation data rather than executable references',()=>{
 for(const attrs of [{},{id:null,label:null,status:null},{id:'',label:'',status:'unknown'}]){
  const richText=encode(attrs),text='Over de taak "":';
  assert.equal(normalizeComposerDocument(richText,{text,references:[]}),richText);
  assert.equal(projectComposerDocument(JSON.parse(richText)),text);
  assert.equal(renderComposerDocument({text,richText},esc),'<span class="composer-document" data-composer-document></span>');
 }
});
test('todo transcript escapes title and label and stays passive for every status',()=>{
 const label='<script>proof</script>';
 for(const status of ['pending','in_progress','completed','cancelled','unknown',null]){
  const richText=encode({id:'https://example.test/NOT_A_LOOKUP',label,status});
  const html=renderComposerDocument({text:`Over de taak "${label}":`,richText},esc);
  assert.match(html,/data-type="todo-reference"/);assert.match(html,/&lt;script&gt;proof&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script|https:|button|data-action|tabindex|role="button"|href=/);
  assert.equal(/data-todo-status=/.test(html),['pending','in_progress','completed','cancelled'].includes(status));
 }
});
test('todo schema rejects executable fields malformed attrs and projection tampering',()=>{
 for(const attrs of [{id:1,label:'x'},{label:[]},{label:'x',status:{}},{label:'x',onClick:'execute'},{label:'x\0y'},{id:'x'.repeat(257),label:'x'},{label:'x'.repeat(2049)}])assert.throws(()=>normalizeComposerDocument(encode(attrs),{text:'Over de taak "x":'}));
 const richText=encode({label:'x'});assert.throws(()=>normalizeComposerDocument(richText,{text:'@x'}));
});
test('link marks remain durable data but cannot activate or wrap the passive todo chip',()=>{
 for(const label of ['synthetic','']){
  const document=JSON.parse(encode({id:'synthetic',label,status:'pending'}));document.content[0].content[0].marks=[{type:'link',attrs:{href:'https://example.test'}}];
  const richText=JSON.stringify(document),text=`Over de taak "${label}":`;
  assert.equal(normalizeComposerDocument(richText,{text}),richText);
  assert.doesNotMatch(renderComposerDocument({text,richText},esc),/<a|href=|button/);
 }
});
test('native todo label limit preserves whole graphemes within56 UTF16 units',async()=>{
 const {todoLabel,todoStatus}=await import('../composer-todo.js');
 assert.equal(todoLabel('x'.repeat(56)),'x'.repeat(56));assert.equal(todoLabel('x'.repeat(57)),'x'.repeat(55)+'…');
 assert.equal(todoLabel('x'.repeat(54)+'👨‍👩‍👧‍👦 end'),'x'.repeat(54)+'…');
 assert.equal(todoLabel('x'.repeat(54)+'   long'),'x'.repeat(54)+'…');assert.equal(todoStatus('done'),null);
});
test('recovered todo status glyphs match native names and completed filled variant',async()=>{
 const {readFile}=await import('node:fs/promises'),{loadIconData,iconSvg}=await import('../icon-library.js'),{todoGlyph}=await import('../composer-todo-view.js');
 loadIconData(JSON.parse(await readFile(new URL('../assets/grok-icons.json',import.meta.url),'utf8')));
 assert.equal(todoGlyph('pending'),iconSvg('circle-dashed',{size:12}));assert.equal(todoGlyph('in_progress'),todoGlyph('pending'));
 assert.equal(todoGlyph('completed'),iconSvg('check-circle',{size:12,filled:true}));assert.equal(todoGlyph('cancelled'),iconSvg('x-circle',{size:12}));assert.equal(todoGlyph('done'),'');
});

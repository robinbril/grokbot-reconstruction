import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComposerDocument,projectComposerDocument,composerLinkAllowed} from '../composer-document.js';
import {renderComposerDocument} from '../composer-document-view.js';
import {legacyRichTextReferences} from '../harness/rich-text.mjs';
const text=value=>({type:'text',text:value});
const paragraph=(...content)=>({type:'paragraph',content});
const item=(...content)=>({type:'listItem',content});
const list=(...content)=>({type:'bulletList',content});
const doc=(...content)=>({type:'doc',content});
const linked=(label,href)=>({...text(label),marks:[{type:'link',attrs:{href,target:'_blank',rel:'noopener noreferrer nofollow',class:null}}]});
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('native paragraph projection differs from hard breaks while durable legacy bytes remain accepted',()=>{
 const document=doc(paragraph(text('a')),paragraph(text('b'))),richText=JSON.stringify(document);
 assert.equal(projectComposerDocument(document),'a\n\nb');
 assert.equal(normalizeComposerDocument(richText,{text:'a\n\nb'}),richText);
 assert.equal(normalizeComposerDocument(richText,{text:'a\nb'}),richText);
 assert.equal(projectComposerDocument(doc(paragraph(text('a'),{type:'hardBreak'},text('b')))),'a\nb');
 assert.throws(()=>normalizeComposerDocument(richText,{text:'a\n\n\nb'}));
});
test('native nested lists preserve numbering, marker widths and continuation indentation',()=>{
 const document=doc(paragraph(text('Plan')),list(item(paragraph(text('first'),{type:'hardBreak'},text('continued')), {type:'orderedList',attrs:{start:9,type:null},content:[item(paragraph(text('nested'))),item(paragraph(text('next')))]}),item(paragraph(text('last')))));
 const expected='Plan\n\n- first\n  continued\n  9. nested\n  10. next\n- last';
 assert.equal(projectComposerDocument(document),expected);
 assert.equal(normalizeComposerDocument(JSON.stringify(document),{text:expected}),JSON.stringify(document));
 assert.throws(()=>normalizeComposerDocument(JSON.stringify(document),{text:expected.replace('9.','1.')}));
});
test('native link projection adds one suffix at the last contiguous text node',()=>{
 const href='https://example.test',document=doc(paragraph(linked('Read ',href),linked('this',href),text(' then '),linked('example.test',href),text(' or '),linked('info@example.test','mailto:info@example.test')));
 assert.equal(projectComposerDocument(document),'Read this (https://example.test) then example.test or info@example.test');
 assert.equal(normalizeComposerDocument(JSON.stringify(document),{text:projectComposerDocument(document)}),JSON.stringify(document));
});
test('link guard accepts native protocols and relative links but rejects obfuscated executable schemes',()=>{
 for(const href of ['https://example.test','ftp://example.test','tel:123','mailto:a@example.test','/docs','#part','example.test'])assert.equal(composerLinkAllowed(href),true,href);
 for(const href of ['javascript:alert(1)','java\nscript:alert(1)','data:text/html,x','vbscript:x'])assert.equal(composerLinkAllowed(href),false,href);
 const document=doc(paragraph(linked('unsafe','javascript:alert(1)')));
 assert.throws(()=>normalizeComposerDocument(JSON.stringify(document),{text:'unsafe (javascript:alert(1))'}));
});
test('native inline nodes retain safe link marks without giving a skill additional authority',()=>{
 const marks=linked('unused','https://example.test').marks;
 const document=doc(paragraph(linked('a','https://example.test'),{type:'hardBreak',marks},linked('b','https://example.test')));
 const projected=projectComposerDocument(document);assert.equal(projected,'a\nb (https://example.test)');
 assert.equal(normalizeComposerDocument(JSON.stringify(document),{text:projected}),JSON.stringify(document));
 const atom={type:'workflowReference',attrs:{id:'skill',label:'Research'},marks};
 const richText=JSON.stringify(doc(paragraph(atom)));
 assert.equal(normalizeComposerDocument(richText,{text:'@Research',references:[{id:'skill'}]}),richText);
 assert.throws(()=>normalizeComposerDocument(richText,{text:'@Research',references:[]}));
});
test('nested documents render actual lists and safe links without trusting link HTML attributes',()=>{
 const document=doc({type:'orderedList',attrs:{start:3,type:null},content:[item(paragraph(linked('<Read>','https://example.test')))]});
 const html=renderComposerDocument({text:projectComposerDocument(document),richText:JSON.stringify(document)},esc);
 assert.match(html,/<ol start="3"><li><p><a href="https:\/\/example.test" target="_blank" rel="noopener noreferrer nofollow">&lt;Read&gt;<\/a><\/p><\/li><\/ol>/);
 assert.doesNotMatch(html,/class="null"/);
 document.content[0].attrs.type='I';
 assert.match(renderComposerDocument({text:projectComposerDocument(document),richText:JSON.stringify(document)},esc),/<ol start="3" type="I">/);
});
test('nested skill identities reach public legacy presentation without publishing instructions',()=>{
 const atom={type:'workflowReference',attrs:{id:'skill',label:'Research'}},document=doc(list(item(paragraph(atom))));
 const body={text:'- @Research',richText:JSON.stringify(document),skillReferences:[JSON.stringify({id:'skill',label:'Research',content:'PRIVATE'})]};
 assert.deepEqual(legacyRichTextReferences(body),[{kind:'skill',id:'skill',label:'Research'}]);
});
test('list grammar, nested depth and marks remain bounded and closed',()=>{
 const malformed=[doc(list(paragraph(text('bad')))),doc({type:'listItem',content:[paragraph(text('bad'))]}),doc({type:'orderedList',attrs:{start:1.5},content:[item(paragraph(text('bad')))]}),doc(paragraph({...text('bad'),marks:[{type:'bold'}]}))];
 let deep=paragraph(text('deep'));for(let i=0;i<40;i++)deep=list(item(paragraph(),deep));malformed.push(doc(deep));
 for(const document of malformed)assert.throws(()=>normalizeComposerDocument(JSON.stringify(document),{text:'bad'}));
});
test('presentation documents retain existing long local drafts without changing API admission limits',()=>{
 const value='werk '.repeat(8500),richText=JSON.stringify(doc(paragraph(text(value))));
 assert.equal(normalizeComposerDocument(richText,{text:value}),richText);
 assert.throws(()=>normalizeComposerDocument(JSON.stringify(doc(paragraph(text('x'.repeat(262145))))),{text:'x'.repeat(262145)}));
});

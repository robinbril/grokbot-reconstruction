import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComposerDocument} from '../composer-document.js';

const ref={id:'synthetic-skill',label:'Onderzoek',revision:1};
const atom={type:'workflowReference',attrs:{id:ref.id,label:ref.label,iconId:null,iconUrl:null}};
const doc=content=>JSON.stringify({type:'doc',content:[{type:'paragraph',content}]});
test('optional rich document preserves original bytes and native text projection',()=>{
 assert.equal(normalizeComposerDocument(undefined,{text:'legacy'}),undefined);
 const richText=doc([{type:'text',text:'Gebruik '},atom,{type:'text',text:' nu'},{type:'hardBreak'},{type:'text',text:'tweede regel'}]);
 assert.equal(normalizeComposerDocument(richText,{text:'Gebruik @Onderzoek nu\ntweede regel',references:[ref]}),richText);
});
test('paragraph boundaries and repeated atomic references have one selected identity',()=>{
 const richText=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[atom,atom]},{type:'paragraph'},{type:'paragraph',content:[{type:'text',text:'einde'}]}]});
 assert.equal(normalizeComposerDocument(richText,{text:'@Onderzoek@Onderzoek\n\neinde',references:[ref]}),richText);
});
test('rich document rejects text or skill bindings that differ from its projection',()=>{
 const richText=doc([atom]);
 for(const context of [{text:'different',references:[ref]},{text:'@Onderzoek',references:[]},{text:'@Onderzoek',references:[ref,{id:'extra'}]},{text:'@Onderzoek',references:[ref,ref]}])assert.throws(()=>normalizeComposerDocument(richText,context));
});
test('closed schema rejects executable nodes, arbitrary marks, attrs and malformed documents',()=>{
 for(const richText of [null,{},'not JSON',JSON.stringify({type:'doc'}),doc([{type:'script',text:'execute'}]),doc([{type:'text',text:'x',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]),doc([{...atom,attrs:{...atom.attrs,content:'injected instructions'}}]),doc([{type:'workflowReference',attrs:{id:ref.id,label:ref.label,iconUrl:17}}]),doc([{type:'text',text:''}]),JSON.stringify({type:'doc',content:[{type:'paragraph',content:[]}],unknown:true})])assert.throws(()=>normalizeComposerDocument(richText,{text:'x',references:[ref]}));
});
test('documents have bounded serialized size and flat node counts',()=>{
 assert.throws(()=>normalizeComposerDocument(' '.repeat(262145),{text:''}));
 const richText=doc(Array.from({length:4097},()=>({type:'hardBreak'})));
 assert.throws(()=>normalizeComposerDocument(richText,{text:'\n'.repeat(4097)}));
});

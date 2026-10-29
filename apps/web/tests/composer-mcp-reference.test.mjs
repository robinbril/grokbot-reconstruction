import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeComposerDocument,projectComposerDocument} from '../composer-document.js';
import {normalizeRichText} from '../harness/rich-text.mjs';
const atom=(id,label='Synthetic MCP')=>({type:'workflowReference',attrs:{id,label,iconId:null,iconUrl:null}});
const encode=content=>JSON.stringify({type:'doc',content:[{type:'paragraph',content}]});

test('MCP presentation identity retains exact rich bytes without selected skill authority',()=>{
 const richText=encode([atom('mcp:custom_synthetic')]),text='@Synthetic MCP';
 assert.equal(normalizeComposerDocument(richText,{text,references:[]}),richText);
 assert.equal(normalizeRichText({text,richText}),richText);
 assert.equal(projectComposerDocument(JSON.parse(richText)),text);
});
test('mixed MCP and immutable skill nodes bind only the ordinary skill identity',()=>{
 const richText=encode([atom('mcp:custom_synthetic'),{type:'text',text:' '},atom('synthetic-skill','Synthetic skill')]),text='@Synthetic MCP @Synthetic skill';
 assert.equal(normalizeComposerDocument(richText,{text,references:[{id:'synthetic-skill'}]}),richText);
 assert.throws(()=>normalizeComposerDocument(richText,{text,references:[]}));
 assert.throws(()=>normalizeComposerDocument(richText,{text,references:[{id:'mcp:custom_synthetic'},{id:'synthetic-skill'}]}));
});
test('malformed MCP namespaces never become an ordinary selected skill or a resource URL',()=>{
 for(const id of ['mcp:','mcp:custom/server','mcp:custom?token','mcp:custom\nserver','mcp:custom:server','mcp:'+'x'.repeat(253)]){
  const richText=encode([atom(id)]);
  assert.throws(()=>normalizeComposerDocument(richText,{text:'@Synthetic MCP',references:[{id}]}));
 }
});

test('native MCP null or empty display labels project to the trigger without fabricating a server name',()=>{
 for(const label of [null,'',undefined]){
  const node=atom('mcp:custom_synthetic');node.attrs.label=label;
  const richText=encode([node]);assert.equal(normalizeComposerDocument(richText,{text:'@',references:[]}),richText);
  assert.equal(projectComposerDocument(JSON.parse(richText)),'@');
 }
});

test('MCP IDs supplied as legacy instructions remain rejected instead of acquiring executable skill context',()=>{
 const richText=encode([atom('mcp:custom_synthetic')]);
 assert.throws(()=>normalizeRichText({text:'@Synthetic MCP',richText,skillReferences:[JSON.stringify({id:'mcp:custom_synthetic',label:'Synthetic MCP',description:'MUST_NOT_BECOME_SKILL_INSTRUCTIONS'})]}),{code:'INVALID_RICH_TEXT'});
});

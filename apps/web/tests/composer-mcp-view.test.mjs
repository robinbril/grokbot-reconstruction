import test from 'node:test';
import assert from 'node:assert/strict';
import {composerMcpCandidates,mcpStateLabel,renderMcpReference} from '../composer-mcp-view.js';
import {renderComposerDocument} from '../composer-document-view.js';
const esc=value=>String(value).replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]));
test('MCP menu derives only actual configured runtime rows with conversation-local recents identity',()=>{
 const inventory={conversationId:'conversation-a',servers:[{id:'workspace',name:'Builtin'},{id:'custom_real',name:'Actual MCP',configuration:{},state:'disabled'},{id:'bad id',name:'Invalid',configuration:{}},{id:'custom_empty',name:'',configuration:{}}]};
 const rows=composerMcpCandidates(inventory);assert.equal(rows.length,1);assert.equal(rows[0].referenceId,'mcp:custom_real');assert.equal(rows[0].key,'tools:mcp:conversation-a:custom_real');assert.equal(rows[0].detail,'uitgeschakeld');
 assert.notEqual(composerMcpCandidates({...inventory,conversationId:'conversation-b'})[0].key,rows[0].key);assert.deepEqual(composerMcpCandidates({servers:inventory.servers}),[]);
});
test('source status labels describe presentation without granting authority',()=>{
 assert.deepEqual(['connected','needsAuth','needsGrant','error','initializing','disconnected'].map(mcpStateLabel),['verbonden','authenticatie nodig','heeft je goedkeuring nodig','fout','verbinden','verbinding verbroken']);
});
test('MCP transcript uses raw label and owns one action even when link-marked',()=>{
 const atom={type:'workflowReference',attrs:{id:'mcp:custom_real',label:'Actual <MCP>',iconId:null,iconUrl:null},marks:[{type:'link',attrs:{href:'https://example.test'}}]},richText=JSON.stringify({type:'doc',content:[{type:'paragraph',content:[atom]}]});
 const html=renderComposerDocument({role:'user',text:'@Actual <MCP>',richText,skillReferences:[]},esc);assert.match(html,/data-inline-mcp-reference="custom_real"/);assert.match(html,/Actual &lt;MCP&gt;/);assert.doesNotMatch(html,/<a\b|@Actual|data-inline-skill/);assert.equal((html.match(/data-action=/g)||[]).length,1);
 assert.match(renderMcpReference({...atom.attrs,label:null},esc),/title=""/);assert.equal(renderMcpReference({...atom.attrs,id:'ordinary-skill'},esc),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {renderComposerDocument} from '../composer-document-view.js';
import {emptyLiveConversation,projectLiveMessages} from '../live-harness-model.js';

const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const reference={kind:'skill',id:'synthetic-skill',label:'Onderzoek',revision:4,description:'not visible'};
const atom={type:'workflowReference',attrs:{id:reference.id,label:reference.label,iconId:null,iconUrl:'https://example.test/private-icon.png'}};
const document=content=>JSON.stringify({type:'doc',content});
const message=(content,text)=>({text,richText:document(content),skillReferences:[reference]});

test('native shaped document renders the skill at its exact inline position',()=>{
 const entry=message([{type:'paragraph',content:[{type:'text',text:'Gebruik '},atom,{type:'text',text:' nu'}]}],'Gebruik @Onderzoek nu');
 const html=renderComposerDocument(entry,esc);
 assert.match(html,/Gebruik <span class="inline-skill-reference"/);
 assert.match(html,/>@Onderzoek<\/span> nu/);
 assert.match(html,/title="Onderzoek · Versie 4"/);
 assert.match(html,/aria-label="Onderzoek · Versie 4"/);
 assert.doesNotMatch(html,/private-icon|not visible|https:|<img/);
});
test('literal text, names and identifiers are escaped without interpreting markup',()=>{
 const label='<img src=x onerror=alert(1)>',id='id" onmouseover="alert(1)';
 const entry={text:`<script>\n@${label}`,skillReferences:[{...reference,id,label}],richText:document([{type:'paragraph',content:[{type:'text',text:'<script>'},{type:'hardBreak'},{type:'workflowReference',attrs:{id,label}}]}])};
 const html=renderComposerDocument(entry,esc);
 assert.match(html,/&lt;script&gt;<br>/);
 assert.match(html,/@&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(html,/data-inline-skill-id="id&quot; onmouseover=&quot;alert\(1\)"/);
 assert.doesNotMatch(html,/<script|<img|data-inline-skill-id="id"/);
});
test('paragraphs, hard breaks and literal newlines preserve visual line boundaries',()=>{
 const entry={text:'one\ntwo\n\nthree\nfour',richText:document([{type:'paragraph',content:[{type:'text',text:'one'},{type:'hardBreak'},{type:'text',text:'two'}]},{type:'paragraph'},{type:'paragraph',content:[{type:'text',text:'three\nfour'}]}])};
 assert.equal(renderComposerDocument(entry,esc),'<span class="composer-document" data-composer-document>one<br>two<br><br>three<br>four</span>');
});
test('missing, invalid or mismatched metadata returns null for existing plain renderer fallback',()=>{
 assert.equal(renderComposerDocument({text:'legacy'},esc),null);
 assert.equal(renderComposerDocument({text:'legacy',richText:'broken'},esc),null);
 assert.equal(renderComposerDocument(message([{type:'paragraph',content:[atom]}],'forged projection'),esc),null);
 assert.equal(renderComposerDocument({...message([{type:'paragraph',content:[atom]}],'@Onderzoek'),skillReferences:[]},esc),null);
});
test('public user projection retains a valid document after serialization and drops instructions',()=>{
 const richText=document([{type:'paragraph',content:[atom]}]);
 const snapshot={...emptyLiveConversation('conversation'),entries:[{id:'entry',role:'user',text:'@Onderzoek',richText,skills:[{id:reference.id,name:reference.label,revision:4,description:'summary',content:'PRIVATE BODY'}]}]};
 const projected=projectLiveMessages(JSON.parse(JSON.stringify(snapshot)))[0];
 assert.equal(projected.richText,richText);
 assert.doesNotMatch(JSON.stringify(projected),/PRIVATE BODY/);
});
test('assistant or malformed public documents cannot bypass the transcript fallback',()=>{
 const richText=document([{type:'paragraph',content:[atom]}]);
 const entries=[{id:'legacy',role:'user',text:'@Onderzoek',richText},{id:'mismatch',role:'user',text:'different',richText},{id:'assistant',role:'assistant',text:'@Onderzoek',richText}];
 const projected=projectLiveMessages({...emptyLiveConversation('conversation'),entries});
 assert.ok(projected.every(entry=>!Object.hasOwn(entry,'richText')));
});
test('accepted legacy presentation refs retain inline layout without publishing instructions or a revision',()=>{
 const richText=document([{type:'paragraph',content:[atom]}]);
 const entry={id:'legacy',role:'user',text:'@Onderzoek',richText,legacySkillReferences:[{kind:'skill',id:reference.id,label:reference.label,description:'PRIVATE BODY',revision:99}]};
 const projected=projectLiveMessages({...emptyLiveConversation('conversation'),entries:[entry]})[0];
 assert.equal(projected.richText,richText);
 assert.deepEqual(projected.skillReferences,[{kind:'skill',id:reference.id,label:reference.label}]);
 const html=renderComposerDocument(projected,esc);assert.match(html,/>@Onderzoek<\/span>/);
 assert.doesNotMatch(JSON.stringify(projected)+html,/PRIVATE BODY|Versie|revision":99/);
});

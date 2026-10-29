import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSelectionQuote,quoteProjection,quoteLabel} from '../composer-quote.js';
import {normalizeComposerDocument,projectComposerDocument} from '../composer-document.js';
import {renderComposerDocument} from '../composer-document-view.js';
const atom=quote=>({type:'quoteReference',attrs:{quote}});
const doc=(...content)=>({type:'doc',content:[{type:'paragraph',content}]});
const text=value=>({type:'text',text:value});
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('selection quotes normalize newlines and whitespace while preserving literal selected content',()=>{
 assert.equal(normalizeSelectionQuote(' \r\nfirst\rsecond\n\nthird \n'),'first\nsecond\n\nthird');
 assert.equal(normalizeSelectionQuote(' \n '),null);
 assert.equal(normalizeSelectionQuote('x','  Source\n label  '),'x\n\n— Source label');
 assert.equal(normalizeSelectionQuote('x',' '),'x');
 assert.equal(normalizeSelectionQuote('x','s'.repeat(140)),'x\n\n— '+'s'.repeat(119)+'…');
});
test('native truncation reserves an ellipsis and never splits a grapheme at the UTF16 boundary',()=>{
 assert.equal(normalizeSelectionQuote('a'.repeat(20001)),'a'.repeat(19999)+'…\n[quote truncated]');
 const value='a'.repeat(19998)+'👩‍💻'+'b';
 assert.equal(normalizeSelectionQuote(value),'a'.repeat(19998)+'…\n[quote truncated]');
});
test('native quote chip label and submit projection have different exact representations',()=>{
 assert.equal(quoteLabel('one\n two'),'“one two”');
 assert.equal(quoteLabel('a'.repeat(21)),'“'+'a'.repeat(20)+'…”');
 assert.equal(quoteProjection('first\n  \nlast'),'\n> first\n>\n> last\n\n');
 assert.equal(quoteProjection(null),'\n>\n\n');
});
test('quote atoms validate independently of skill authority and preserve exact serialized bytes',()=>{
 const document=doc(text('before '),atom('first\n\nlast'),text(' after')),richText=JSON.stringify(document);
 const projected='before \n> first\n>\n> last\n\n after';
 assert.equal(projectComposerDocument(document),projected);
 assert.equal(normalizeComposerDocument(richText,{text:projected}),richText);
 assert.throws(()=>normalizeComposerDocument(richText,{text:projected,references:[{id:'forged-skill'}]}));
 assert.throws(()=>normalizeComposerDocument(richText,{text:'before first last after'}));
 for(const attrs of [{quote:{execute:true}},{quote:'x',id:'secret'},{quote:'x'.repeat(20401)}])assert.throws(()=>normalizeComposerDocument(JSON.stringify(doc({type:'quoteReference',attrs})),{text:'x'}));
});
test('transcript quote rendering escapes markup and retains full selected text in its accessible label',()=>{
 const quote='<script>alert(1)</script>\n\nsecond',document=doc(atom(quote));
 const html=renderComposerDocument({text:projectComposerDocument(document),richText:JSON.stringify(document)},esc);
 assert.match(html,/data-inline-quote/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script/);
 assert.match(html,/inline-quote-reference/);assert.match(html,/aria-label=/);
});

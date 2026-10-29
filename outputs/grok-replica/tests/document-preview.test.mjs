import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {previewDocx} from '../harness/docx-preview.mjs';
const fixture=new URL('./fixtures/model-attachments/facts.docx',import.meta.url);
test('DOCX preserves semantic formatted HTML from real archive',async()=>{const html=await previewDocx(await readFile(fixture));assert.match(html,/<p>/);assert.match(html,/DOCX_VERIFIED_NONCE_COBALT_7319/i);});
test('DOCX rejects malformed and expanded ZIP bomb bytes',async()=>{await assert.rejects(previewDocx(Buffer.from('PK broken')),{code:'ATTACHMENT_PREVIEW_INVALID'});await assert.rejects(previewDocx(await readFile(new URL('./fixtures/model-attachments/oversized.docx',import.meta.url))),{code:'ATTACHMENT_PREVIEW_INVALID'});});
test('DOCX cancellation stops pending conversion',async()=>{const controller=new AbortController();controller.abort();await assert.rejects(previewDocx(await readFile(fixture),{signal:controller.signal}),{name:'AbortError'});});
test('DOCX active worker is cancelled promptly',async()=>{const controller=new AbortController(),bytes=await readFile(fixture);const result=previewDocx(bytes,{signal:controller.signal});controller.abort();await assert.rejects(result,{name:'AbortError'});});

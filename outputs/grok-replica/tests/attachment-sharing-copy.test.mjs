import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentLimitLabel,attachmentSharingLabel} from '../attachments.js';
import {liveAttachmentContentHint} from '../live-workflows-attachments.js';
test('attachment quota does not promise local-only use for all modes',()=>{assert.doesNotMatch(attachmentLimitLabel,/Alleen lokaal/);assert.match(attachmentLimitLabel,/10 bestanden/);});
test('attachment disclosure distinguishes local examples from sending to the model',()=>{assert.match(attachmentSharingLabel(false),/^Alleen lokaal\./);assert.match(attachmentSharingLabel(true),/^Bij verzending gedeeld met het ingestelde model\./);assert.doesNotMatch(attachmentSharingLabel(true),/Alleen lokaal/);});

test('uploaded PDF and DOCX promise document checks at send time rather than claiming already read',()=>{
 for(const file of [{name:'facts.PDF'},{name:'facts.docx'},{name:'without-extension',type:'application/pdf'},{name:'without-extension',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}])assert.equal(liveAttachmentContentHint(file,{state:'ready',contentAccess:'file-only'}),'Documentcontrole bij verzending');
});
test('unknown binaries and unsupported images retain truthful limitations',()=>{
 assert.equal(liveAttachmentContentHint({name:'archive.zip'},{state:'ready',contentAccess:'file-only'}),'Alleen bestand');
 assert.equal(liveAttachmentContentHint({name:'image.svg'},{state:'ready',contentAccess:'unsupported'}),'Afbeeldingsinhoud niet ondersteund');
 assert.equal(liveAttachmentContentHint({name:'facts.pdf'},{state:'uploading',contentAccess:'file-only'}),'');
});

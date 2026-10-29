import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranscriptReader} from '../transcript-reader.js';
import {fixture} from './transcript-reader-fixture.mjs';

test('unread separator is the actual semantic navigation target and survives upstream growth',()=>{
 const f=fixture(),marker=f.field('DIV');marker.dataset={unreadDivider:'',rowKey:'unread-divider'};marker.offset=800;marker.height=16;
 marker.getBoundingClientRect=()=>({top:100+marker.offset-f.transcript.top,bottom:116+marker.offset-f.transcript.top,height:16});
 f.transcript.rows.push(marker);
 f.transcript.querySelectorAll=selector=>f.transcript.rows.filter(row=>row.dataset.messageId||selector.includes('data-unread-divider'));
 const reader=createTranscriptReader({...f,reducedMotion:()=>true});reader.afterRender();
 assert.ok(reader.navigateToTarget(()=>marker,{motion:'smooth'}),'the separator must be a real navigable row');
 assert.equal(f.transcript.top,558);
 assert.equal(reader.view().mode.rowId,'unread-divider');
 reader.beforeMutation();f.growAbove(120);reader.afterMutation();
 assert.equal(f.transcript.top,678);assert.equal(reader.view().mode.rowId,'unread-divider');reader.destroy();
});

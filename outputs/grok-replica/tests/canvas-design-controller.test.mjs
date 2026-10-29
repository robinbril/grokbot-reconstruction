import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasDesignController} from '../live-canvas-design.js';
import {canvasDesignMarkup} from '../live-canvas-design-view.js';
const selection={stack:[{kind:'element',name:'button',anchor:{line:2,column:15},props:{title:'Actual'}}],tag:'button',text:'Actual instance',rect:{x:1,y:2,width:30,height:40}};
function setup(){const sent=[],frameWindow={postMessage:(...args)=>sent.push(args)},c=createCanvasDesignController();c.bind({scope:'owner',canvasId:'one',revision:1,frameWindow});return {c,sent,frameWindow,message:(data,source=frameWindow)=>c.message({source,data})};}
test('only actual bound frame can advertise capability; picks require active design and bounded data',()=>{
 const {c,message,sent}=setup();assert.equal(canvasDesignMarkup(c.state(),String),'');assert.equal(message({type:'cursor-canvas-design-capable',sourceFile:'source.canvas.tsx'},{}),false);assert.equal(c.state().capable,false);
 assert.equal(message({type:'cursor-canvas-design-capable',sourceFile:'source.canvas.tsx'}),true);assert.equal(message({type:'cursor-canvas-design-picked',selection}),false);c.toggle();assert.equal(sent.at(-1)[0].enabled,true);
 assert.equal(message({type:'cursor-canvas-design-picked',selection:{...selection,rect:{...selection.rect,width:Infinity}}}),false);assert.equal(message({type:'cursor-canvas-design-picked',selection}),true);const html=canvasDesignMarkup(c.state(),String);assert.match(html,/role="toolbar"/);assert.match(html,/aria-current="true"/);assert.match(html,/source.canvas.tsx:2:15/);
 const chosen=c.take();assert.deepEqual(chosen.selection,selection);assert.equal(chosen.canvasId,'one');assert.equal(c.state().active,false);assert.equal(c.state().selection,null);assert.deepEqual(sent.at(-1),[{type:'cursor-canvas-design-mode',enabled:false},'*']);
});
test('old frame and inactive pane cannot retain selection across scope or actual revision frame replacement',()=>{
 const {c,message,frameWindow,sent}=setup();message({type:'cursor-canvas-design-capable',sourceFile:'source.canvas.tsx'});c.toggle();message({type:'cursor-canvas-design-picked',selection});const newer={postMessage(){}};c.bind({scope:'owner',canvasId:'one',revision:2,frameWindow:newer});assert.equal(c.state().capable,false);assert.equal(sent.at(-1)[0].enabled,false);
 assert.equal(c.message({source:frameWindow,data:{type:'cursor-canvas-design-capable',sourceFile:'old.tsx'}}),false);assert.equal(c.message({source:frameWindow,data:{type:'cursor-canvas-design-picked',selection}}),false);c.bind(null);assert.equal(c.take(),null);c.bind(null);
});
test('capability reannouncement clears pick while retaining active mode and breadcrumbs send only valid depths',()=>{
 const {c,message,sent}=setup();message({type:'cursor-canvas-design-capable',sourceFile:'source.canvas.tsx'});c.toggle();message({type:'cursor-canvas-design-picked',selection});assert.equal(c.select(1),false);assert.equal(c.select(-1),false);assert.equal(c.select(0),true);assert.deepEqual(sent.at(-1)[0],{type:'cursor-canvas-design-select',depth:0});
 message({type:'cursor-canvas-design-capable',sourceFile:'source.canvas.tsx'});assert.equal(c.state().selection,null);assert.equal(c.state().active,true);assert.equal(sent.at(-1)[0].enabled,true);c.destroy();assert.equal(sent.at(-1)[0].enabled,false);
});

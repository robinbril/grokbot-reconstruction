import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTranscriptEnd} from '../transcript-keyboard.js';

class Element {constructor(tagName='DIV',isContentEditable=false){this.tagName=tagName;this.isContentEditable=isContentEditable;}}
const cases=[
 {name:'plain End',target:new Element(),handles:true},
 {name:'Ctrl End',ctrlKey:true,target:new Element(),handles:true},
 {name:'Meta End',metaKey:true,target:new Element(),handles:true},
 {name:'Shift End',shiftKey:true,target:new Element(),handles:false},
 {name:'Alt End',altKey:true,target:new Element(),handles:false},
 {name:'other key',key:'Home',target:new Element(),handles:false},
 {name:'input',target:new Element('INPUT'),handles:false},
 {name:'textarea',target:new Element('TEXTAREA'),handles:false},
 {name:'editable descendant',target:new Element('SPAN',true),handles:false},
 {name:'noneditable descendant',target:new Element('SPAN'),handles:true},
 {name:'select remains native eligible',target:new Element('SELECT'),handles:true},
 {name:'non HTML target',target:{},handles:true},
];
for(const {name,handles,...options} of cases)test(`native transcript End eligibility: ${name}`,t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'HTMLElement');
 Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:Element});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'HTMLElement',previous);else delete globalThis.HTMLElement;});
 let navigations=0,prevented=0;
 const event={key:'End',shiftKey:false,altKey:false,...options,preventDefault(){prevented++;}};
 assert.equal(handleTranscriptEnd(event,()=>{navigations++;}),handles);
 assert.equal(navigations,Number(handles));assert.equal(prevented,Number(handles));
});

import {todoStatus,todoLabel} from './composer-todo.js';
import {iconsReady,iconSvg} from './icon-library.js';

export function todoGlyph(status){
 const normalized=todoStatus(status);if(!normalized||!iconsReady())return '';
 const name=normalized==='completed'?'check-circle':normalized==='cancelled'?'x-circle':'circle-dashed';
 return iconSvg(name,{size:12,filled:normalized==='completed'});
}
export function renderTodoReference(attrs,esc){
 if(typeof attrs.label!=='string'||!attrs.label.length)return '';
 const status=todoStatus(attrs.status),state=status?` data-todo-status="${status}"`:'';
 return `<span class="inline-todo-reference" data-type="todo-reference"${state} title="${esc(attrs.label)}"><span class="todo-reference-glyph" aria-hidden="true">${todoGlyph(status)}</span><span class="todo-reference-label">${esc(todoLabel(attrs.label))}</span></span>`;
}

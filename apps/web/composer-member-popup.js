import {computePosition,offset,flip,shift,size,autoUpdate} from './assets/vendor/composer-popup/floating-ui.js';

// Native0.71.2 RUe/nJ options; query DOMRange is the decoration-rect equivalent.
export function attachMemberPopup(menu,input,getRect){
 const owner=menu.ownerDocument,view=owner.defaultView;let destroyed=false,revision=0,lastRect=null;
 const reference={contextElement:input,getBoundingClientRect(){
  const rect=!destroyed&&input.isConnected?getRect():null;if(rect)lastRect=rect;
  return lastRect??new view.DOMRect();
 }};
 Object.assign(menu.style,{position:'fixed',left:'0px',top:'0px',bottom:'auto',zIndex:'2000'});
 owner.body.append(menu);
 async function update(){
  const current=++revision;if(destroyed||!input.isConnected)return;
  const rect=getRect();if(!rect)return;lastRect=rect;
  const result=await computePosition(reference,menu,{strategy:'fixed',placement:'bottom-start',middleware:[
   offset({mainAxis:6,crossAxis:-17}),flip({padding:8}),shift({padding:8}),
   size({padding:8,apply:({availableHeight})=>{if(!destroyed&&current===revision)menu.style.setProperty('--sand-suggestion-max-height',`${Math.max(0,Math.min(320,Math.floor(availableHeight)))}px`);}})
  ]});
  if(!destroyed&&current===revision){menu.style.left=`${Math.round(result.x)}px`;menu.style.top=`${Math.round(result.y)}px`;}
 }
 // Composer padding is animated; track the live query rect while it moves.
 const cleanup=autoUpdate(reference,menu,update,{animationFrame:true});
 // Keep explicit editor-scroll and viewport-resize updates.
 input.addEventListener('scroll',update,{passive:true});view.addEventListener('resize',update);
 return {update,destroy(){destroyed=true;revision++;cleanup();input.removeEventListener('scroll',update);view.removeEventListener('resize',update);}};
}

import {normalizeCanvasSelection,validCanvasSourceFile} from './composer-canvas-selection.js';
// Messages come from an opaque frame. Its exact WindowProxy, never its origin,
// binds a pick to the current saved resource and visible pane.
export function createCanvasDesignController({onChange=()=>{}}={}){
 let binding=null,sourceFile=null,active=false,selection=null;
 const send=message=>{if(binding?.frame?.isConnected!==false)binding?.frameWindow?.postMessage(message,'*');};
 const mode=enabled=>send({type:'cursor-canvas-design-mode',enabled});
 const state=()=>({capable:Boolean(sourceFile),active,sourceFile,selection:selection?structuredClone(selection):null});
 function bind(next){
  if(!binding&&!next)return;
  if(binding&&next&&binding.frameWindow===next.frameWindow&&binding.scope===next.scope&&binding.canvasId===next.canvasId&&binding.revision===next.revision)return;
  if(active)mode(false);binding=next;sourceFile=null;active=false;selection=null;onChange();
 }
 function message(event){
  if(!binding||!event.source||event.source!==binding.frameWindow||!event.data||typeof event.data!=='object')return false;
  if(event.data.type==='cursor-canvas-design-capable'&&validCanvasSourceFile(event.data.sourceFile)){
   sourceFile=event.data.sourceFile;selection=null;if(active)mode(true);onChange();return true;
  }
  if(event.data.type!=='cursor-canvas-design-picked'||!active)return false;
  const next=event.data.selection===null?null:normalizeCanvasSelection(event.data.selection);if(event.data.selection!==null&&!next)return false;
  selection=next;onChange();return true;
 }
 function toggle(){if(!sourceFile)return false;active=!active;selection=null;mode(active);onChange();return true;}
 function clear(){if(!selection)return;send({type:'cursor-canvas-design-clear'});selection=null;onChange();}
 function standDown(){if(!active&&!selection)return;if(active)mode(false);active=false;selection=null;onChange();}
 function take(){if(!sourceFile||!selection||!binding)return null;const result={canvasId:binding.canvasId,sourceFile,selection:structuredClone(selection),sourceRevision:binding.revision};mode(false);active=false;selection=null;onChange();return result;}
 function select(depth){if(!active||!selection||!Number.isSafeInteger(depth)||depth<0||depth>=selection.stack.length)return false;send({type:'cursor-canvas-design-select',depth});return true;}
 return {state,bind,message,toggle,clear,take,select,standDown,destroy(){if(active)mode(false);binding=null;sourceFile=null;active=false;selection=null;}};
}

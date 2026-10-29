// One seam for native textarea callers and the rich composer during migration.
const controllers=new WeakMap(),snapshots=new WeakMap();
export const composerController=input=>input?controllers.get(input):undefined;
export function bindComposerInput(input,controller){controllers.set(input,controller);return ()=>controllers.delete(input);}
export function readComposerInput(input){
 return composerController(input)?.getSnapshot()??snapshots.get(input)??{text:input?.value||'',references:[]};
}
export const composerText=input=>readComposerInput(input).text;
export function setComposerSnapshot(input,snapshot,options){
 const controller=composerController(input);
 if(controller)return controller.restore(snapshot,options);
 snapshots.set(input,snapshot);if('value' in input)input.value=snapshot.text;
 return true;
}
export function composerSelection(input){
 return composerController(input)?.getSelection()??{start:input?.selectionStart??0,end:input?.selectionEnd??0,direction:input?.selectionDirection||'none'};
}
export function setComposerSelection(input,start,end=start,direction='none'){
 const controller=composerController(input);
 if(controller)return controller.setSelection(start,end,direction);
 input?.setSelectionRange?.(start,end,direction);
}
export function replaceComposerText(input,text){
 const controller=composerController(input);
 if(controller)return controller.replaceText(text);
 if(input){input.value=text;snapshots.delete(input);return true;}
 return false;
}
export function composerQueryContext(input){
 const controller=composerController(input);if(controller)return controller.getQueryContext();
 return {text:composerText(input),...composerSelection(input)};
}
export const composerEventInput=target=>target?.id==='message-input'?target:target?.closest?.('#message-input');

import { createSourceMotion } from './product-source-motion.js';
import {createTranscriptReader} from './transcript-reader.js';
// Product lifecycle composition. Each surface owns its state, listeners and cleanup.
export function createProductSurfaces(host) {
  const modules=[];let destroyed=false;const sourceMotion=createSourceMotion();host.sourceMotion=sourceMotion;
  const captures=new WeakMap(),reader=createTranscriptReader({app:host.app,getConversationKey:host.getConversationKey,isGenerating:()=>modules.some(module=>module.isTranscriptGenerating?.()),reducedMotion:()=>sourceMotion.reduced});host.transcriptReader=reader;
  const releaseReduced=sourceMotion.onReducedMotion(value=>{host.mainMotion?.setReducedMotion(value);for(const m of modules)m.setReducedMotion?.(value);});
  const ready=sourceMotion.ready.then(()=>{if(!destroyed)afterRender({reason:'source-ready'});});
  function register(surface){if(surface)modules.push(surface);return surface;}
  function beforeRender(ctx={}){for(const m of modules)m.beforeTranscriptCapture?.(ctx);const tokens=captures.get(ctx)||[];tokens.push(reader.beforeRender(ctx));captures.set(ctx,tokens);for(const m of modules)m.beforeRender?.(ctx);}
  function afterRender(ctx={}){if(destroyed)return;for(const m of modules)m.afterRender?.(ctx);sourceMotion.bindTree(host.app);sourceMotion.bindTree(host.overlay);const tokens=captures.get(ctx),renderToken=tokens?.pop();if(tokens&&!tokens.length)captures.delete(ctx);reader.afterRender({...ctx,renderToken});for(const m of modules)m.afterTranscriptReconcile?.(ctx);}
  function renderSlot(name,ctx={}){for(const m of modules){const result=m.renderSlot?.(name,ctx);if(result!==undefined&&result!==null)return result;}return undefined;}
  function dispatch(method,ctx,index=0){
    for(let i=index;i<modules.length;i++){
      const result=modules[i][method]?.(ctx);
      if(result&&typeof result.then==='function')return result.then(handled=>{if(handled){afterRender({reason:method,action:ctx.action});return true;}return dispatch(method,ctx,i+1);});
      if(result){afterRender({reason:method,action:ctx.action});return true;}
    }
    return false;
  }
  function handleAction(ctx){return dispatch('handleAction',ctx);}
  function handleKeyDown(event){for(const m of modules)if(m.handleKeyDown?.(event))return true;return false;}
  function handleSubmit(ctx){return dispatch('handleSubmit',ctx);}
  function handleInput(event){for(const m of modules)m.handleInput?.(event);}
  function handleChange(event){for(const m of modules)m.handleChange?.(event);sourceMotion.bindTree(host.overlay);}
  function beforeDialogChange(ctx){for(const m of modules)m.beforeDialogChange?.(ctx);}
  function afterDialogChange(ctx){for(const m of modules)m.afterDialogChange?.(ctx);sourceMotion.bindTree(host.overlay);}
  function setInspect(value){sourceMotion.setInspect(value);host.mainMotion?.setInspect(value);for(const m of modules)m.setInspect?.(value);}
  function setReducedMotion(value){sourceMotion.setReducedMotion(value);}
  function destroy(){destroyed=true;releaseReduced();for(const m of [...modules].reverse())m.destroy?.();sourceMotion.destroy();reader.destroy();}
  return {register,ready,beforeRender,afterRender,renderSlot,handleAction,handleKeyDown,handleSubmit,handleInput,handleChange,beforeDialogChange,afterDialogChange,setInspect,setReducedMotion,destroy,sourceMotion,diagnostics:()=>({modules:modules.map(m=>({id:m.id,...m.diagnostics?.()})),reader:reader.view(),source:sourceMotion.diagnostics()})};
}

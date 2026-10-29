// Independent reconstruction of the pinned flowing-text state machine. Inputs are
// actual local computation snapshots; no target module or synthetic model is run.
const whitespace=text=>/^\s+$/u.test(text);
function segments(text,locale='nl'){
  if(!text)return[];
  if(typeof Intl.Segmenter!=='function')return text.split(/(\s+)/u).filter(Boolean).map(text=>({text,isWord:!whitespace(text)}));
  const result=[];let prefix='';
  for(const item of new Intl.Segmenter(locale,{granularity:'word'}).segment(text)){
    const part={text:item.segment,isWord:item.isWordLike===true};
    if(whitespace(part.text)){if(prefix){result.push({text:prefix,isWord:false});prefix='';}result.push(part);}
    else if(part.isWord){result.push({text:prefix+part.text,isWord:true});prefix='';}
    else if(result.at(-1)?.isWord)result[result.length-1]={text:result.at(-1).text+part.text,isWord:true};
    else prefix+=part.text;
  }
  if(prefix){if(result.at(-1)?.isWord)result[result.length-1]={text:result.at(-1).text+prefix,isWord:true};else result.push({text:prefix,isWord:false});}
  return result;
}
const settled=tokens=>tokens.map(token=>token.animate||token.delayMs?{...token,animate:false,delayMs:0}:token);
function batch(parts,generation,animate){let delay=0;return parts.map(part=>{const active=animate&&!whitespace(part.text),token={...part,generation,animate:active,delayMs:active?delay:0};if(active)delay+=50;return token;});}
export function advanceFlow(previous,text,{locale='nl',settle=false}={}){
  if(text===previous.text)return settle?{...previous,tokens:settled(previous.tokens)}:previous;
  const replacement=(generation,animate)=>({text,generation,tokens:batch(segments(text,locale),generation,animate)});
  if(previous.text&&previous.text.trim()===text.trim())return replacement(previous.generation,false);
  if(settle)return replacement(text.startsWith(previous.text)?previous.generation:previous.generation+1,false);
  if(!text.startsWith(previous.text))return replacement(previous.generation+1,true);
  const last=previous.tokens.at(-1);if(!last)return replacement(previous.generation,true);
  const suffix=text.slice(previous.text.length);
  if(!last.isWord)return{text,generation:previous.generation,tokens:[...settled(previous.tokens),...batch(segments(suffix,locale),previous.generation,true)]};
  const parts=segments(last.text+suffix,locale),first=parts[0];if(!first)return{...previous,text};
  const extended={...last,text:first.text,isWord:first.isWord};
  return{text,generation:previous.generation,tokens:parts.length===1?[...previous.tokens.slice(0,-1),extended]:[...settled([...previous.tokens.slice(0,-1),extended]),...batch(parts.slice(1),previous.generation,true)]};
}
export function createFlowingText(host){
  const states=new Map();
  function render(root,text,{live=true}={}){
    let record=states.get(root);if(!record){record={flow:{text:'',generation:0,tokens:[]},nodes:new Map()};states.set(root,record);}
    record.flow=advanceFlow(record.flow,text,{settle:!live||host.sourceMotion.reduced});
    if(host.sourceMotion.reduced){for(const a of root.getAnimations({subtree:true}))a.cancel();root.textContent=text;record.nodes.clear();return[];}
    root.dataset.flowingText='';const next=new Map(),nodes=[];
    for(const[tokenIndex,token]of record.flow.tokens.entries()){
      const key=`${token.generation}-${tokenIndex}`;let node=record.nodes.get(key);if(!node)node=document.createElement('span');
      node.textContent=token.text;node.classList.add('sand-1hc1fzr','sand-5hlk9d');node.dataset.flowingAnimate=token.animate?'on':'off';node.dataset.flowingDelayMs=String(token.delayMs);node.toggleAttribute('data-flowing-word',token.isWord);node.toggleAttribute('data-flowing-mark',!token.isWord);
      if(token.animate){if(!node.hasAttribute('data-source-instance'))host.sourceMotion.bind(node,'INSTANCE-246');node.style.setProperty('--x-animationDelay',`${token.delayMs}ms`);node.style.animationDelay=`${token.delayMs}ms`;}
      else{if(node.hasAttribute('data-source-instance')){for(const a of node.getAnimations())a.cancel();host.sourceMotion.unbind(node,'INSTANCE-246');}node.style.animationDelay='0ms';node.style.removeProperty('--x-animationDelay');}
      next.set(key,node);nodes.push(node);
    }
    for(const[key,node]of record.nodes)if(!next.has(key)){for(const a of node.getAnimations())a.cancel();node.remove();}
    // Existing connected tokens keep their actual animation object on append.
    for(let i=0;i<nodes.length;i++){const node=nodes[i],at=root.childNodes[i];if(node!==at){if(node.isConnected)root.moveBefore(node,at||null);else root.insertBefore(node,at||null);}}
    while(root.childNodes.length>nodes.length)root.lastChild.remove();record.nodes=next;
    host.sourceMotion.bindTree(root);return root.getAnimations({subtree:true});
  }
  function dispose(root){if(!root)return;for(const a of root.getAnimations({subtree:true}))a.cancel();states.delete(root);}
  const release=host.sourceMotion.onReducedMotion?.(value=>{if(value)for(const[root,record]of states)render(root,record.flow.text,{live:false});});
  return{render,dispose,destroy(){release?.();for(const root of states.keys())dispose(root);}};
}

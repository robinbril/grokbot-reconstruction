// Native 0.71.2 matcher/ranking, independently implemented from E01–E04.
let index=null,promise=null;
export function composerEmojiToken(text,start,end=start){
 if(typeof text!=='string'||start!==end||start<0||start>text.length)return null;
 const before=text.slice(Math.max(0,start-200),start),after=text.slice(start).match(/^[a-z0-9_+-]*/u)[0];
 const match=(before+after).match(/(^|[^\p{L}\p{N}_:/])(:([a-z0-9_+-]{0,50}))$/u);
 if(!match||!match[3].length)return null;
 const from=start-before.length+match.index+match[1].length,to=from+match[2].length;
 return from<start&&to>=start?{start:from,end:to,query:match[3]}:null;
}
export function emojiCompletion(text,caret,previous=[]){
 const before=text.slice(Math.max(0,caret-60),caret);
 const match=before.match(/(^|[^\p{L}\p{N}_:/])(:([a-z0-9_+-]{1,50}))$/u);
 if(match)return {start:caret-match[2].length,end:caret+1,shortcode:match[3]};
 for(const predecessor of previous){
  const tail=text.slice(predecessor.end,caret),chain=tail.match(/^:([a-z0-9_+-]{1,50})$/u);
  if(chain)return {start:predecessor.end,end:caret+1,shortcode:chain[1],predecessor:predecessor.id};
 }
 return null;
}
export function searchComposerEmoji(entries,query,recents=[],limit=96){
 const needle=query.trim().toLowerCase();if(!needle)return [];
 const strong=[],weak=[],rank=new Map();recents.forEach((id,i)=>{if(!rank.has(id))rank.set(id,i);});
 for(const entry of entries){
  if(!entry.search.includes(needle))continue;
  const name=entry.name.toLowerCase();
  const bucket=entry.id.startsWith(needle)||entry.shortcodes.some(code=>code.startsWith(needle))||name.startsWith(needle)||name.includes(' '+needle)?strong:weak;
  bucket.push(entry);
 }
 const order=(a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity);
 return [...strong.sort(order),...weak.sort(order)].slice(0,limit);
}
export function composerEmojiIndex(){return index;}
export function loadComposerEmojiIndex(){
 if(index)return Promise.resolve(index);
 if(!promise)promise=fetch(new URL('./assets/vendor/emoji/index.json',import.meta.url)).then(response=>{
  if(!response.ok)throw Error('Emoji-index kon niet worden geladen.');return response.json();
 }).then(entries=>{
  if(!Array.isArray(entries)||!entries.every(entry=>typeof entry.id==='string'&&typeof entry.native==='string'&&typeof entry.name==='string'&&typeof entry.search==='string'&&Array.isArray(entry.shortcodes)))throw Error('Ongeldige emoji-index.');
  const aliases=new Map();for(const entry of entries)for(const code of entry.shortcodes)if(!aliases.has(code))aliases.set(code,entry);
  index={entries,aliases};return index;
 }).catch(error=>{promise=null;throw error;});
 return promise;
}

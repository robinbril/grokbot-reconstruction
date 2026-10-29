import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {composerEmojiToken,emojiCompletion,searchComposerEmoji} from '../composer-emoji-index.js';
const entries=JSON.parse(await readFile(new URL('../assets/vendor/emoji/index.json',import.meta.url),'utf8'));
test('native data keeps all 3944 ordered entries and first shortcode identity',()=>{
 assert.equal(entries.length,3944);assert.equal(searchComposerEmoji(entries,'smile')[0].id,'smiley');
 assert.equal(searchComposerEmoji(entries,'smile',['smile','smiley','smile'])[0].id,'smile');
 const aliases=new Map();for(const entry of entries)for(const code of entry.shortcodes)if(!aliases.has(code))aliases.set(code,entry);
 assert.equal(aliases.get('smile').native,'😄');assert.equal(aliases.get('thumbsup').native,'👍');
 assert.ok(entries.some(entry=>entry.native==='👍🏻'));
});
test('native bounded matcher includes right continuation and rejects forbidden prefixes or uppercase',()=>{
 for(const prefix of ['word','é','1','_',':','/'])assert.equal(composerEmojiToken(prefix+':smile',prefix.length+6),null);
 assert.equal(composerEmojiToken(':',1),null);assert.equal(composerEmojiToken(':Smile',6),null);
 assert.equal(composerEmojiToken(':'+ 'a'.repeat(51),52),null);
 assert.equal(composerEmojiToken(':'+ 'a'.repeat(50),51).query.length,50);
 assert.deepEqual(composerEmojiToken('(:thumbsup',6),{start:1,end:10,query:'thumbsup'});
 assert.equal(composerEmojiToken(':smile',3,4),null);
});
test('ranking preserves strong bucket precedence over recent weak matches, stable order and limit96',()=>{
 const source=Array.from({length:120},(_,i)=>({id:`q${i}`,name:'Query',shortcodes:[`q${i}`],search:'query'}));
 source.unshift({id:'other',name:'Other',shortcodes:['other'],search:'aquery'});
 const ranked=searchComposerEmoji(source,'q',['other','q2','q2']);
 assert.equal(ranked.length,96);assert.equal(ranked[0].id,'q2');assert.equal(ranked[1].id,'q0');assert.equal(ranked.some(entry=>entry.id==='other'),false);
});
test('closed shortcode matcher handles only valid predecessor chains',()=>{
 assert.deepEqual(emojiCompletion(' :smile',7),{start:1,end:8,shortcode:'smile'});
 const id=Symbol();assert.deepEqual(emojiCompletion(':smile::thumbsup',16,[{id,end:7}]),{start:7,end:17,shortcode:'thumbsup',predecessor:id});
 assert.equal(emojiCompletion(':smile::thumbsup',16),null);assert.equal(emojiCompletion(':Smile',6),null);
});

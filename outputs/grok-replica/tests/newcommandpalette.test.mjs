import test from 'node:test';
import assert from 'node:assert/strict';
import {paletteCommands,filterPaletteCommands,paletteShortcut} from '../command-palette.js';
const state={agents:[{id:'one',name:'REA Synthetische Bot'},{id:'hidden',name:'Verborgen'}],hidden:['hidden'],theme:'system'};
test('unified registry includes visible Bots and actual native destinations',()=>{
 const commands=paletteCommands(state);
 assert.deepEqual(commands.map(row=>row.id),['bot:one','new-bot','new-group-chat','settings:general','settings:computer','settings:usage','settings:updates','overlay:plugins','theme:system','theme:light','theme:dark']);
 assert.deepEqual(commands.filter(row=>row.active).map(row=>row.id),['theme:system']);
});
test('theme search exposes precisely three choices and source keywords work',()=>{
 const commands=paletteCommands(state);
 assert.deepEqual(filterPaletteCommands(commands,'theme').map(row=>row.id),['theme:system','theme:light','theme:dark']);
 assert.equal(filterPaletteCommands(commands,'NIGHT')[0].id,'theme:dark');
 assert.equal(filterPaletteCommands(commands,'synthetische')[0].id,'bot:one');
 assert.equal(filterPaletteCommands(commands,'connectors')[0].id,'overlay:plugins');
 assert.deepEqual(filterPaletteCommands(commands,'unfindable'),[]);
});
test('Cmd K toggles palette and Cmd Shift F preserves separate bot search even in editors',()=>{
 const key=(key,extra={})=>({key,metaKey:true,...extra});
 assert.equal(paletteShortcut(key('k')),'palette');
 assert.equal(paletteShortcut(key('F',{shiftKey:true})),'search');
 assert.equal(paletteShortcut(key('n')),null);
 assert.equal(paletteShortcut(key('k',{metaKey:false})),null);
 assert.equal(paletteShortcut(key('k',{isComposing:true})),null);
});
test('page registry exposes saved workspace pages, with independent Pages filtering',()=>{
 const commands=paletteCommands({...state,workspaceDocuments:[{id:'rea-page',title:'REA Pagina',html:'<p>Synthetisch</p>'}]});
 assert.equal(commands.find(row=>row.id==='page:rea-page').label,'REA Pagina');
 assert.deepEqual(filterPaletteCommands(commands,'','pages').map(row=>row.id),['page:rea-page']);
 assert.equal(filterPaletteCommands(commands,'theme','pages').length,0);
});
test('malformed optional document storage does not break command palette',()=>{
 assert.doesNotThrow(()=>paletteCommands({...state,workspaceDocuments:{}}));
});

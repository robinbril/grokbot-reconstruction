import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createReaderState,reduceReaderState,readerView} from '../transcript-reader-state.js';
const rows=()=>Array.from({length:10},(_,i)=>({rowId:'r'+i,topPx:i*200,heightPx:200}));
const geometry=(extra={})=>({scrollTopPx:1500,viewportHeightPx:500,totalSizePx:2000,rows:rows(),epochId:'same',...extra});
const observe=(state,g,extra={})=>reduceReaderState(state,{type:'geometry',geometry:g,source:'options',nowMs:0,...extra});
function mounted(){let result=observe(createReaderState(),geometry({scrollTopPx:0}));result=reduceReaderState(result.state,{type:'write-applied',generation:result.state.generation,scrollTopPx:1500});return observe(result.state,geometry(),{source:'scroll'}).state;}
function readerAway(away){let state=reduceReaderState(mounted(),{type:'input',kind:'scroll',direction:-1,nowMs:1000}).state;return observe(state,geometry({scrollTopPx:1500-away}),{source:'scroll',nowMs:1010}).state;}
for(const away of [1,60])test(`preserves actual native ${away}px released reading on streaming growth`,()=>{
 const state=readerAway(away);assert.equal(state.mode.kind,'anchored');assert.equal(readerView(state).isPinnedToBottom,false);
 const grown=observe(state,geometry({scrollTopPx:1500-away,totalSizePx:2100,rows:[...rows(),{rowId:'new',topPx:2000,heightPx:100}]}),{cause:'stream-delta',isGenerating:true,nowMs:1300});
 assert.equal(grown.effect,undefined);assert.equal(grown.state.geometry.scrollTopPx,1500-away);assert.deepEqual(grown.state.mode,state.mode);
});
test('quiet anchored reader inside4px does not silently repin',()=>{
 const state=readerAway(1),result=observe(state,geometry({scrollTopPx:1499}),{nowMs:3000});assert.equal(result.state.mode.kind,'anchored');assert.equal(result.effect,undefined);
});
test('explicit latest overrides released anchor, then growth follows after quiet input',()=>{
 let result=reduceReaderState(readerAway(60),{type:'bottom',geometry:geometry({scrollTopPx:1440}),nowMs:1400});assert.equal(result.effect.motion,'instant');assert.equal(result.effect.topPx,1500);
 result=observe(result.state,geometry({totalSizePx:2100,rows:[...rows(),{rowId:'new',topPx:2000,heightPx:100}]}),{cause:'stream-delta',nowMs:1400});assert.equal(result.effect.topPx,1600);assert.equal(result.state.mode.kind,'pinned-bottom');
});
test('actual upward input without physical movement defers correction until quiet',()=>{
 const state=reduceReaderState(mounted(),{type:'input',kind:'scroll',direction:-1,nowMs:1000}).state;
 const grown=geometry({totalSizePx:2100});const held=observe(state,grown,{nowMs:1010,cause:'stream-delta'});assert.equal(held.effect,undefined);assert.equal(held.state.deferred,true);assert.equal(held.state.mode.kind,'pinned-bottom');
 const quiet=observe(held.state,grown,{nowMs:1251,source:'input-quiet'});assert.equal(quiet.effect.topPx,1600);
});
test('owned correction receipt survives writes until scroll observation and rejects stale generation',()=>{
 const result=reduceReaderState(readerAway(60),{type:'bottom',geometry:geometry({scrollTopPx:1440}),nowMs:1500});
 const stale=reduceReaderState(result.state,{type:'write-applied',generation:result.state.generation-1,scrollTopPx:10});assert.equal(stale.state,result.state);
 const written=reduceReaderState(result.state,{type:'write-applied',generation:result.state.generation,scrollTopPx:1500}).state;assert.equal(written.programmatic.kind,'awaiting-observation');
 const echoed=observe(written,geometry(),{source:'scroll',nowMs:1501});assert.equal(echoed.state.pinResolution.attribution.kind,'programmatic');assert.equal(echoed.state.mode.kind,'pinned-bottom');assert.equal(echoed.state.programmatic.kind,'idle');
});
test('fractional bottom drift below1px does not cause a correction',()=>{
 let state=mounted();state={...state,geometry:geometry({scrollTopPx:6132.5,totalSizePx:7006,viewportHeightPx:874})};
 const result=observe(state,state.geometry);assert.equal(result.effect,undefined);assert.equal(result.state.geometry.scrollTopPx,6132.5);assert.equal(readerView(result.state).distanceFromBottomPx,0);
});
test('width epoch and viewport resize retain a surviving released anchor',()=>{
 const state=readerAway(60),result=observe(state,geometry({scrollTopPx:1440,viewportHeightPx:450,epochId:'new-width'}),{nowMs:1300});assert.equal(result.state.mode.kind,'anchored');assert.equal(result.effect,undefined);
});
test('released anchor compensates above-reader growth even while streaming',()=>{
 const state=readerAway(60),shifted=rows().map(row=>({...row,topPx:row.topPx+100}));
 const result=observe(state,geometry({scrollTopPx:1440,totalSizePx:2100,rows:shifted}),{cause:'stream-delta',isGenerating:true,nowMs:1300});assert.equal(result.effect.topPx,1540);assert.equal(result.state.mode.rowId,state.mode.rowId);
});
test('deleted anchor releases honestly without an invented surviving-row policy',()=>{
 const state=readerAway(60),next=rows().filter(row=>row.rowId!==state.mode.rowId);
 const result=observe(state,geometry({scrollTopPx:1440,rows:next}),{nowMs:1300});assert.equal(result.state.mode.kind,'free');assert.equal(result.effect,undefined);
});
test('navigation ownership refuses latest until cancellation and follow suspension blocks writes',()=>{
 const state=reduceReaderState(mounted(),{type:'navigation',active:true}).state;
 assert.equal(reduceReaderState(state,{type:'bottom',geometry:geometry(),nowMs:0}).accepted,false);
 const cancelled=reduceReaderState(state,{type:'input',kind:'scroll',direction:-1,nowMs:1}).state;assert.equal(cancelled.navigation.kind,'idle');assert.equal(cancelled.mode.kind,'free');
 const suspended=reduceReaderState(mounted(),{type:'follow',kind:'suspended'}).state;assert.equal(observe(suspended,geometry({totalSizePx:2100})).effect,undefined);
});

const evidence=JSON.parse(fs.readFileSync(new URL('./transcript-reader-native.json',import.meta.url),'utf8')).records;
const source=id=>evidence.find(row=>row.id===id).excerpt;
const native=vm.createContext({ye:1,yp:{kind:'undirected'},lI:Number.MAX_SAFE_INTEGER});
vm.runInContext(['kp','pI','wp','mI','gI','bp'].map(source).join(';'),native);
const cases=[
 {top:1499,input:-1,ms:250,scroll:true}, {top:1499,input:-1,ms:251,scroll:true},
 {top:1440,input:-1,ms:10,scroll:true}, {top:1440,scroll:true},
 {top:1496}, {top:1495.999}, {top:0,input:-1,ms:10},
 {top:1440,input:-1,ms:10,scroll:true,programmatic:true},
 {top:1400,total:1900,input:-1,ms:10,scroll:true}, {top:1440,height:600,scroll:true},
 {top:1499,held:true,ms:10000,scroll:true}, {top:1499,anchored:true},
];
for(const [i,c]of cases.entries())test(`native pin differential ${i+1}`,()=>{
 const input=c.held?{kind:'pointer-held',lastInputAtMs:0,direction:0,input:{kind:'undirected'}}:c.input?{kind:'recent',lastInputAtMs:1000-(c.ms??1000),direction:c.input,input:{kind:'scroll',direction:c.input}}:{kind:'idle'};
 const previous=geometry(),g=geometry({scrollTopPx:c.top,totalSizePx:c.total??2000,viewportHeightPx:c.height??500});
 const state={...mounted(),mode:c.anchored?{kind:'anchored',rowId:'r7',edgeOffsetPx:-99}:{kind:'pinned-bottom'},input,geometry:previous,programmatic:c.programmatic?{kind:'awaiting-observation',targetScrollTopPx:c.top}:{kind:'idle'}};
 const actual=observe(state,g,{source:c.scroll?'scroll':'options',nowMs:1000});
 const expected=native.bp({isReady:true,isScrolling:Boolean(c.scroll),clampedOffset:Math.max(0,Math.min(c.top,g.totalSizePx-g.viewportHeightPx)),lastObservedScrollOffset:1500,totalHeight:g.totalSizePx,lastObservedTotalHeight:2000,viewportHeight:g.viewportHeightPx,lastObservedViewportHeight:500,isProgrammaticScrollActive:Boolean(c.programmatic),nearBottomThresholdPx:4,msSinceUserScrollInput:c.held?1000:c.input?c.ms:Number.MAX_SAFE_INTEGER,userInputWindowMs:250,isUserPointerDown:Boolean(c.held),userInput:c.input?{kind:'scroll',direction:c.input}:{kind:'undirected'},allowAutomaticRelatch:!c.anchored,allowScrollRangeClosedRelatch:true});
 assert.deepEqual(JSON.parse(JSON.stringify(actual.state.pinResolution.event)),JSON.parse(JSON.stringify(expected.event)));assert.deepEqual(JSON.parse(JSON.stringify(actual.state.pinResolution.attribution)),JSON.parse(JSON.stringify(expected.attribution)));
});

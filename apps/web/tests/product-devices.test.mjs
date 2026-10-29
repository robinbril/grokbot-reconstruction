import test from 'node:test';
import assert from 'node:assert/strict';
import {devicePanelMarkup} from '../product-devices.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('device panel only renders real devices and escapes labels and pairing credentials',()=>{
 const markup=devicePanelMarkup({esc,devices:{devices:[{id:'one',label:'<img onerror=alert(1)>',current:true}]},pairing:{code:'<script>',expiresAt:Date.now()+10000}});
 assert.match(markup,/&lt;img/);assert.match(markup,/&lt;script&gt;/);assert.doesNotMatch(markup,/<img|<script/);assert.match(markup,/Dit apparaat/);assert.match(markup,/Toegang intrekken/);assert.match(markup,/readonly/);
});
test('pending and failed requests communicate actual state without inventing connection success',()=>{
 const pending=devicePanelMarkup({esc,busy:true});assert.match(pending,/aria-busy="true"/);assert.match(pending,/disabled/);assert.doesNotMatch(pending,/Verbonden/);
 const error=devicePanelMarkup({esc,error:'Server <niet bereikbaar>'});assert.match(error,/Server &lt;niet bereikbaar&gt;/);assert.match(error,/role="alert"/);assert.doesNotMatch(error,/Verbonden/);
});

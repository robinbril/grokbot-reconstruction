import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePRCandidateURL,extractPRCandidates,classifyPRLink,collectPRCandidates,resolvePRLabel} from '../pr-reference.js';
const github='https://github.com/example/project/pull/42';
const doc=content=>JSON.stringify({type:'doc',content:[{type:'paragraph',content}]});

test('native context URL candidates accept actual suffixes and strip only terminal punctuation',()=>{
 assert.deepEqual(parsePRCandidateURL(github+'/files?x=1#diff'),{prNumber:42,url:github+'/files?x=1#diff'});
 assert.equal(parsePRCandidateURL('https://www.cursor.com/codebase/A/B/pull/0007')?.prNumber,7);
 assert.deepEqual(extractPRCandidates(`See (${github}!), then ${github+'/files'}.`),[{prNumber:42,url:github,title:null},{prNumber:42,url:github+'/files',title:null}]);
 for(const url of ['javascript:alert(1)','https://github.com.evil.test/a/b/pull/42','https://github.com/a/b/issues/42','https://github.com/a/b/pull/0'])assert.equal(parsePRCandidateURL(url),null,url);
});

test('markdown GitHub pills require empty or slash suffix including search and hash',()=>{
 for(const suffix of ['','/'])assert.deepEqual(classifyPRLink(github+suffix),{kind:'github',prNumber:42,href:github+suffix});
 assert.equal(classifyPRLink('http://www.github.com/a/b/pull/0042')?.prNumber,42);
 for(const suffix of ['/files','?tab=files','#review','/?tab=files','/commits/abc'])assert.equal(classifyPRLink(github+suffix),null,suffix);
});

test('Origin markdown links use exact HTTPS hosts and canonical identity, independently of candidate URLs',()=>{
 const href='https://cursor.com/codebase/Owner/Repository/pull/42?view=all#review';
 assert.deepEqual(classifyPRLink(href),{kind:'origin',prNumber:42,href,canonicalOriginUrl:'https://cursor.com/codebase/owner/repository/pull/42'});
 assert.equal(classifyPRLink('https://staging.cursor.com/codebase/a/b/pull/4/')?.kind,'origin');
 for(const url of ['http://cursor.com/codebase/a/b/pull/4','https://www.cursor.com/codebase/a/b/pull/4','https://cursor.com:444/codebase/a/b/pull/4','https://cursor.com/codebase/a/b/pull/04','https://cursor.com/codebase/a/b/pull/4/files'])assert.equal(classifyPRLink(url),null,url);
});

test('current transcript candidate order is newest-first with higher-priority nodes retained in place',()=>{
 const rows=[{richText:doc([{type:'prReference',attrs:{prNumber:'42',title:' Actual title ',url:github}}])},
  {text:github+'/files'},
  {richText:doc([{type:'text',text:'actual link',marks:[{type:'link',attrs:{href:'https://github.com/other/repo/pull/7'}}]}])}];
 const result=collectPRCandidates(rows);
 assert.deepEqual([...result.keys()],[7,42]);assert.equal(result.get(42).title,'Actual title');assert.equal(result.get(42).url,github);
 assert.equal(resolvePRLabel(classifyPRLink(github),result),'#42 · Actual title');
 assert.equal(resolvePRLabel(classifyPRLink('https://github.com/different/repo/pull/42'),result),'#42');
 assert.equal(collectPRCandidates([{richText:'invalid',text:github}]).get(42).url,github);
 assert.equal(collectPRCandidates([]).size,0);
});

test('native context deduplicates by number and absent cloud data never creates metadata',()=>{
 const result=collectPRCandidates([{text:github},{text:'https://github.com/other/repo/pull/42'},{kind:'send-message',message:{type:'cursor-agent',bcId:'synthetic'}}]);
 assert.equal(result.size,1);assert.equal(result.get(42).url,'https://github.com/other/repo/pull/42');assert.equal(result.get(42).title,null);
 const rich={type:'doc',content:[]};let next=rich;for(let i=0;i<1000;i++){const child={type:'paragraph',content:[]};next.content.push(child);next=child;}
 assert.doesNotThrow(()=>collectPRCandidates([{richText:JSON.stringify(rich),text:github}]));
});

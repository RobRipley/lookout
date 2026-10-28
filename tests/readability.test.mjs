import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionsFor, explainText } from '../src/readability.js';

test('contextual card definitions override board and general definitions without leaking to another card', () => {
 const glossary=[{term:'R1',definition:'Board meaning'},{term:'R1',definition:'Exact card meaning',cardId:['CARD-1']},{term:'hash',definition:'Scoped fingerprint',cardId:['CARD-1']}];
 assert.equal(definitionsFor(glossary,'CARD-1').find(x=>x.term==='R1').definition,'Exact card meaning');
 assert.equal(definitionsFor(glossary,'OTHER').find(x=>x.term==='R1').definition,'Board meaning');
 assert.notEqual(definitionsFor(glossary,'OTHER').find(x=>x.term==='hash').definition,'Scoped fingerprint');
});
test('longest literal match wins and technical version numbers have boundaries', () => {
 const defs=[{term:'R1',definition:'First version'},{term:'full-r1',definition:'Full release'},{term:'ref42',definition:'An author-defined identifier'}].sort((a,b)=>b.term.length-a.term.length);
 const text='R1 R10 full-r1 ref42 ref4200 xR1';
 const tokens=explainText(text,defs);
 assert.equal(tokens.map(x=>x.text).join(''),text);
 assert.deepEqual(tokens.filter(x=>x.definition).map(x=>x.text),['R1','full-r1','ref42']);
});
test('unknown identifiers remain plain text rather than invented definitions', () => {
 const tokens=explainText('ref42 check7 R1',definitionsFor([], 'CARD-1'));
 assert.deepEqual(tokens,[{text:'ref42 check7 R1'}]);
});
test('definitions are literal text and preserve punctuation, spacing and HTML-looking source', () => {
 const text='<img src=x> ABI(8) and a+b; check7.';
 const tokens=explainText(text,[{term:'a+b',definition:'Literal regex-looking term'},{term:'check7',definition:'seven checks'}]);
 assert.equal(tokens.map(x=>x.text).join(''),text);
 assert.deepEqual(tokens.filter(x=>x.definition).map(x=>x.text),['a+b','check7']);
});

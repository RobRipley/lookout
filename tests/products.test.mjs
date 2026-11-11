import test from 'node:test';
import assert from 'node:assert/strict';
import {productProjects, otherProductBoards, productFocus, priorityInput, productFreshness} from '../src/products.js';
const boards = ['z','a','b','outside'].map(id=>({data:{projectId:id,title:id}}));
const product={data:{projectIds:['a','b','z','missing']},items:[{projectId:'z',status:'blocked',blockedReason:'Waiting',nextAction:'Ask'},{projectId:'b',status:'ready',blockedReason:'',nextAction:'Build'}]};
test('product projects retain published ranking and append unranked membership alphabetically',()=>{assert.deepEqual(productProjects(product,boards).map(p=>[p.projectId,p.rank]),[['z',1],['b',2],['a',null]]);});
test('membership does not invent status, actions, or actionable focus',()=>{const empty={...product,items:[]};assert.equal(productFocus(empty,boards),null);assert.equal(productProjects(empty,boards)[0].status,'');assert.equal(productProjects(empty,boards)[0].nextAction,'');});
test('highest actionable focus skips blocked projects and unranked membership',()=>{assert.equal(productFocus(product,boards).projectId,'b');assert.equal(productFocus({...product,items:[{projectId:'z',status:'ready',blockedReason:'External dependency'}]},boards),null);});
test('unassigned projects remain available in Other projects, multiple membership is supported',()=>{assert.deepEqual(otherProductBoards([product,{data:{projectIds:['a']}}],boards).map(b=>b.data.projectId),['outside']);});
test('new ranking requires explicit action and safe field defaults',()=>{assert.deepEqual(priorityInput({projectId:'a'}),{projectId:'a',status:'ready',blockedReason:'',nextAction:''});});
const NOW = Date.UTC(2026, 10, 10, 12), ns = ms => BigInt(ms) * 1000000n, H = 3600000;
test('product freshness is fresh within 24h and stale beyond it',()=>{
  assert.equal(productFreshness(ns(NOW - 24*H), NOW).state,'fresh');
  assert.equal(productFreshness(ns(NOW - 24*H - 1), NOW).state,'stale');
  assert.equal(productFreshness(ns(NOW - 5*H), NOW).label,'Updated 5h ago');
  assert.equal(productFreshness(ns(NOW - 49*H), NOW).label,'Updated 2d ago');
  assert.equal(productFreshness(ns(NOW), NOW).label,'Updated just now');
});
test('product freshness never reports missing or invalid timestamps as fresh',()=>{
  for (const bad of [undefined,null,0n,-1n,'abc','',NaN,Infinity,{},[],1.5,ns(NOW + 24*H)]) assert.equal(productFreshness(bad, NOW).state,'unknown',String(bad));
  assert.equal(productFreshness(ns(NOW), NaN).state,'unknown');
  assert.equal(productFreshness(ns(NOW + 60000), NOW).state,'fresh');
});

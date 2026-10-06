const {test}=require('node:test');
const assert=require('node:assert/strict');
const {context,bestInsertion,distanceToLine}=require('../route-efficiency.js');
const p=x=>({lat:0,lon:x});
const leg=(a,b)=>({mi:Math.abs(a.lon-b.lon),min:Math.abs(a.lon-b.lon)*2});
test('adds a stop between existing stops, without appending or backtracking',()=>{
 const ctx=context({start:p(0),stops:[p(10),p(20)],finish:p(30)});
 assert.deepEqual(bestInsertion(ctx,p(15),leg),{index:1,mi:0,min:0});
});
test('return trip detour includes rejoining existing itinerary',()=>{
 const ctx=context({start:p(0),stops:[p(10)],finish:'return'});
 assert.deepEqual(bestInsertion(ctx,p(12),leg),{index:0,mi:4,min:8});
});
test('open trip can append beyond the last stop',()=>{
 const ctx=context({start:p(0),stops:[p(10)],finish:'last'});
 assert.deepEqual(bestInsertion(ctx,p(15),leg),{index:1,mi:5,min:10});
});
test('unknown coordinates cannot silently remove an itinerary leg',()=>{
 assert.equal(context({start:p(0),stops:[{name:'Unknown'}],finish:'last'}),null);
});
test('corridor distance measures segments, not sparse sample points',()=>{
 const dist=(a,b)=>Math.hypot(a.lat-b.lat,a.lon-b.lon);
 assert.equal(distanceToLine({lat:1,lon:5},[p(0),p(10)],dist),1);
});
test('unreachable road connections are excluded',()=>{
 assert.equal(bestInsertion(context({start:p(0),stops:[],finish:p(10)}),p(5),()=>null),null);
});
test('fastest insertion uses directed road costs, rather than straight-line proximity',()=>{
 const ctx=context({start:p(0),stops:[p(10)],finish:p(20)});
 const matrix={'0,10':10,'10,20':10,'0,5':30,'5,10':30,'10,5':3,'5,20':9};
 const road=(a,b)=>({mi:matrix[a.lon+','+b.lon],min:matrix[a.lon+','+b.lon]});
 assert.deepEqual(bestInsertion(ctx,p(5),road),{index:1,mi:2,min:2});
});
const vm=require('node:vm'),fs=require('node:fs');
function appHarness(fetch){
 const source=fs.readFileSync('app.js','utf8');
 const sandbox={RouteEfficiency:require('../route-efficiency.js'),state:{trip:null},AbortController,setTimeout,clearTimeout,fetch,JSON,Math};
 sandbox.miles=(a,b)=>Math.abs(a.lon-b.lon);
 sandbox.roadEstimate=leg;
 vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('async function roadRoute('),source.indexOf('let previewSeq')),sandbox);
 return sandbox;
}
test('road matrix detours are ranked and labeled as routed',async()=>{
 const sandbox=appHarness(async()=>({ok:true,json:async()=>({code:'Ok',sources:Array(4).fill({distance:0}),destinations:Array(4).fill({distance:0}),distances:[[0,1000,600,6000],[1000,0,600,6000],[600,600,0,6000],[6000,6000,6000,0]],durations:[[0,100,60,600],[100,0,60,600],[60,60,0,600],[600,600,600,0]]})}));
 const trip={start:p(0),stops:[],finish:p(10)};
 const result=await sandbox.rankByDriving([{...p(5),id:'near'},{...p(6),id:'far'}],trip);
 assert.equal(result[0].id,'near');assert.equal(result[0].detour.routed,true);assert.ok(Math.abs(result[0].detour.mi-200/1609.344)<1e-9);
});
test('offline routing returns honest approximate insertion estimates',async()=>{
 const sandbox=appHarness(async()=>{throw Error('Offline')});
 const result=await sandbox.rankByDriving([{...p(5),id:'mid'}],{start:p(0),stops:[p(10)],finish:'last'});
 assert.equal(result[0].detour.index,0);assert.equal(result[0].detour.routed,undefined);
});

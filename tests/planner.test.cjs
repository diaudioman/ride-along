const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm');
function harness(){
 class Element{constructor(){this.children=[];this.classList={add(){},remove(){}};this.value='';this.textContent=''}replaceChildren(...nodes){this.children=nodes}append(...nodes){this.children.push(...nodes)}querySelector(){return this.button||(this.button=new Element())}}
 const elements=new Map();const $=key=>{if(!elements.has(key))elements.set(key,new Element());return elements.get(key)};
 $('#planningMode').value='places';
 let env={document:{querySelector:$,createElement:()=>new Element()},$,window:{},navigator:{},state:{regionCenter:{name:'Destination',lat:0,lon:10},planStops:[]},RouteEfficiency:require('../route-efficiency.js'),setTimeout,clearTimeout,Promise,Map,Set,Math,console};
 env.miles=(a,b)=>Math.hypot(a.lon-b.lon,a.lat-b.lat);env.roadEstimate=(a,b)=>({min:env.miles(a,b)*2,mi:env.miles(a,b)});env.formatMinutes=n=>Math.round(n)+' min';env.planEndpoints=()=>({start:{name:'Start',lat:0,lon:0},finish:env.state.regionCenter});env.roadRoute=async points=>({min:20,mi:10,geometry:points});env.discoverRegionCandidates=async()=>[{id:'mid',name:'Museum',lat:0,lon:5,cats:['History'],visit:30}];env.distanceToRoute=()=>0;env.rankByDriving=async(list,trip)=>list.map(p=>({...p,detour:{index:0,min:2,mi:1,routed:true}}));env.geocodeNear=async name=>({name,lat:1,lon:1});env.save=()=>{};env.renderPlanStops=()=>{};env.queuePlanStop=p=>env.state.planStops.push(p);
 vm.createContext(env);vm.runInContext(fs.readFileSync('planner.js','utf8'),env);return {env,$};
}
test('destination preview shows direct driving route before selecting stops and suggests attractions',async()=>{
 const {env,$}=harness();await env.loadPlanner(0,false);
 assert.match($('#planRouteEstimate').innerHTML,/20 min total/);assert.equal($('#planSuggestions').children.length,1);assert.match($('#planSuggestions').children[0].innerHTML,/Museum/);assert.match($('#planSuggestions').children[0].innerHTML,/\+1.0 mi/);
 $('#planSuggestions').children[0].querySelector('button').onclick();assert.equal(env.state.planStops[0].id,'mid');
});
test('GPS denial still provides attractions and clearly requests a start',async()=>{
 const {env,$}=harness();env.planEndpoints=()=>({start:null,finish:env.state.regionCenter});await env.loadPlanner(0,false);
 assert.match($('#planRouteEstimate').innerHTML,/Set your starting location/);assert.equal($('#planSuggestions').children.length,1);assert.match($('#planSuggestions').children[0].innerHTML,/from destination/);
});
test('stale search results cannot overwrite a changed destination',async()=>{
 const {env,$}=harness();let resolve;env.roadRoute=()=>new Promise(r=>resolve=r);let pending=env.loadPlanner(0,false);await Promise.resolve();await Promise.resolve();await new Promise(r=>setImmediate(r));vm.runInContext('plannerSeq++',env);resolve({min:20,mi:10,geometry:[]});await pending;assert.equal($('#planSuggestions').children.length,0);
});
test('selected places are omitted from suggestions',async()=>{
 const {env,$}=harness();env.state.planStops=[{id:'mid',name:'Museum',lat:0,lon:5,visit:30}];await env.loadPlanner(0,false);assert.equal($('#planSuggestions').children.length,0);assert.match($('#planSuggestionsStatus').textContent,/No suggestions/);
});

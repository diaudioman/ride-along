const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('offline install reloads and precaches the exact versioned page assets',async()=>{
 const handlers={},added=[];
 const context={Request:class {constructor(url,options){this.url=url;this.cache=options.cache;}},caches:{open:async()=>({addAll:async requests=>added.push(...requests)})},self:{addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{}}};
 vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
 let complete;handlers.install({waitUntil:p=>complete=p});await complete;
 const html=fs.readFileSync('index.html','utf8');
 const assets=[...html.matchAll(/(?:src|href)="([^"\n]+\.(?:js|css)\?v=\d+)"/g)].map(m=>'./'+m[1]);
 assert.equal(assets.length,6);
 for(const asset of assets)assert.ok(added.some(r=>r.url===asset&&r.cache==='reload'),asset);
 const app=fs.readFileSync('app.js','utf8');
 for(const asset of assets)assert.ok(app.includes(JSON.stringify(asset)),asset+' available to offline controls');
});

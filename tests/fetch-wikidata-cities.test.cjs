#!/usr/bin/env node
'use strict';
// Offline tests for the checkpointed settlement importer. Wikidata is replaced by a stubbed
// fetch (tests/stub-wikidata-fetch.cjs) driven by a JSON scenario; no network is used.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-cities.cjs');
const stub=path.join(__dirname,'stub-wikidata-fetch.cjs');

const row=(q,year=1200,coord='Point(19.04 47.5)')=>({item:{value:'http://www.wikidata.org/entity/Q'+q},itemLabel:{value:'Place '+q},coord:{value:coord},inception:{value:'+'+year+'-01-01T00:00:00Z'}});
const baseState=()=>({schemaVersion:1,settlements:{activeCategory:'village',queue:['town','village'],categories:{
 town:{wikidataClass:'Q3957',strategy:'offset-v1',status:'exhausted',nextPage:167},
 village:{wikidataClass:'Q532',strategy:'offset-v1',status:'in_progress',nextPage:200}},consecutiveFailures:0,lastRun:null}});
const baseData=()=>({schemaVersion:2,source:'Wikidata SPARQL',reviewStatus:'unreviewed',importedAt:'2026-01-01T00:00:00.000Z',pagesFetched:40,startPage:160,nextPage:200,settlementClass:'Q532',cities:[
 {name:'Kept',lat:1,lng:1,from:1000,to:2026,region:'',source:'https://www.wikidata.org/wiki/Q1',precision:'approximate',note:'',wikidataId:'Q1',reviewStatus:'unreviewed'},
 {name:'Verified by hand',lat:2,lng:2,from:900,to:2026,region:'',source:'https://www.wikidata.org/wiki/Q2',precision:'exact',note:'KEEP',wikidataId:'Q2',reviewStatus:'verified'}]});

function run(scenario,{state=baseState(),data=baseData(),env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-import-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-cities.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',...env}});
 const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
 const out={code:result.status,stdout:result.stdout,stderr:result.stderr,state:read('data/import-state.json'),data:data||fs.existsSync(path.join(dir,'data/imports/wikidata-cities.json'))?read('data/imports/wikidata-cities.json'):null,calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}

const tests=[];
const test=(name,fn)=>tests.push([name,fn]);

test('continues from the checkpoint and advances it after each page',()=>{
 const r=run({pages:{200:[row(10),row(11)],201:[row(12)]}},{env:{WIKIDATA_MAX_PAGES:'2'}});
 assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.calls.map(c=>c.offset),[20000,20100]);
 const v=r.state.settlements.categories.village;
 assert.equal(v.nextPage,202);
 assert.equal(r.state.settlements.lastRun.outcome,'complete');
 assert.equal(r.state.settlements.lastRun.newRecords,3);
 assert.equal(r.data.cities.length,5);
 assert.equal(r.data.startPage,200);assert.equal(r.data.nextPage,202);assert.equal(r.data.settlementClass,'Q532');
});

test('a page without usable records still advances the checkpoint',()=>{
 const r=run({pages:{200:[{item:{value:'http://www.wikidata.org/entity/Q50'}}]}},{env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.state.settlements.categories.village.nextPage,201);
 assert.equal(r.state.settlements.lastRun.pages[0].result,'no_new_records');
 assert.equal(r.data.cities.length,2);
});

test('a failed query keeps completed pages and does not advance past the failure',()=>{
 const r=run({pages:{200:[row(10)]},fail:{201:{status:500}}},{env:{WIKIDATA_MAX_PAGES:'5'}});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.state.settlements.categories.village.nextPage,201);
 assert.equal(r.state.settlements.lastRun.outcome,'partial');
 assert.equal(r.calls.filter(c=>c.offset===20100).length,4,'four attempts on the failing page');
 assert.ok(r.data.cities.some(c=>c.wikidataId==='Q10'));
 assert.equal(r.state.settlements.consecutiveFailures,0);
});

test('a run that fails on its first page changes no data and counts a failure',()=>{
 const state=baseState();state.settlements.consecutiveFailures=1;
 const r=run({fail:{200:{status:502}}},{state});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.state.settlements.categories.village.nextPage,200);
 assert.equal(r.state.settlements.lastRun.outcome,'transient_error');
 assert.equal(r.state.settlements.consecutiveFailures,2);
 assert.equal(r.data.importedAt,'2026-01-01T00:00:00.000Z');
});

test('three failed runs in a row make the job fail so GitHub notifies',()=>{
 const state=baseState();state.settlements.consecutiveFailures=2;
 const r=run({fail:{200:{status:500}}},{state});
 assert.equal(r.code,1);
 assert.equal(r.state.settlements.consecutiveFailures,3);
});

test('rate limiting with a long Retry-After stops at once without advancing',()=>{
 const r=run({fail:{200:{status:429,retryAfter:3600}}});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.calls.length,1);
 assert.equal(r.state.settlements.lastRun.outcome,'rate_limited');
 assert.equal(r.state.settlements.categories.village.nextPage,200);
});

test('an empty page exhausts the category and moves on to the next open one',()=>{
 const state=baseState();
 state.settlements.queue=['village','ancient'];
 state.settlements.categories.ancient={wikidataClass:'Q15661340',strategy:'offset-v1',status:'pending',nextPage:0};
 const r=run({pages:{200:[],0:[row(70)]},classOf:true},{state,env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r.code,0,r.stderr);
 const s=r.state.settlements;
 assert.equal(s.categories.village.status,'exhausted');
 assert.equal(s.categories.village.nextPage,200);
 assert.equal(s.activeCategory,'ancient');
 assert.equal(s.categories.ancient.nextPage,1);
 assert.deepEqual(r.calls.map(c=>c.cls),['Q532','Q532','Q15661340'],'empty page is confirmed once');
 assert.equal(r.data.settlementClass,'Q15661340');assert.equal(r.data.startPage,0);
});

test('when every category is exhausted nothing is fetched',()=>{
 const state=baseState();state.settlements.categories.village.status='exhausted';
 const r=run({},{state});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.calls.length,0);
 assert.equal(r.state.settlements.lastRun.outcome,'all_exhausted');
});

test('reviewed records are never overwritten; unreviewed ones are refreshed',()=>{
 const r=run({pages:{200:[row(1,1111),row(2,1222)]}},{env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r.code,0,r.stderr);
 const q1=r.data.cities.find(c=>c.wikidataId==='Q1');
 const q2=r.data.cities.find(c=>c.wikidataId==='Q2');
 assert.equal(q1.from,1111);
 assert.equal(q2.reviewStatus,'verified');assert.equal(q2.note,'KEEP');assert.equal(q2.from,900);
 assert.equal(r.state.settlements.lastRun.newRecords,0);
});

test('manual start page override never moves the checkpoint backwards',()=>{
 const r=run({pages:{150:[row(30)]}},{env:{WIKIDATA_MAX_PAGES:'1',WIKIDATA_START_PAGE:'150'}});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.calls[0].offset,15000);
 assert.equal(r.state.settlements.categories.village.nextPage,200);
});

test('a missing checkpoint file is an error, not a silent restart from page 0',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-import-'));
 const result=spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'});
 fs.rmSync(dir,{recursive:true,force:true});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/import-state\.json is missing/);
});

let failed=0;
for(const [name,fn] of tests){
 try{fn();console.log('ok - '+name)}catch(error){failed++;console.error('not ok - '+name+'\n'+(error.stack||error))}
}
console.log(tests.length-failed+'/'+tests.length+' importer tests passed');
if(failed)process.exitCode=1;

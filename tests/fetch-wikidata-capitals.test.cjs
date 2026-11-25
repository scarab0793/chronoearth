#!/usr/bin/env node
'use strict';
// Offline tests for the historical capital importer (stubbed Wikidata, no network).
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-capitals.cjs');
const stub=path.join(__dirname,'stub-wikidata-capitals-fetch.cjs');
const baseState=()=>({schemaVersion:1,capitals:{activeCategory:'capital',queue:['capital'],categories:{capital:{wikidataClass:'Q5119',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0}},consecutiveFailures:0,lastRun:null}});

function run(scenario,{state=baseState(),data=null,env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-capitals-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-capitals.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',WIKIDATA_MAX_PAGES:'1',WIKIDATA_CATEGORY:'',...env}});
 const read=f=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):null;
 const out={code:result.status,stderr:result.stderr,state:read('data/import-state.json'),data:read('data/imports/wikidata-capitals.json'),stateMtime:fs.statSync(path.join(dir,'data/import-state.json')).mtimeMs,calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}
const tests=[];const test=(n,f)=>tests.push([n,f]);

const hungary={id:'Q171150',label:'Kingdom of Hungary',p31:['Q3024240'],dissolved:'+1946-02-01T00:00:00Z',capitals:[
 {id:'Q130212',label:'Székesfehérvár',coord:[47.19,18.41],start:'+1000-00-00T00:00:00Z',end:'+1543-00-00T00:00:00Z'},
 {id:'Q1781',label:'Budapest',coord:[47.5,19.04],start:'+1873-00-00T00:00:00Z'},
 {id:'Q193478',label:'Buda',coord:[47.5,19.03],end:'+1526-00-00T00:00:00Z'}]};

test('keeps documented capital periods, ending open ones at the state dissolution',()=>{
 const r=run({states:[hungary]});
 assert.equal(r.code,0,r.stderr);
 const rec=r.data.capitals[0];
 assert.equal(rec.wikidataId,'Q171150');
 assert.deepEqual(rec.capitals.map(c=>[c.name,c.from,c.to,c.periodEnd]),[['Székesfehérvár',1000,1543,'qualifier'],['Budapest',1873,1946,'state-dissolution']]);
 assert.equal(r.state.capitals.categories.capital.cursor,'http://www.wikidata.org/entity/Q171150');
});

test('a capital without a documented start is skipped, not guessed',()=>{
 const r=run({states:[hungary]});
 assert.ok(!r.data.capitals[0].capitals.some(c=>c.name==='Buda'));
});

test('a historical state without any end date drops open periods; an existing state runs to the present',()=>{
 const r=run({states:[
  {id:'Q10',label:'Old realm',p31:['Q3024240'],capitals:[{id:'Q11',label:'Oldtown',coord:[1,1],start:'+0800-00-00T00:00:00Z'}]},
  {id:'Q20',label:'Modern state',p31:['Q3624078'],capitals:[{id:'Q21',label:'Newtown',coord:[2,2],start:'+1991-00-00T00:00:00Z'}]}]});
 assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.data.capitals.map(s=>s.wikidataId),['Q20']);
 assert.equal(r.data.capitals[0].capitals[0].to,2026);
 assert.equal(r.data.capitals[0].capitals[0].periodEnd,'present');
});

test('BCE capitals keep historical year numbering',()=>{
 const r=run({states:[{id:'Q30',label:'Ancient kingdom',p31:['Q417175'],dissolved:'-0146-00-00T00:00:00Z',capitals:[{id:'Q31',label:'Capital',coord:[3,3],start:'-0814-00-00T00:00:00Z'}]}]});
 assert.deepEqual([r.data.capitals[0].capitals[0].from,r.data.capitals[0].capitals[0].to],[-814,-146]);
});

test('cities without coordinates and deprecated statements are ignored',()=>{
 const r=run({states:[{id:'Q40',label:'State',p31:['Q3624078'],capitals:[{id:'Q41',label:'Nowhere',start:'+1900-00-00T00:00:00Z'},{id:'Q42',label:'Wrong',coord:[4,4],start:'+1900-00-00T00:00:00Z',rank:'deprecated'}]}]});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.data,null,'no usable record, no dataset written');
 assert.equal(r.state.capitals.categories.capital.cursor,'http://www.wikidata.org/entity/Q40','checkpoint still advances');
});

test('an exhausted queue leaves the checkpoint file untouched',()=>{
 const state=baseState();state.capitals.categories.capital.status='exhausted';
 const r=run({states:[hungary]},{state});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.calls.length,0);
 assert.deepEqual(r.state,state);
});

let failed=0;
for(const [n,f] of tests){try{f();console.log('ok - '+n)}catch(e){failed++;console.error('not ok - '+n+'\n'+(e.stack||e))}}
console.log(tests.length-failed+'/'+tests.length+' capital importer tests passed');
if(failed)process.exitCode=1;

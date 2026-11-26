#!/usr/bin/env node
'use strict';
// Offline tests for the keyset dated-settlement importer and the run-chaining helper.
// Reuses the battle importer's fetch stub: same item/claims scenario format.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {shouldContinue}=require('../scripts/should-continue-import.cjs');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-dated-settlements.cjs');
const stub=path.join(__dirname,'stub-wikidata-battles-fetch.cjs');
const baseState=()=>({schemaVersion:1,datedSettlements:{activeCategory:'village',queue:['village'],categories:{
 village:{wikidataClass:'Q532',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0}},consecutiveFailures:0,lastRun:null}});

function run(scenario,{state=baseState(),data=null,env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-dated-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-cities.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',WIKIDATA_MAX_PAGES:'1',WIKIDATA_CATEGORY:'',...env}});
 const read=f=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):null;
 const out={code:result.status,stderr:result.stderr,state:read('data/import-state.json'),data:read('data/imports/wikidata-cities.json'),calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}
const tests=[];const test=(n,f)=>tests.push([n,f]);
const v=(n,extra={})=>({id:'Q'+n,label:'Village '+n,coord:[47.1,18.2],...extra});
const t=(y,precision=9)=>({time:(y<0?'-':'+')+String(Math.abs(y)).padStart(4,'0')+'-00-00T00:00:00Z',precision});

test('keeps the existing record schema, with BCE years from the API and 2026 as the open end',()=>{
 const r=run({classes:{Q532:[v(1),v(2)]},claims:{Q1:{P571:t(-300)},Q2:{P571:t(1200),P576:t(1526)}}});
 assert.equal(r.code,0,r.stderr);
 const [a,b]=r.data.cities;
 assert.deepEqual([a.from,a.to,a.fromPrecision,a.toPrecision,a.precision,a.reviewStatus],[-300,2026,'year',null,'approximate','unreviewed']);
 assert.deepEqual([b.from,b.to],[1200,1526]);
 assert.match(a.note,/unverified/);
});

test('merges into the existing city dataset and never overwrites reviewed records',()=>{
 const data={schemaVersion:2,source:'Wikidata SPARQL',nextPage:340,cities:[
  {name:'Old',lat:1,lng:1,from:1000,to:2026,region:'',source:'https://www.wikidata.org/wiki/Q50',precision:'approximate',note:'x',wikidataId:'Q50',reviewStatus:'unreviewed'},
  {name:'Checked',lat:1,lng:1,from:900,to:2026,region:'',source:'https://www.wikidata.org/wiki/Q3',precision:'exact',note:'x',wikidataId:'Q3',reviewStatus:'verified'}]};
 const r=run({classes:{Q532:[v(3),v(4)]},claims:{Q3:{P571:t(1000)},Q4:{P571:t(1100)}}},{data});
 assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.data.cities.map(c=>c.wikidataId),['Q3','Q4','Q50']);
 const q3=r.data.cities.find(c=>c.wikidataId==='Q3');
 assert.deepEqual([q3.reviewStatus,q3.from],['verified',900]);
 assert.equal(r.data.nextPage,340,'earlier metadata is kept');
});

test('skips items without coordinates, label or a valid date span',()=>{
 const r=run({classes:{Q532:[v(5,{coord:null}),v(6,{label:'Q6'}),v(7),v(8),v(9)]},claims:{Q5:{P571:t(1000)},Q6:{P571:t(1000)},Q7:{P571:t(1500),P576:t(1400)},Q9:{P571:t(1300)}}});
 assert.deepEqual(r.data.cities.map(c=>c.wikidataId),['Q9']);
 assert.equal(r.state.datedSettlements.categories.village.cursor,'http://www.wikidata.org/entity/Q9');
});

test('continues from the stored cursor',()=>{
 const items=Array.from({length:70},(_,i)=>v(100+i));
 const claims=Object.fromEntries(items.map(i=>[i.id,{P571:t(1400)}]));
 const r1=run({classes:{Q532:items},claims});
 const r2=run({classes:{Q532:items},claims},{state:r1.state,data:r1.data});
 assert.equal(r2.calls[0].cursor,r1.state.datedSettlements.categories.village.cursor);
 assert.equal(r2.data.cities.length,70);
});

const sec=(lastRun,status='in_progress')=>({s:{categories:{a:{status}},lastRun}});
test('chains another run only after progress without errors while work remains',()=>{
 assert.equal(shouldContinue(sec({outcome:'complete',pagesFetched:150}),'s'),true);
 assert.equal(shouldContinue(sec({outcome:'exhausted',pagesFetched:3}),'s'),true);
 assert.equal(shouldContinue(sec({outcome:'partial',stopReason:'time_budget',error:null,pagesFetched:90}),'s'),true);
 assert.equal(shouldContinue(sec({outcome:'partial',stopReason:'page failed',error:'HTTP 500',pagesFetched:4}),'s'),false);
 assert.equal(shouldContinue(sec({outcome:'rate_limited',pagesFetched:0}),'s'),false);
 assert.equal(shouldContinue(sec({outcome:'complete',pagesFetched:150},'exhausted'),'s'),false);
 assert.equal(shouldContinue(sec(null),'s'),false);
 assert.equal(shouldContinue({},'s'),false);
});

let failed=0;
for(const [name,fn] of tests){
 try{fn();console.log('ok - '+name)}catch(error){failed++;console.error('not ok - '+name+'\n'+(error.stack||error))}
}
console.log(tests.length-failed+'/'+tests.length+' dated settlement importer tests passed');
if(failed)process.exitCode=1;

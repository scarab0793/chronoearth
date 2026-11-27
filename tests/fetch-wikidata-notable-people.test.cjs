#!/usr/bin/env node
'use strict';
// Offline tests for the occupation-based notable people importer (stubbed Wikidata).
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-notable-people.cjs');
const stub=path.join(__dirname,'stub-wikidata-people-fetch.cjs');
const baseState=()=>({schemaVersion:1,people:{activeCategory:'monarch',queue:['monarch','explorer'],categories:{
 monarch:{wikidataClass:'Q116',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0},
 explorer:{wikidataClass:'Q11900058',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0}},consecutiveFailures:0,lastRun:null}});

function run(scenario,{state=baseState(),data=null,env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-people-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-people.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',WIKIDATA_MAX_PAGES:'1',WIKIDATA_CATEGORY:'',...env}});
 const read=f=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):null;
 const out={code:result.status,stderr:result.stderr,state:read('data/import-state.json'),data:read('data/imports/wikidata-people.json'),calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}
const tests=[];const test=(n,f)=>tests.push([n,f]);
const rome={id:'Q220',label:'Rome',coord:[41.9,12.5]};
const person=(n,extra={})=>({id:'Q'+n,label:'Person '+n,P569:'+1500-00-00T00:00:00Z',P570:'+1560-00-00T00:00:00Z',places:[rome],...extra});

test('stores BCE life years from the API and the place of birth apart from location',()=>{
 const r=run({occupations:{Q116:[person(1,{label:'Augustus',P569:'-0063-00-00T00:00:00Z',P570:'+0014-00-00T00:00:00Z'})]}});
 assert.equal(r.code,0,r.stderr);
 const p=r.data.people[0];
 assert.deepEqual([p.name,p.birthYear,p.deathYear,p.location,p.reviewStatus],['Augustus',-63,14,null,'unreviewed']);
 assert.deepEqual(p.birthPlace,{id:'Q220',name:'Rome',lat:41.9,lng:12.5});
 assert.deepEqual(p.occupations,['monarch']);
 assert.equal(p.id,'wikidata:Q1');
});

test('uses the best-ranked place of birth when several are listed',()=>{
 const r=run({occupations:{Q116:[person(2,{places:[rome,{id:'Q90',label:'Paris',coord:[48.86,2.35]}],P19:'Q90'})]}});
 assert.equal(r.data.people[0].birthPlace.id,'Q90');
});

test('skips non-humans, late births, contradictory dates and unlabeled items',()=>{
 const r=run({occupations:{Q116:[person(3,{p31:['Q15632617']}),person(4,{P569:'+1950-00-00T00:00:00Z',P570:null}),person(5,{P570:'+1400-00-00T00:00:00Z'}),person(6,{label:'Q6'}),person(7,{P570:null})]}});
 assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.data.people.map(p=>[p.wikidataId,p.deathYear]),[['Q7',null]]);
 assert.equal(r.state.people.categories.monarch.cursor,'http://www.wikidata.org/entity/Q7');
});

test('a person found under a second occupation keeps both',()=>{
 const p8=person(8);
 const r1=run({occupations:{Q116:[p8]}});
 const state=r1.state;state.people.categories.monarch.status='exhausted';state.people.activeCategory='explorer';
 const r2=run({occupations:{Q11900058:[p8]}},{state,data:r1.data});
 assert.deepEqual(r2.data.people[0].occupations,['explorer','monarch']);
});

test('keeps earlier records and never overwrites reviewed ones',()=>{
 const data={schemaVersion:2,people:[
  {id:'wikidata:Q23',wikidataId:'Q23',name:'George Washington',birthYear:1732,deathYear:1799,source:'https://www.wikidata.org/wiki/Q23',reviewStatus:'unreviewed',location:null},
  {id:'wikidata:Q9',wikidataId:'Q9',name:'Checked',birthYear:1000,deathYear:1050,source:'https://www.wikidata.org/wiki/Q9',reviewStatus:'verified',location:null}]};
 const r=run({occupations:{Q116:[person(9),person(10)]}},{data});
 assert.deepEqual(r.data.people.map(p=>p.wikidataId).sort(),['Q10','Q23','Q9']);
 const q9=r.data.people.find(p=>p.wikidataId==='Q9');
 assert.deepEqual([q9.reviewStatus,q9.birthYear,q9.birthPlace],['verified',1000,undefined]);
});

let failed=0;
for(const [name,fn] of tests){
 try{fn();console.log('ok - '+name)}catch(error){failed++;console.error('not ok - '+name+'\n'+(error.stack||error))}
}
console.log(tests.length-failed+'/'+tests.length+' notable people importer tests passed');
if(failed)process.exitCode=1;

#!/usr/bin/env node
'use strict';
// Offline tests for the shared checkpointed import engine and the battle/siege importer.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-battles.cjs');
const stub=path.join(__dirname,'stub-wikidata-battles-fetch.cjs');

const baseState=()=>({schemaVersion:1,battles:{activeCategory:'battle',queue:['battle','siege'],categories:{
 battle:{wikidataClass:'Q178561',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0},
 siege:{wikidataClass:'Q188055',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0}},consecutiveFailures:0,lastRun:null}});
const battle=(n,extra={})=>({id:'Q'+n,label:'Battle '+n,coord:[47.5,19.04],...extra});
const dated=(time='+1526-08-29T00:00:00Z',precision=11,calendar='julian')=>({P585:{time,precision,calendar}});

function run(scenario,{state=baseState(),data=null,env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-battles-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-battles.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',WIKIDATA_MAX_PAGES:'',WIKIDATA_CATEGORY:'',...env}});
 const read=f=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):null;
 const out={code:result.status,stdout:result.stdout,stderr:result.stderr,state:read('data/import-state.json'),data:read('data/imports/wikidata-battles.json'),calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}

const tests=[];
const test=(name,fn)=>tests.push([name,fn]);
const many=(from,count,extra)=>Array.from({length:count},(_,i)=>battle(from+i,extra));
const claimsFor=items=>Object.fromEntries(items.map(i=>[i.id,dated()]));

test('pages with a keyset cursor and stores historical BCE years from the API',()=>{
 const items=[battle(179591,{label:'Battle of Cannae'}),battle(48314,{label:'Battle of Waterloo'})];
 const r=run({classes:{Q178561:items},claims:{Q179591:dated('-0216-08-02T00:00:00Z',11,'julian'),Q48314:dated('+1815-06-18T00:00:00Z',11,'gregorian')}},{env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r.code,0,r.stderr);
 const cannae=r.data.battles.find(b=>b.wikidataId==='Q179591');
 assert.equal(cannae.y,-216,'216 BCE stays -216 (SPARQL would give -215)');
 assert.equal(cannae.month,8);assert.equal(cannae.day,2);assert.equal(cannae.calendar,'julian');assert.equal(cannae.datePrecision,'day');
 assert.equal(cannae.kind,'battle');assert.equal(cannae.reviewStatus,'unreviewed');
 assert.equal(r.state.battles.categories.battle.cursor,'http://www.wikidata.org/entity/Q48314');
 assert.equal(r.calls[0].cursor,'');
});

test('continues from the stored cursor on the next run',()=>{
 const items=many(10,120);
 const r1=run({classes:{Q178561:items},claims:claimsFor(items)},{env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r1.data.battles.length,50);
 const r2=run({classes:{Q178561:items},claims:claimsFor(items)},{state:r1.state,data:r1.data,env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r2.code,0,r2.stderr);
 assert.equal(r2.calls[0].cursor,r1.state.battles.categories.battle.cursor);
 assert.equal(r2.data.battles.length,100);
 assert.equal(r2.state.battles.categories.battle.pagesDone,2);
});

test('skips records without date, place or label, and still advances',()=>{
 const items=[battle(1),battle(2,{coord:null}),battle(3,{label:'Q3'}),battle(4)];
 const r=run({classes:{Q178561:items},claims:{Q1:dated(),Q2:dated(),Q3:dated()}},{env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.data.battles.map(b=>b.wikidataId),['Q1']);
 assert.equal(r.state.battles.categories.battle.cursor,'http://www.wikidata.org/entity/Q4');
});

test('uses the recorded location when the battle has no own coordinates',()=>{
 const items=[battle(5,{coord:null,loc:{id:'Q100',name:'Mohács',coord:[45.99,18.68]},partOf:{id:'Q200',name:'Ottoman–Hungarian wars'}})];
 const r=run({classes:{Q178561:items},claims:{Q5:dated('+1526-00-00T00:00:00Z',9)}},{env:{WIKIDATA_MAX_PAGES:'1'}});
 const b=r.data.battles[0];
 assert.equal(b.precision,'location-derived');assert.equal(b.locationId,'Q100');assert.equal(b.lat,45.99);
 assert.equal(b.partOf,'Ottoman–Hungarian wars');assert.equal(b.datePrecision,'year');
 assert.equal(b.month,undefined);
 assert.match(b.note,/not of the battlefield itself/);
});

test('an empty category is exhausted and the import moves to sieges',()=>{
 const sieges=[battle(7,{label:'Siege 7'})];
 const r=run({classes:{Q178561:[],Q188055:sieges},claims:{Q7:dated()}},{env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.state.battles.categories.battle.status,'exhausted');
 assert.equal(r.state.battles.activeCategory,'siege');
 assert.equal(r.data.battles[0].kind,'siege');
 assert.deepEqual(r.calls.filter(c=>c.kind==='sparql').map(c=>c.cls),['Q178561','Q178561','Q188055']);
});

test('a failed API call keeps the cursor where it was',()=>{
 const items=many(10,60);
 const r=run({classes:{Q178561:items},claims:claimsFor(items),failApi:[2,3,4,5]},{env:{WIKIDATA_MAX_PAGES:'3'}});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.state.battles.lastRun.outcome,'partial');
 assert.equal(r.data.battles.length,50);
 assert.equal(r.state.battles.categories.battle.pagesDone,1);
});

test('a first-page failure counts toward the alert and changes no data',()=>{
 const state=baseState();state.battles.consecutiveFailures=2;
 const r=run({classes:{Q178561:many(10,3)},failSparql:[1,2,3,4]},{state});
 assert.equal(r.code,1);
 assert.equal(r.state.battles.consecutiveFailures,3);
 assert.equal(r.state.battles.categories.battle.cursor,'');
 assert.equal(r.data,null);
});

test('reviewed records are never overwritten',()=>{
 const items=[battle(9)];
 const data={schemaVersion:1,battles:[{name:'Checked',kind:'battle',y:1000,datePrecision:'year',lat:1,lng:1,precision:'exact',wikidataId:'Q9',source:'https://www.wikidata.org/wiki/Q9',reviewStatus:'verified'}]};
 const r=run({classes:{Q178561:items},claims:{Q9:dated()}},{data,env:{WIKIDATA_MAX_PAGES:'1'}});
 const b=r.data.battles.find(x=>x.wikidataId==='Q9');
 assert.equal(b.reviewStatus,'verified');assert.equal(b.y,1000);
});

test('deprecated date statements are ignored',()=>{
 const r=run({classes:{Q178561:[battle(11)]},claims:{Q11:{P585:{time:'+1500-01-01T00:00:00Z',precision:9,rank:'deprecated'}}}},{env:{WIKIDATA_MAX_PAGES:'1'}});
 assert.equal(r.data,null,'no usable record, so no empty dataset is written');
 assert.equal(r.state.battles.categories.battle.cursor,'http://www.wikidata.org/entity/Q11');
});

let failed=0;
for(const [name,fn] of tests){
 try{fn();console.log('ok - '+name)}catch(error){failed++;console.error('not ok - '+name+'\n'+(error.stack||error))}
}
console.log(tests.length-failed+'/'+tests.length+' battle importer tests passed');
if(failed)process.exitCode=1;

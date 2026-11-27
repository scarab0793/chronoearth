#!/usr/bin/env node
'use strict';
// Offline tests for the located event importer (stubbed Wikidata, no network).
// Reuses the battle importer's fetch stub: same item/claims scenario format.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-located-events.cjs');
const stub=path.join(__dirname,'stub-wikidata-battles-fetch.cjs');
const baseState=()=>({schemaVersion:1,locatedEvents:{activeCategory:'treaty',queue:['treaty','earthquake'],categories:{
 treaty:{wikidataClass:'Q131569',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0},
 earthquake:{wikidataClass:'Q7944',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0}},consecutiveFailures:0,lastRun:null}});

function run(scenario,{state=baseState(),data=null,env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-events-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-located-events.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',WIKIDATA_MAX_PAGES:'1',WIKIDATA_CATEGORY:'',...env}});
 const read=f=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):null;
 const out={code:result.status,stderr:result.stderr,state:read('data/import-state.json'),data:read('data/imports/wikidata-located-events.json'),calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}
const tests=[];const test=(n,f)=>tests.push([n,f]);
const ev=(n,extra={})=>({id:'Q'+n,label:'Event '+n,coord:[48.2,16.37],...extra});
const at=(time,precision=11,calendar='gregorian')=>({P585:{time,precision,calendar}});

test('stores a dated treaty with its own coordinates and BCE years from the API',()=>{
 const r=run({classes:{Q131569:[ev(1,{label:'Peace of Callias'}),ev(2,{label:'Peace of Westphalia'})]},claims:{Q1:at('-0449-00-00T00:00:00Z',9),Q2:at('+1648-10-24T00:00:00Z')}});
 assert.equal(r.code,0,r.stderr);
 const [a,b]=r.data.events;
 assert.deepEqual([a.name,a.kind,a.y,a.datePrecision,a.precision,a.reviewStatus],['Peace of Callias','treaty',-449,'year','exact','unreviewed']);
 assert.deepEqual([b.y,b.month,b.day],[1648,10,24]);
 assert.match(a.note,/^Treaty imported automatically/);
});

test('uses the recorded location when the event has no coordinates, and says so',()=>{
 const r=run({classes:{Q131569:[ev(3,{coord:null,loc:{id:'Q1741',name:'Vienna',coord:[48.2,16.37]}})]},claims:{Q3:at('+1815-06-09T00:00:00Z')}});
 const e=r.data.events[0];
 assert.deepEqual([e.precision,e.locationId,e.locationName],['location-derived','Q1741','Vienna']);
 assert.match(e.note,/not of the event itself/);
});

test('skips undated, unplaced and unlabeled events but still advances',()=>{
 const r=run({classes:{Q131569:[ev(4),ev(5,{coord:null}),ev(6,{label:'Q6'}),ev(7)]},claims:{Q5:at('+1500-01-01T00:00:00Z'),Q6:at('+1500-01-01T00:00:00Z'),Q7:at('+1600-01-01T00:00:00Z')}});
 assert.deepEqual(r.data.events.map(e=>e.wikidataId),['Q7']);
 assert.equal(r.state.locatedEvents.categories.treaty.cursor,'http://www.wikidata.org/entity/Q7');
});

test('an exhausted category moves on and records the next kind',()=>{
 const r=run({classes:{Q131569:[],Q7944:[ev(8,{label:'1755 Lisbon earthquake'})]},claims:{Q8:at('+1755-11-01T00:00:00Z')}});
 assert.equal(r.state.locatedEvents.categories.treaty.status,'exhausted');
 assert.equal(r.data.events[0].kind,'earthquake');
});

test('reviewed records are never overwritten',()=>{
 const data={schemaVersion:1,events:[{name:'Checked',kind:'treaty',y:1000,datePrecision:'year',lat:1,lng:1,precision:'exact',wikidataId:'Q9',source:'https://www.wikidata.org/wiki/Q9',reviewStatus:'verified'}]};
 const r=run({classes:{Q131569:[ev(9)]},claims:{Q9:at('+1200-01-01T00:00:00Z')}},{data});
 const e=r.data.events.find(x=>x.wikidataId==='Q9');
 assert.deepEqual([e.reviewStatus,e.y],['verified',1000]);
});

let failed=0;
for(const [name,fn] of tests){
 try{fn();console.log('ok - '+name)}catch(error){failed++;console.error('not ok - '+name+'\n'+(error.stack||error))}
}
console.log(tests.length-failed+'/'+tests.length+' located event importer tests passed');
if(failed)process.exitCode=1;

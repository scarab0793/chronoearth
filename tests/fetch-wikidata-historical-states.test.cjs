#!/usr/bin/env node
'use strict';
// Offline tests for the class-based historical state importer (stubbed Wikidata, no network).
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-historical-states.cjs');
const stub=path.join(__dirname,'stub-wikidata-states-fetch.cjs');
const baseState=()=>({schemaVersion:1,states:{activeCategory:'historical_country',queue:['historical_country','kingdom'],categories:{
 historical_country:{wikidataClass:'Q3024240',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0},
 kingdom:{wikidataClass:'Q417175',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0}},consecutiveFailures:0,lastRun:null}});

function run(scenario,{state=baseState(),data=null,env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-states-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-states.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',WIKIDATA_MAX_PAGES:'1',WIKIDATA_CATEGORY:'',...env}});
 const read=f=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):null;
 const out={code:result.status,stderr:result.stderr,state:read('data/import-state.json'),data:read('data/imports/wikidata-states.json'),calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}
const tests=[];const test=(n,f)=>tests.push([n,f]);
const HC=['Q3024240'];

test('imports BCE foundation and dissolution years from the API, borders unmapped',()=>{
 const r=run({classes:{Q3024240:[{id:'Q2429253',label:'Achaemenid Empire',desc:'ancient Persian empire',p31:HC,P571:'-0550-00-00T00:00:00Z',P576:'-0330-00-00T00:00:00Z'}]}});
 assert.equal(r.code,0,r.stderr);
 const s=r.data.states[0];
 assert.deepEqual([s.name,s.from,s.to,s.endStatus,s.description,s.geometry,s.borderStatus,s.reviewStatus],['Achaemenid Empire',-550,-330,'recorded','ancient Persian empire',null,'unmapped','unreviewed']);
 assert.equal(s.id,'wikidata:Q2429253');
});

test('a missing end stays null and is marked not-recorded',()=>{
 const r=run({classes:{Q3024240:[{id:'Q1',label:'Realm 1',p31:HC,P580:'+0900-00-00T00:00:00Z'}]}});
 const s=r.data.states[0];
 assert.deepEqual([s.from,s.to,s.endStatus],[900,null,'not-recorded']);
});

test('people, settlements, unlabeled items and contradictory dates are skipped',()=>{
 const r=run({classes:{Q3024240:[
  {id:'Q2',label:'Person',p31:['Q3024240','Q5'],P571:'+1000-00-00T00:00:00Z'},
  {id:'Q3',label:'City',p31:['Q3024240','Q515'],P571:'+1000-00-00T00:00:00Z'},
  {id:'Q4',label:'Q4',p31:HC,P571:'+1000-00-00T00:00:00Z'},
  {id:'Q5',label:'Backwards',p31:HC,P571:'+1500-00-00T00:00:00Z',P576:'+1400-00-00T00:00:00Z'},
  {id:'Q6',label:'Kept',p31:HC,P571:'+1100-00-00T00:00:00Z',P576:'+1200-00-00T00:00:00Z'}]}});
 assert.deepEqual(r.data.states.map(s=>s.wikidataId),['Q6']);
 assert.equal(r.state.states.categories.historical_country.cursor,'http://www.wikidata.org/entity/Q6');
});

test('keeps the existing catalogue and never overwrites reviewed records',()=>{
 const data={schemaVersion:1,states:[
  {id:'wikidata:Q7',wikidataId:'Q7',name:'Old search result',from:-7000,to:null,description:'',typeIds:[],source:'https://www.wikidata.org/wiki/Q7',reviewStatus:'unreviewed',borderStatus:'unmapped',geometry:null},
  {id:'wikidata:Q8',wikidataId:'Q8',name:'Checked',from:1000,to:1100,description:'',typeIds:[],source:'https://www.wikidata.org/wiki/Q8',reviewStatus:'verified',borderStatus:'unmapped',geometry:null}]};
 const r=run({classes:{Q3024240:[{id:'Q8',label:'Checked',p31:HC,P571:'+0999-00-00T00:00:00Z'},{id:'Q9',label:'New',p31:HC,P571:'+1300-00-00T00:00:00Z'}]}},{data});
 assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.data.states.map(s=>s.wikidataId).sort(),['Q7','Q8','Q9']);
 const q8=r.data.states.find(s=>s.wikidataId==='Q8');
 assert.deepEqual([q8.reviewStatus,q8.from],['verified',1000]);
});

test('an exhausted category moves on to kingdoms',()=>{
 const r=run({classes:{Q3024240:[],Q417175:[{id:'Q10',label:'Kingdom 10',p31:['Q417175'],P571:'+0800-00-00T00:00:00Z'}]}});
 assert.equal(r.state.states.categories.historical_country.status,'exhausted');
 assert.equal(r.data.states[0].wikidataId,'Q10');
});

let failed=0;
for(const [name,fn] of tests){
 try{fn();console.log('ok - '+name)}catch(error){failed++;console.error('not ok - '+name+'\n'+(error.stack||error))}
}
console.log(tests.length-failed+'/'+tests.length+' historical state importer tests passed');
if(failed)process.exitCode=1;

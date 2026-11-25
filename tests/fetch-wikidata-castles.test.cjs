#!/usr/bin/env node
'use strict';
// Offline tests for the castle and fortification importer (stubbed Wikidata, no network).
// Reuses the battle importer's fetch stub: same item/claims scenario format.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-castles.cjs');
const stub=path.join(__dirname,'stub-wikidata-battles-fetch.cjs');
const baseState=()=>({schemaVersion:1,castles:{activeCategory:'castle',queue:['castle','fort'],categories:{
 castle:{wikidataClass:'Q23413',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0},
 fort:{wikidataClass:'Q1785071',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0}},consecutiveFailures:0,lastRun:null}});

function run(scenario,{state=baseState(),data=null,env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-castles-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-castles.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',WIKIDATA_MAX_PAGES:'1',WIKIDATA_CATEGORY:'',...env}});
 const read=f=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):null;
 const out={code:result.status,stderr:result.stderr,state:read('data/import-state.json'),data:read('data/imports/wikidata-castles.json'),calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}
const tests=[];const test=(n,f)=>tests.push([n,f]);
const item=(n,extra={})=>({id:'Q'+n,label:'Castle '+n,coord:[47.9,19.0],...extra});
const t=(y,precision=9)=>({time:(y<0?'-':'+')+String(Math.abs(y)).padStart(4,'0')+'-00-00T00:00:00Z',precision});

test('stores the inception year and a documented destruction as the end',()=>{
 const r=run({classes:{Q23413:[item(1,{label:'Visegrád Castle'}),item(2)]},claims:{Q1:{P571:t(1250)},Q2:{P571:t(-50,7),P576:t(1526)}}});
 assert.equal(r.code,0,r.stderr);
 const [a,b]=r.data.castles;
 assert.deepEqual([a.name,a.y,a.end,a.kind,a.reviewStatus,a.precision],['Visegrád Castle',1250,undefined,'castle','unreviewed','exact']);
 assert.deepEqual([b.y,b.end,b.datePrecision],[-50,1526,'century']);
 assert.match(b.note,/destruction or dissolution in 1526/);
});

test('without its own coordinates, inception or label an item is skipped',()=>{
 const r=run({classes:{Q23413:[item(3,{coord:null,loc:{id:'Q9',name:'Town',coord:[1,1]}}),item(4),item(5,{label:'Q5'}),item(6)]},claims:{Q3:{P571:t(1300)},Q5:{P571:t(1300)},Q6:{P571:t(1400)}}});
 assert.deepEqual(r.data.castles.map(c=>c.wikidataId),['Q6']);
 assert.equal(r.state.castles.categories.castle.cursor,'http://www.wikidata.org/entity/Q6');
});

test('an end that is not after the inception is dropped, not guessed',()=>{
 const r=run({classes:{Q23413:[item(7)]},claims:{Q7:{P571:t(1500),P576:t(1400)}}});
 assert.equal(r.data.castles[0].end,undefined);
});

test('an exhausted category moves on to forts and the cursor continues',()=>{
 const r=run({classes:{Q23413:[],Q1785071:[item(8,{label:'Fort 8'})]},claims:{Q8:{P571:t(1700)}}});
 assert.equal(r.state.castles.categories.castle.status,'exhausted');
 assert.equal(r.data.castles[0].kind,'fort');
});

test('reviewed records are never overwritten',()=>{
 const data={schemaVersion:1,castles:[{name:'Checked',kind:'castle',y:1000,datePrecision:'year',lat:1,lng:1,precision:'exact',wikidataId:'Q10',source:'https://www.wikidata.org/wiki/Q10',reviewStatus:'verified'}]};
 const r=run({classes:{Q23413:[item(10)]},claims:{Q10:{P571:t(1300)}}},{data});
 const c=r.data.castles.find(x=>x.wikidataId==='Q10');
 assert.deepEqual([c.reviewStatus,c.y],['verified',1000]);
});

let failed=0;
for(const [name,fn] of tests){
 try{fn();console.log('ok - '+name)}catch(error){failed++;console.error('not ok - '+name+'\n'+(error.stack||error))}
}
console.log(tests.length-failed+'/'+tests.length+' castle importer tests passed');
if(failed)process.exitCode=1;

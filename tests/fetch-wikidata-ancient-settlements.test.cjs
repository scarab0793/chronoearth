#!/usr/bin/env node
'use strict';
// Offline tests for the ancient and abandoned settlement importer (stubbed Wikidata, no network).
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts/fetch-wikidata-ancient-settlements.cjs');
const stub=path.join(__dirname,'stub-wikidata-ancient-fetch.cjs');
const baseState=()=>({schemaVersion:1,ancientSettlements:{activeCategory:'ancient_city',queue:['ancient_city','ghost_town'],categories:{
 ancient_city:{wikidataClass:'Q15661340',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0},
 ghost_town:{wikidataClass:'Q74047',strategy:'keyset-v1',status:'pending',cursor:'',pagesDone:0}},consecutiveFailures:0,lastRun:null}});

function run(scenario,{state=baseState(),data=null,env={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chronoearth-ancient-'));
 fs.mkdirSync(path.join(dir,'data/imports'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/import-state.json'),JSON.stringify(state));
 if(data)fs.writeFileSync(path.join(dir,'data/imports/wikidata-ancient-settlements.json'),JSON.stringify(data));
 const scenarioFile=path.join(dir,'scenario.json');
 fs.writeFileSync(scenarioFile,JSON.stringify(scenario));
 const result=spawnSync(process.execPath,['-r',stub,script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:'',STUB_SCENARIO:scenarioFile,WIKIDATA_RETRY_BASE_MS:'1',WIKIDATA_PAGE_PAUSE_MS:'0',WIKIDATA_MAX_PAGES:'1',WIKIDATA_CATEGORY:'',...env}});
 const read=f=>fs.existsSync(path.join(dir,f))?JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')):null;
 const out={code:result.status,stderr:result.stderr,state:read('data/import-state.json'),data:read('data/imports/wikidata-ancient-settlements.json'),calls:read('scenario.json').calls||[]};
 fs.rmSync(dir,{recursive:true,force:true});
 return out;
}
const tests=[];const test=(n,f)=>tests.push([n,f]);
const t=(y,precision=9)=>({time:(y<0?'-':'+')+String(Math.abs(y)).padStart(4,'0')+'-00-00T00:00:00Z',precision});
const site=(n,extra={})=>({id:'Q'+n,label:'Site '+n,coord:[37.9,23.7],...extra});

test('uses the site\'s own start and end, keeping BCE years from the API',()=>{
 const r=run({classes:{Q15661340:[site(1,{label:'Carthage'})]},claims:{Q1:{P571:t(-814),P576:t(698)}}});
 assert.equal(r.code,0,r.stderr);
 const c=r.data.settlements[0];
 assert.deepEqual([c.name,c.from,c.to,c.dateBasis,c.kind,c.reviewStatus],['Carthage',-814,698,'own','ancient-city','unreviewed']);
 assert.equal(c.periodIds,undefined);
});

test('falls back to the span of all recorded periods',()=>{
 const r=run({classes:{Q15661340:[site(2,{periods:['Q100','Q101']})]},claims:{Q2:{P571:t(-1200)},Q100:{P580:t(-3000,7),P582:t(-1200,7)},Q101:{P580:t(-1200),P582:t(-800)}}});
 assert.equal(r.code,0,r.stderr);
 const c=r.data.settlements[0];
 assert.deepEqual([c.from,c.to,c.dateBasis,c.fromPrecision,c.toPrecision],[-3000,-800,'period','century','year']);
 assert.deepEqual(c.periodIds,['Q100','Q101']);
 assert.match(c.note,/not from dates of the site itself/);
});

test('skips a site when any recorded period has no documented span',()=>{
 const r=run({classes:{Q15661340:[site(3,{periods:['Q100','Q102']}),site(4)]},claims:{Q100:{P580:t(-3000),P582:t(-1200)},Q102:{P580:t(-500)},Q4:{P571:t(-500),P576:t(400)}}});
 assert.deepEqual(r.data.settlements.map(c=>c.wikidataId),['Q4']);
 assert.equal(r.state.ancientSettlements.categories.ancient_city.cursor,'http://www.wikidata.org/entity/Q4');
});

test('a start without an end is not completed with a guess',()=>{
 const r=run({classes:{Q15661340:[site(5)]},claims:{Q5:{P571:t(-600)}}});
 assert.equal(r.code,0,r.stderr);
 assert.equal(r.data,null,'no usable record, so no dataset is written');
 assert.equal(r.state.ancientSettlements.categories.ancient_city.cursor,'http://www.wikidata.org/entity/Q5');
});

test('drops out-of-range and reversed spans, and items without a label',()=>{
 const r=run({classes:{Q15661340:[site(6),site(7),site(8,{label:'Q8'}),site(9)]},claims:{Q6:{P571:t(-12000,6),P576:t(-9000)},Q7:{P571:t(500),P576:t(300)},Q8:{P571:t(1),P576:t(5)},Q9:{P580:t(1100),P582:t(1400)}}});
 assert.deepEqual(r.data.settlements.map(c=>[c.wikidataId,c.from,c.to]),[['Q9',1100,1400]]);
});

test('an exhausted category moves on to the next one in the queue',()=>{
 const r=run({classes:{Q15661340:[],Q74047:[site(10,{label:'Bodie'})]},claims:{Q10:{P571:t(1859),P576:t(1942)}}});
 assert.equal(r.state.ancientSettlements.categories.ancient_city.status,'exhausted');
 assert.equal(r.data.settlements[0].kind,'ghost-town');
});

test('continues from the stored cursor and never overwrites reviewed records',()=>{
 const items=Array.from({length:60},(_,i)=>site(100+i));
 const claims=Object.fromEntries(items.map(i=>[i.id,{P571:t(-300),P576:t(200)}]));
 const data={schemaVersion:1,settlements:[{name:'Checked',kind:'ancient-city',lat:1,lng:1,from:-100,to:100,dateBasis:'own',wikidataId:'Q100',source:'https://www.wikidata.org/wiki/Q100',reviewStatus:'verified'}]};
 const r1=run({classes:{Q15661340:items},claims},{data});
 assert.equal(r1.data.settlements.length,50);
 assert.equal(r1.data.settlements.find(c=>c.wikidataId==='Q100').reviewStatus,'verified');
 const r2=run({classes:{Q15661340:items},claims},{state:r1.state,data:r1.data});
 assert.equal(r2.calls[0].cursor,r1.state.ancientSettlements.categories.ancient_city.cursor);
 assert.equal(r2.data.settlements.length,60);
});

test('a failed API call keeps the cursor and the data unchanged',()=>{
 const r=run({classes:{Q15661340:[site(11)]},claims:{Q11:{P571:t(-300),P576:t(200)}},failApi:[1,2,3,4,5,6]});
 assert.equal(r.state.ancientSettlements.categories.ancient_city.cursor,'');
 assert.equal(r.data,null);
});

let failed=0;
for(const [name,fn] of tests){
 try{fn();console.log('ok - '+name)}catch(error){failed++;console.error('not ok - '+name+'\n'+(error.stack||error))}
}
console.log(tests.length-failed+'/'+tests.length+' ancient settlement importer tests passed');
if(failed)process.exitCode=1;

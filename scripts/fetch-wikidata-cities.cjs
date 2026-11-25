#!/usr/bin/env node
'use strict';
// Paginated historical settlement import with a durable checkpoint (data/import-state.json).
// Query results are unreviewed, not authoritative.
//
// Each run reads the active category and its nextPage from the checkpoint, fetches up to
// WIKIDATA_MAX_PAGES pages, and after EVERY successfully processed page writes both the
// dataset and the checkpoint. A failed query never advances the checkpoint; a page that was
// processed but held no new usable record does. An empty page marks the category's query
// strategy as exhausted and the import moves to the next category in the queue.
//
// Optional overrides (manual runs): WIKIDATA_CATEGORY, WIKIDATA_START_PAGE,
// WIKIDATA_MAX_PAGES, WIKIDATA_PAGE_SIZE, WIKIDATA_TIME_BUDGET_MS.
// Test hooks: WIKIDATA_RETRY_BASE_MS, WIKIDATA_PAGE_PAUSE_MS.
const fs=require('node:fs');
const path=require('node:path');

const endpoint='https://query.wikidata.org/sparql';
const dataFile='data/imports/wikidata-cities.json';
const stateFile='data/import-state.json';
const userAgent='ChronoEarthHistoricalDatabase/0.3 (https://github.com/scarab0793/chronoearth)';
const maxAttempts=4;
const requestTimeoutMs=60000;
const pauseBetweenPagesMs=Number(process.env.WIKIDATA_PAGE_PAUSE_MS??1500);
const maxRetryAfterMs=120000;
const retryBaseMs=Number(process.env.WIKIDATA_RETRY_BASE_MS??5000); // waits 5s, 10s, 20s between attempts
const failureAlertThreshold=3;

const pageSize=Number(process.env.WIKIDATA_PAGE_SIZE||100);
const maxPages=Number(process.env.WIKIDATA_MAX_PAGES||40);
const timeBudgetMs=Number(process.env.WIKIDATA_TIME_BUDGET_MS||20*60*1000);
if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500||!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw Error('Invalid pagination limits');
if(!Number.isInteger(timeBudgetMs)||timeBudgetMs<1)throw Error('Invalid time budget');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const yearOf=v=>{const m=String(v||'').match(/^([+-]?\d{1,16})-\d\d-\d\dT/);return m&&Number.isSafeInteger(Number(m[1]))?Number(m[1]):null};
const qid=v=>String(v||'').match(/\/entity\/(Q[1-9]\d*)$/)?.[1]||null;
const nowIso=()=>new Date().toISOString();

class QueryError extends Error{constructor(kind,message){super(message);this.kind=kind}}

function writeJsonAtomic(file,value){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');
 fs.renameSync(tmp,file);
}

function loadState(){
 if(!fs.existsSync(stateFile))throw Error(stateFile+' is missing; refusing to guess a start page');
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 const s=state.settlements;
 if(!s||!Array.isArray(s.queue)||!s.categories||typeof s.categories!=='object')throw Error(stateFile+': malformed settlements section');
 for(const [name,c] of Object.entries(s.categories)){
  if(!/^Q[1-9]\d*$/.test(c.wikidataClass||''))throw Error(stateFile+': invalid wikidataClass for '+name);
  if(!Number.isSafeInteger(c.nextPage)||c.nextPage<0)throw Error(stateFile+': invalid nextPage for '+name);
 }
 return state;
}

function sparql(settlementClass,limit,offset){return `SELECT ?item ?itemLabel ?coord ?inception ?dissolution WHERE {
  { SELECT ?item WHERE { ?item wdt:P31 wd:${settlementClass} . } ORDER BY ?item LIMIT ${limit} OFFSET ${offset} }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P576 ?dissolution }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY ?item`}

function retryAfterMs(response){
 const h=response.headers?.get?.('retry-after');
 if(!h)return null;
 const s=Number(h);if(Number.isFinite(s))return s*1000;
 const t=Date.parse(h);return Number.isFinite(t)?Math.max(0,t-Date.now()):null;
}

async function fetchPage(settlementClass,index){
 const url=endpoint+'?'+new URLSearchParams({query:sparql(settlementClass,pageSize,index*pageSize),format:'json'});
 for(let attempt=0;;attempt++){
  let wait=retryBaseMs*2**attempt,error;
  try{
   const response=await fetch(url,{headers:{'Accept':'application/sparql-results+json','User-Agent':userAgent},signal:AbortSignal.timeout(requestTimeoutMs)});
   if(response.status===429||response.status===503){
    const ra=retryAfterMs(response);
    error=new QueryError('rate_limited','SPARQL HTTP '+response.status+(ra!==null?' (Retry-After '+Math.round(ra/1000)+'s)':''));
    if(ra!==null&&ra>maxRetryAfterMs)throw error; // respect long back-off requests: stop the run
    if(ra!==null)wait=Math.max(wait,ra);
   }else if(!response.ok){
    error=new QueryError('transient_error','SPARQL HTTP '+response.status);
   }else{
    const data=await response.json();
    if(Array.isArray(data.results?.bindings))return data.results.bindings;
    error=new QueryError('transient_error','Malformed SPARQL result');
   }
  }catch(caught){
   if(caught instanceof QueryError)throw caught;
   error=new QueryError('transient_error',caught.message||String(caught));
  }
  if(attempt>=maxAttempts-1)throw error;
  console.warn('Page '+(index+1)+' retry '+(attempt+1)+': '+error.message);
  await sleep(wait);
 }
}

function toRecord(row){
 const value=k=>row[k]?.value;
 const id=qid(value('item'));if(!id)return null;
 const m=String(value('coord')||'').match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
 if(!m)return null;
 const lng=Number(m[1]),lat=Number(m[2]);if(Math.abs(lat)>90||Math.abs(lng)>180)return null;
 const from=yearOf(value('inception'));const to=yearOf(value('dissolution'));
 if(from===null)return null;
 if(to!==null&&to<from)return null;
 return {name:value('itemLabel')||id,lat,lng,from,to:to??2026,region:'',source:'https://www.wikidata.org/wiki/'+id,precision:'approximate',note:'Automatically imported settlement; dates and coordinates are unverified and may refer to a modern site.',wikidataId:id,reviewStatus:'unreviewed'};
}

function loadDataset(){
 if(!fs.existsSync(dataFile))return {meta:{},byId:new Map(),count:0};
 const previous=JSON.parse(fs.readFileSync(dataFile,'utf8'));
 if(!Array.isArray(previous.cities))throw Error(dataFile+': cities array missing; refusing to overwrite');
 const byId=new Map();
 for(const old of previous.cities){
  // Keep every previous record regardless of review status.
  if(/^Q[1-9]\d*$/.test(old.wikidataId||'')&&!byId.has(old.wikidataId))byId.set(old.wikidataId,old);
 }
 const {cities,...meta}=previous;
 return {meta,byId,count:previous.cities.length};
}

function summarize(lines){
 const file=process.env.GITHUB_STEP_SUMMARY;
 if(file)fs.appendFileSync(file,lines.join('\n')+'\n');
}

function nextOpenCategory(s,after){
 const start=Math.max(0,s.queue.indexOf(after));
 for(let k=0;k<s.queue.length;k++){
  const name=s.queue[(start+k)%s.queue.length];
  if(s.categories[name]&&s.categories[name].status!=='exhausted')return name;
 }
 return null;
}

async function main(){
 const startedAt=Date.now();
 const state=loadState();
 const s=state.settlements;
 const override=process.env.WIKIDATA_CATEGORY;
 if(override&&!s.categories[override])throw Error('Unknown category '+override);
 let category=override||(s.categories[s.activeCategory]?.status!=='exhausted'?s.activeCategory:nextOpenCategory(s,s.activeCategory));
 const run={startedAt:new Date(startedAt).toISOString(),finishedAt:null,outcome:null,stopReason:null,error:null,pages:[],pagesFetched:0,newRecords:0};

 if(!category){
  run.outcome='all_exhausted';run.stopReason='Every category in the queue is exhausted';run.finishedAt=nowIso();
  s.lastRun=run;writeJsonAtomic(stateFile,state);
  console.log(run.stopReason+'; nothing to fetch');summarize(['### Settlement import',run.stopReason]);
  return;
 }

 const dataset=loadDataset();
 const baseline=dataset.count;
 const startOverride=process.env.WIKIDATA_START_PAGE;
 if(startOverride!==undefined&&startOverride!==''&&(!Number.isSafeInteger(Number(startOverride))||Number(startOverride)<0))throw Error('Invalid start page');
 let pageIndex=startOverride?Number(startOverride):s.categories[category].nextPage;
 const firstPage=pageIndex;
 let categoryStartPage=pageIndex;

 const persist=()=>{
  const cities=[...dataset.byId.values()].sort((a,b)=>a.wikidataId.localeCompare(b.wikidataId,undefined,{numeric:true}));
  if(cities.length<baseline)throw Error('Data-loss guard: '+cities.length+' records would replace '+baseline);
  writeJsonAtomic(dataFile,{...dataset.meta,schemaVersion:2,source:'Wikidata SPARQL',reviewStatus:'unreviewed',importedAt:nowIso(),pagesFetched:run.pagesFetched,startPage:categoryStartPage,nextPage:s.categories[category].nextPage,settlementClass:s.categories[category].wikidataClass,cities});
  s.activeCategory=category;
  writeJsonAtomic(stateFile,state);
 };

 while(run.pagesFetched<maxPages){
  if(Date.now()-startedAt>timeBudgetMs){run.stopReason='time_budget';break}
  const c=s.categories[category];
  let rows;
  try{
   rows=await fetchPage(c.wikidataClass,pageIndex);
   // Confirm an empty page once before declaring the category exhausted.
   if(rows.length===0){console.log(category+' page '+(pageIndex+1)+': empty, confirming');await sleep(pauseBetweenPagesMs);rows=await fetchPage(c.wikidataClass,pageIndex)}
  }
  catch(error){run.outcome=error.kind||'transient_error';run.error=error.message;run.stopReason='Query for '+category+' page '+(pageIndex+1)+' failed; checkpoint not advanced';console.warn(run.stopReason+': '+error.message);break}

  if(rows.length===0){
   c.status='exhausted';c.exhaustedAt=nowIso();c.nextPage=Math.max(c.nextPage,pageIndex);
   run.pages.push({category,page:pageIndex,rows:0,newRecords:0,result:'exhausted'});
   console.log(category+' page '+(pageIndex+1)+': empty; query strategy exhausted');
   persist();
   const next=override?null:nextOpenCategory(s,category);
   if(!next||next===category){run.stopReason=override?'Category '+category+' exhausted':'All categories exhausted';break}
   category=next;pageIndex=s.categories[category].nextPage;categoryStartPage=pageIndex;
   console.log('Switching to category '+category+' at page '+(pageIndex+1));
   continue;
  }

  let added=0;
  for(const row of rows){
   const record=toRecord(row);
   if(!record)continue;
   const existing=dataset.byId.get(record.wikidataId);
   if(!existing)added++;
   // Refresh unreviewed records from the source; never overwrite a reviewed one.
   if(!existing||existing.reviewStatus==='unreviewed')dataset.byId.set(record.wikidataId,record);
  }
  run.pagesFetched++;run.newRecords+=added;
  c.status='in_progress';c.nextPage=Math.max(c.nextPage,pageIndex+1);c.lastSuccessAt=nowIso();
  run.pages.push({category,page:pageIndex,rows:rows.length,newRecords:added,result:added?'new_records':'no_new_records'});
  persist();
  console.log(category+' page '+(pageIndex+1)+': '+rows.length+' rows, '+added+' new; '+dataset.byId.size+' total');
  pageIndex++;
  if(run.pagesFetched<maxPages)await sleep(pauseBetweenPagesMs);
 }

 const failed=Boolean(run.outcome);
 if(failed)run.outcome=run.pagesFetched>0?'partial':run.outcome;
 else if(run.stopReason==='time_budget')run.outcome='partial';
 else if(run.pages.some(p=>p.result==='exhausted'))run.outcome='exhausted';
 else run.outcome='complete';
 s.consecutiveFailures=failed&&run.pages.length===0?(s.consecutiveFailures||0)+1:0;
 run.finishedAt=nowIso();
 // Keep only a compact page log in the checkpoint.
 run.pages=run.pages.slice(-maxPages);
 s.lastRun=run;
 s.activeCategory=category;
 writeJsonAtomic(stateFile,state);

 const msg=['### Settlement import','',
  '| | |','|---|---|',
  '| Outcome | '+run.outcome+' |',
  '| Category | '+category+' ('+s.categories[category].wikidataClass+') |',
  '| Pages processed | '+run.pagesFetched+' (from page '+(firstPage+1)+') |',
  '| New records | '+run.newRecords+' |',
  '| Total records | '+dataset.byId.size+' |',
  '| Next page | '+(s.categories[category].nextPage+1)+' |',
  '| Stop reason | '+(run.stopReason||'page limit reached')+' |',
  '| Consecutive failed runs | '+s.consecutiveFailures+' |'];
 console.log(msg.slice(4).join('\n'));summarize(msg);
 if(s.consecutiveFailures>=failureAlertThreshold){console.error(s.consecutiveFailures+' consecutive runs failed without progress');process.exitCode=1}
}

main().catch(error=>{console.error(error);process.exitCode=1});

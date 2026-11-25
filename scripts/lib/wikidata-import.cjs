'use strict';
// Shared building blocks for checkpointed Wikidata imports.
//
// runCheckpointedImport() drives one dataset section of data/import-state.json:
// it picks the active category, pages through it with a keyset cursor (the last
// Wikidata item IRI seen, compared as a string), persists the dataset and the
// checkpoint after EVERY successfully processed page, and moves to the next
// category in the queue when a category returns an empty page (confirmed once).
// A failed query never advances the cursor; a processed page without new usable
// records does. Record-level logic lives in the caller's processPage().
const fs=require('node:fs');
const path=require('node:path');

const SPARQL_ENDPOINT='https://query.wikidata.org/sparql';
const API_ENDPOINT='https://www.wikidata.org/w/api.php';
const USER_AGENT='ChronoEarthHistoricalDatabase/0.3 (https://github.com/scarab0793/chronoearth)';
const MAX_ATTEMPTS=4;
const REQUEST_TIMEOUT_MS=60000;
const MAX_RETRY_AFTER_MS=120000;
const FAILURE_ALERT_THRESHOLD=3;

const env=(name,fallback)=>process.env[name]!==undefined&&process.env[name]!==''?process.env[name]:fallback;
const retryBaseMs=()=>Number(env('WIKIDATA_RETRY_BASE_MS',5000)); // 5s, 10s, 20s between attempts
const pauseMs=()=>Number(env('WIKIDATA_PAGE_PAUSE_MS',1500));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const nowIso=()=>new Date().toISOString();
const qidOf=v=>String(v||'').match(/\/entity\/(Q[1-9]\d*)$/)?.[1]||null;

class QueryError extends Error{constructor(kind,message){super(message);this.kind=kind}}

function writeJsonAtomic(file,value){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');
 fs.renameSync(tmp,file);
}

function retryAfterMs(response){
 const h=response.headers?.get?.('retry-after');
 if(!h)return null;
 const s=Number(h);if(Number.isFinite(s))return s*1000;
 const t=Date.parse(h);return Number.isFinite(t)?Math.max(0,t-Date.now()):null;
}

// GET a JSON document with retries. Throws QueryError with kind 'rate_limited' or 'transient_error'.
async function getJson(url,accept,label){
 for(let attempt=0;;attempt++){
  let wait=retryBaseMs()*2**attempt,error;
  try{
   const response=await fetch(url,{headers:{'Accept':accept,'User-Agent':USER_AGENT},signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
   if(response.status===429||response.status===503){
    const ra=retryAfterMs(response);
    error=new QueryError('rate_limited',label+' HTTP '+response.status+(ra!==null?' (Retry-After '+Math.round(ra/1000)+'s)':''));
    if(ra!==null&&ra>MAX_RETRY_AFTER_MS)throw error;
    if(ra!==null)wait=Math.max(wait,ra);
   }else if(!response.ok){
    error=new QueryError('transient_error',label+' HTTP '+response.status);
   }else{
    return await response.json();
   }
  }catch(caught){
   if(caught instanceof QueryError)throw caught;
   error=new QueryError('transient_error',label+': '+(caught.message||String(caught)));
  }
  if(attempt>=MAX_ATTEMPTS-1)throw error;
  console.warn(error.message+' — retry '+(attempt+1));
  await sleep(wait);
 }
}

async function sparql(query){
 const data=await getJson(SPARQL_ENDPOINT+'?'+new URLSearchParams({query,format:'json'}),'application/sparql-results+json','SPARQL');
 if(!Array.isArray(data.results?.bindings))throw new QueryError('transient_error','Malformed SPARQL result');
 return data.results.bindings;
}

// Fetch claims for up to 50 entities through the MediaWiki API. Unlike SPARQL, the API
// returns time values as stored: historical year numbering (no year 0) and original calendar.
async function entityClaims(ids,props='claims'){
 if(!ids.length)return {};
 if(ids.length>50)throw Error('wbgetentities accepts at most 50 ids');
 const data=await getJson(API_ENDPOINT+'?'+new URLSearchParams({action:'wbgetentities',ids:ids.join('|'),props,format:'json'}),'application/json','MediaWiki API');
 if(!data.entities||typeof data.entities!=='object')throw new QueryError('transient_error','Malformed wbgetentities result');
 return data.entities;
}

const PRECISION={6:'millennium',7:'century',8:'decade',9:'year',10:'month',11:'day'};
const CALENDAR={'http://www.wikidata.org/entity/Q1985727':'gregorian','http://www.wikidata.org/entity/Q1985786':'julian'};

// Best non-deprecated time value of a property, preferring preferred-rank statements.
function timeClaim(entity,property){
 const claims=(entity?.claims?.[property]||[]).filter(c=>c.rank!=='deprecated'&&c.mainsnak?.snaktype==='value'&&c.mainsnak.datavalue?.type==='time');
 const pick=claims.find(c=>c.rank==='preferred')||claims[0];
 if(!pick)return null;
 const v=pick.mainsnak.datavalue.value;
 const m=String(v.time).match(/^([+-])(\d{1,16})-(\d\d)-(\d\d)T/);
 if(!m)return null;
 const year=(m[1]==='-'?-1:1)*Number(m[2]);
 if(!Number.isSafeInteger(year)||year===0||v.precision<6)return null;
 const out={year,precision:PRECISION[v.precision]||'year',calendar:CALENDAR[v.calendarmodel]||'unknown'};
 if(v.precision>=10&&Number(m[3])>=1)out.month=Number(m[3]);
 if(v.precision>=11&&Number(m[4])>=1)out.day=Number(m[4]);
 return out;
}

function parsePoint(wkt){
 const m=String(wkt||'').match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
 if(!m)return null;
 const lng=Number(m[1]),lat=Number(m[2]);
 return Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
}

function loadSection(stateFile,sectionKey){
 if(!fs.existsSync(stateFile))throw Error(stateFile+' is missing; refusing to guess a start position');
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 const s=state[sectionKey];
 if(!s||!Array.isArray(s.queue)||!s.categories||typeof s.categories!=='object')throw Error(stateFile+': malformed '+sectionKey+' section');
 for(const [name,c] of Object.entries(s.categories)){
  if(!/^Q[1-9]\d*$/.test(c.wikidataClass||''))throw Error(stateFile+': invalid wikidataClass for '+name);
  if(typeof c.cursor!=='string')throw Error(stateFile+': '+name+' needs a string cursor ("" = start)');
 }
 return {state,s};
}

function nextOpenCategory(s,after){
 const start=Math.max(0,s.queue.indexOf(after));
 for(let k=0;k<s.queue.length;k++){
  const name=s.queue[(start+k)%s.queue.length];
  if(s.categories[name]&&s.categories[name].status!=='exhausted')return name;
 }
 return null;
}

function summarize(lines){
 const file=process.env.GITHUB_STEP_SUMMARY;
 if(file)fs.appendFileSync(file,lines.join('\n')+'\n');
}

/**
 * options:
 *  stateFile, sectionKey, dataFile, recordsKey, title, meta (static dataset metadata)
 *  fetchPage(categoryState, cursor) -> {items: string[] (item IRIs in cursor order), rows: any}
 *  processPage(category, page, existingById) -> Promise<record[]> (records with wikidataId)
 */
async function runCheckpointedImport(o){
 const startedAt=Date.now();
 const maxPages=Number(env('WIKIDATA_MAX_PAGES',40));
 const timeBudgetMs=Number(env('WIKIDATA_TIME_BUDGET_MS',20*60*1000));
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>200)throw Error('Invalid WIKIDATA_MAX_PAGES');
 if(!Number.isInteger(timeBudgetMs)||timeBudgetMs<1)throw Error('Invalid WIKIDATA_TIME_BUDGET_MS');
 const {state,s}=loadSection(o.stateFile,o.sectionKey);
 const override=env('WIKIDATA_CATEGORY','');
 if(override&&!s.categories[override])throw Error('Unknown category '+override);
 let category=override||(s.categories[s.activeCategory]&&s.categories[s.activeCategory].status!=='exhausted'?s.activeCategory:nextOpenCategory(s,s.activeCategory));
 const run={startedAt:new Date(startedAt).toISOString(),finishedAt:null,outcome:null,stopReason:null,error:null,pages:[],pagesFetched:0,newRecords:0};

 const finish=()=>{
  run.finishedAt=nowIso();
  s.lastRun=run;
  if(category)s.activeCategory=category;
  writeJsonAtomic(o.stateFile,state);
 };

 if(!category){
  // Nothing to do: leave the checkpoint untouched so the workflow makes no commit.
  run.outcome='all_exhausted';run.stopReason='Every category in the queue is exhausted';
  console.log(run.stopReason+'; nothing to fetch');summarize(['### '+o.title,run.stopReason]);
  return;
 }

 let previous={};
 const byId=new Map();
 if(fs.existsSync(o.dataFile)){
  previous=JSON.parse(fs.readFileSync(o.dataFile,'utf8'));
  if(!Array.isArray(previous[o.recordsKey]))throw Error(o.dataFile+': '+o.recordsKey+' array missing; refusing to overwrite');
  for(const r of previous[o.recordsKey])if(/^Q[1-9]\d*$/.test(r.wikidataId||'')&&!byId.has(r.wikidataId))byId.set(r.wikidataId,r);
 }
 const baseline=byId.size;

 const persist=()=>{
  const records=[...byId.values()].sort((a,b)=>a.wikidataId.localeCompare(b.wikidataId,undefined,{numeric:true}));
  if(records.length<baseline)throw Error('Data-loss guard: '+records.length+' records would replace '+baseline);
  const {[o.recordsKey]:_old,...prevMeta}=previous;
  // Do not create an empty dataset: validation requires at least one record.
  if(records.length)writeJsonAtomic(o.dataFile,{...prevMeta,...o.meta,importedAt:nowIso(),[o.recordsKey]:records});
  s.activeCategory=category;
  writeJsonAtomic(o.stateFile,state);
 };

 while(run.pagesFetched<maxPages){
  if(Date.now()-startedAt>timeBudgetMs){run.stopReason='time_budget';break}
  const c=s.categories[category];
  let page,records;
  try{
   page=await o.fetchPage(c,c.cursor);
   if(page.items.length===0){
    console.log(category+': empty page after cursor '+(c.cursor||'(start)')+', confirming');
    await sleep(pauseMs());
    page=await o.fetchPage(c,c.cursor);
   }
   if(page.items.length)records=await o.processPage(category,page,byId);
  }catch(error){
   run.outcome=error.kind||'transient_error';run.error=error.message;
   run.stopReason=category+' page after cursor '+(c.cursor||'(start)')+' failed; checkpoint not advanced';
   console.warn(run.stopReason+': '+error.message);
   break;
  }

  if(page.items.length===0){
   c.status='exhausted';c.exhaustedAt=nowIso();
   run.pages.push({category,cursor:c.cursor,items:0,newRecords:0,result:'exhausted'});
   console.log(category+': query strategy exhausted');
   persist();
   const next=override?null:nextOpenCategory(s,category);
   if(!next||next===category){run.stopReason=override?'Category '+category+' exhausted':'All categories exhausted';break}
   category=next;
   console.log('Switching to category '+category);
   continue;
  }

  let added=0;
  for(const record of records){
   const existing=byId.get(record.wikidataId);
   if(!existing)added++;
   // Refresh unreviewed records from the source; never overwrite a reviewed one.
   if(!existing||existing.reviewStatus==='unreviewed')byId.set(record.wikidataId,record);
  }
  const lastItem=page.items[page.items.length-1];
  if(!(lastItem>c.cursor))throw Error('Cursor did not advance ('+c.cursor+' -> '+lastItem+'); refusing to loop');
  c.cursor=lastItem;c.status='in_progress';c.pagesDone=(c.pagesDone||0)+1;c.lastSuccessAt=nowIso();
  run.pagesFetched++;run.newRecords+=added;
  run.pages.push({category,cursor:lastItem,items:page.items.length,newRecords:added,result:added?'new_records':'no_new_records'});
  persist();
  console.log(category+' page '+c.pagesDone+': '+page.items.length+' items, '+records.length+' usable, '+added+' new; '+byId.size+' total');
  if(run.pagesFetched<maxPages)await sleep(pauseMs());
 }

 const failed=Boolean(run.outcome);
 if(failed)run.outcome=run.pagesFetched>0?'partial':run.outcome;
 else if(run.stopReason==='time_budget')run.outcome='partial';
 else if(run.pages.some(p=>p.result==='exhausted'))run.outcome='exhausted';
 else run.outcome='complete';
 s.consecutiveFailures=failed&&run.pages.length===0?(s.consecutiveFailures||0)+1:0;
 run.pages=run.pages.slice(-maxPages);
 finish();

 const c=s.categories[category];
 const msg=['### '+o.title,'','| | |','|---|---|',
  '| Outcome | '+run.outcome+' |',
  '| Category | '+category+' ('+c.wikidataClass+') |',
  '| Pages processed | '+run.pagesFetched+' |',
  '| New records | '+run.newRecords+' |',
  '| Total records | '+byId.size+' |',
  '| Cursor | '+(qidOf(c.cursor)||'(start)')+' |',
  '| Stop reason | '+(run.stopReason||'page limit reached')+' |',
  '| Consecutive failed runs | '+s.consecutiveFailures+' |'];
 console.log(msg.slice(4).join('\n'));summarize(msg);
 if(s.consecutiveFailures>=FAILURE_ALERT_THRESHOLD){console.error(s.consecutiveFailures+' consecutive runs failed without progress');process.exitCode=1}
}

module.exports={QueryError,sparql,entityClaims,timeClaim,parsePoint,qidOf,writeJsonAtomic,runCheckpointedImport,sleep};

#!/usr/bin/env node
'use strict';
// Paginated historical settlement import. Query results are unreviewed, not authoritative.
const fs=require('node:fs');
const endpoint='https://query.wikidata.org/sparql';
const pageSize=Number(process.env.WIKIDATA_PAGE_SIZE||100);
const maxPages=Number(process.env.WIKIDATA_MAX_PAGES||30);
if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500||!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw Error('Invalid pagination limits');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const yearOf=v=>{const m=String(v||'').match(/^([+-]?\d{1,16})-\d\d-\d\dT/);return m&&Number.isSafeInteger(Number(m[1]))?Number(m[1]):null};
const qid=v=>String(v||'').match(/\/entity\/(Q[1-9]\d*)$/)?.[1]||null;
function sparql(limit,offset){return `SELECT ?item ?itemLabel ?coord ?inception ?dissolution WHERE {
  { SELECT ?item WHERE { ?item wdt:P31 wd:Q515 . } ORDER BY ?item LIMIT ${limit} OFFSET ${offset} }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P576 ?dissolution }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY ?item`}
async function page(index){
 const url=endpoint+'?'+new URLSearchParams({query:sparql(pageSize,index*pageSize),format:'json'});
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetch(url,{headers:{'Accept':'application/sparql-results+json','User-Agent':'ChronoEarthHistoricalDatabase/0.2 (https://github.com/scarab0793/chronoearth)'} ,signal:AbortSignal.timeout(25000)});
   if(!response.ok)throw Error('SPARQL HTTP '+response.status);
   const data=await response.json();if(!Array.isArray(data.results?.bindings))throw Error('Malformed SPARQL result');
   return data.results.bindings;
  }catch(error){if(attempt===1)throw error;await sleep(3000*(attempt+1))}
 }
}
async function main(){
 const byId=new Map();let pages=0;
 for(let i=0;i<maxPages;i++){
  const rows=await page(i);pages++;
  for(const row of rows){
   const value=k=>row[k]?.value;
   const id=qid(value('item'));if(!id)continue;
   const m=String(value('coord')||'').match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
   if(!m)continue;
   const lng=Number(m[1]),lat=Number(m[2]);if(Math.abs(lat)>90||Math.abs(lng)>180)continue;
   const from=yearOf(value('inception'));const to=yearOf(value('dissolution'));
   if(from===null)continue;
   if(to!==null&&to<from)continue;
   if(!byId.has(id))byId.set(id,{name:value('itemLabel')||id,lat,lng,from,to:to??2026,region:'',source:'https://www.wikidata.org/wiki/'+id,precision:'approximate',note:'Automatically imported settlement; dates and coordinates are unverified and may refer to a modern site.',wikidataId:id,reviewStatus:'unreviewed'});
  }
  console.log('Page '+(i+1)+': '+rows.length+' rows; '+byId.size+' distinct dated settlements');
  if(rows.length<pageSize)break;
  await sleep(1500);
 }
 if(byId.size===0)throw Error('No valid dated settlement records; keeping existing dataset');
 const cities=[...byId.values()].sort((a,b)=>a.wikidataId.localeCompare(b.wikidataId,undefined,{numeric:true}));
 fs.mkdirSync('data/imports',{recursive:true});
 fs.writeFileSync('data/imports/wikidata-cities.json',JSON.stringify({schemaVersion:2,source:'Wikidata SPARQL',reviewStatus:'unreviewed',importedAt:new Date().toISOString(),pagesFetched:pages,cities},null,2)+'\n');
 console.log('Wrote '+cities.length+' historical settlement records');
}
main().catch(error=>{console.error(error);process.exitCode=1});

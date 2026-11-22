#!/usr/bin/env node
'use strict';
// Import Wikidata people as a provenance-preserving catalogue, not map pins.
// Birth and death dates are asserted claims, not verified biographies.
const fs=require('node:fs');
const pageSize=100,maxPages=10;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const query=(offset)=>`SELECT ?person ?personLabel ?birth ?death WHERE {
 { SELECT ?person WHERE { ?person wdt:P31 wd:Q5 ; wdt:P569 ?birthDate . FILTER(YEAR(?birthDate) < 1900) } ORDER BY ?person LIMIT ${pageSize} OFFSET ${offset} }
 OPTIONAL { ?person wdt:P569 ?birth }
 OPTIONAL { ?person wdt:P570 ?death }
 SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY ?person`;
const year=v=>{const m=String(v||'').match(/^([+-]?\d+)-\d\d-\d\dT/);return m?Number(m[1]):null};
async function fetchPage(offset){
 const url='https://query.wikidata.org/sparql?'+new URLSearchParams({query:query(offset),format:'json'});
 for(let attempt=0;attempt<2;attempt++){
  try{
   const r=await fetch(url,{headers:{Accept:'application/sparql-results+json','User-Agent':'ChronoEarthHistoricalDatabase/0.2 (https://github.com/scarab0793/chronoearth)'},signal:AbortSignal.timeout(25000)});
   if(!r.ok)throw Error('Wikidata HTTP '+r.status);
   const j=await r.json();if(!Array.isArray(j.results?.bindings))throw Error('Invalid SPARQL response');
   return j.results.bindings;
  }catch(e){if(attempt===1)throw e;await delay(2500)}
 }
}
async function main(){
 const people=new Map();
 for(let i=0;i<maxPages;i++){
  const rows=await fetchPage(i*pageSize);
  for(const row of rows){
   const v=k=>row[k]?.value;
   const id=String(v('person')||'').match(/\/entity\/(Q[1-9]\d*)$/)?.[1];
   const from=year(v('birth')),to=year(v('death'));
   if(!id||!Number.isSafeInteger(from)||from>2026||to!==null&&(!Number.isSafeInteger(to)||to<from))continue;
   if(!people.has(id))people.set(id,{id:'wikidata:'+id,wikidataId:id,name:v('personLabel')||id,birthYear:from,deathYear:to,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',location:null});
  }
  console.log('Page '+(i+1)+': '+rows.length+' results; '+people.size+' distinct people');
  if(rows.length<pageSize)break;
  await delay(1500);
 }
 if(!people.size)throw Error('No valid records; existing catalogue unchanged');
 const records=[...people.values()].sort((a,b)=>a.wikidataId.localeCompare(b.wikidataId,undefined,{numeric:true}));
 fs.mkdirSync('data/imports',{recursive:true});
 fs.writeFileSync('data/imports/wikidata-people.json',JSON.stringify({schemaVersion:1,source:'Wikidata SPARQL',importedAt:new Date().toISOString(),reviewStatus:'unreviewed',people:records},null,2)+'\n');
 console.log('Imported '+records.length+' people');
}
main().catch(e=>{console.error(e);process.exitCode=1});

#!/usr/bin/env node
'use strict';
// Discovery via Wikidata API; validate event-type ancestry conservatively.
const fs=require('node:fs');
const terms=['Battle of Hastings','Battle of Waterloo','Battle of Marathon','Battle of Thermopylae','Battle of Agincourt','Battle of Stalingrad','Battle of Gettysburg','Battle of Trafalgar','Battle of Midway','Battle of Britain','Fall of Constantinople','French Revolution','Russian Revolution','American Revolution','Industrial Revolution','October Revolution','Glorious Revolution','Revolutions of 1848','Black Death','Great Fire of London','Great Depression','World War I','World War II','Thirty Years War','Hundred Years War','Crimean War','Napoleonic Wars','American Civil War','Korean War','Vietnam War','First Crusade','Fourth Crusade','Siege of Vienna','Siege of Leningrad','Sack of Rome','Magna Carta','Declaration of Independence','Treaty of Versailles','Treaty of Westphalia','Treaty of Tordesillas','Congress of Vienna','Berlin Wall fall','Apollo 11','Chernobyl disaster','Pompeii eruption','Lisbon earthquake','Great Famine Ireland','Spanish flu','Cuban Missile Crisis','Dissolution of the Soviet Union'];
const api='https://www.wikidata.org/w/api.php';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(params){
 for(let n=0;n<3;n++){
  try{
   const response=await fetch(api+'?'+new URLSearchParams({...params,format:'json'}),{headers:{'User-Agent':'ChronoEarthHistoricalDatabase/0.4 (https://github.com/scarab0793/chronoearth)'},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Wikidata HTTP '+response.status);
   const j=await response.json();if(j.error)throw Error(JSON.stringify(j.error));return j;
  }catch(e){if(n===2)throw e;await wait(1500*(n+1))}
 }
}
const claim=(e,p)=>e.claims?.[p]?.find(c=>c.mainsnak?.snaktype==='value')?.mainsnak?.datavalue?.value;
const year=v=>{const m=String(v?.time||'').match(/^([+-])(\d+)-/);if(!m)return null;const y=Number(m[2])*(m[1]==='-'?-1:1);return Number.isSafeInteger(y)?y:null};
async function main(){
 const ids=new Set();
 for(const term of terms){
  const j=await get({action:'wbsearchentities',search:term,language:'en',type:'item',limit:'3'});
  for(const hit of j.search||[])if(/^Q[1-9]\d*$/.test(hit.id))ids.add(hit.id);
  await wait(200);
 }
 const events=new Map(),all=[...ids];
 for(let i=0;i<all.length;i+=40){
  const j=await get({action:'wbgetentities',ids:all.slice(i,i+40).join('|'),props:'labels|descriptions|claims',languages:'en|hu'});
  for(const [id,e] of Object.entries(j.entities||{})){
   if(e.missing)continue;
   const date=year(claim(e,'P585'))??year(claim(e,'P580'))??year(claim(e,'P571'));
   if(date===null||date>2026||date< -10000)continue;
   const label=e.labels?.en?.value||e.labels?.hu?.value;
   if(!label)continue;
   const kinds=(e.claims?.P31||[]).map(x=>x.mainsnak?.datavalue?.value?.id).filter(Boolean);
   // Exclude humans, geographic locations and other ambiguous hits.
   if(kinds.includes('Q5')||kinds.includes('Q515')||kinds.includes('Q6256'))continue;
   events.set(id,{id:'wikidata:'+id,wikidataId:id,name:label,year:date,description:e.descriptions?.en?.value||'',typeIds:kinds,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',location:null});
  }
  await wait(300);
 }
 if(!events.size)throw Error('No dated event candidates; preserve existing data');
 const records=[...events.values()].sort((a,b)=>a.year-b.year||a.wikidataId.localeCompare(b.wikidataId));
 fs.mkdirSync('data/imports',{recursive:true});
 fs.writeFileSync('data/imports/wikidata-events.json',JSON.stringify({schemaVersion:1,source:'Wikidata MediaWiki API',importedAt:new Date().toISOString(),reviewStatus:'unreviewed',note:'Candidate event catalogue; each item needs historical type and date review.',events:records},null,2)+'\n');
 console.log('Imported '+records.length+' dated event candidates');
}
main().catch(e=>{console.error(e);process.exitCode=1});

#!/usr/bin/env node
'use strict';
// Wikidata MediaWiki API importer: avoids expensive SPARQL scans.
// Search is discovery only; entity P31=human and birth-date claims are checked.
const fs=require('node:fs');
const api='https://www.wikidata.org/w/api.php';
const terms=['Roman emperor','Roman general','ancient Greek philosopher','ancient Egyptian pharaoh','medieval king','medieval queen','Renaissance scientist','Renaissance artist','historian','astronomer','mathematician','explorer','inventor','composer','Napoleonic general','scientist','political philosopher','medieval scholar','Chinese emperor','Mongol ruler'];
const seed=['Q1048','Q635','Q720','Q91','Q1035','Q1233','Q859','Q692','Q762','Q1426','Q7259','Q1339','Q937','Q7186','Q5582','Q5879','Q9036','Q8007','Q8462','Q4965','Q5715','Q1067','Q260','Q22670','Q9061','Q7245'];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function request(params){
 const url=api+'?'+new URLSearchParams({...params,format:'json'});
 for(let n=0;n<3;n++){
  try{
   const r=await fetch(url,{headers:{'User-Agent':'ChronoEarthHistoricalDatabase/0.3 (https://github.com/scarab0793/chronoearth)'},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Wikidata API '+r.status);
   const data=await r.json();if(data.error)throw Error(JSON.stringify(data.error));return data;
  }catch(e){if(n===2)throw e;await wait(1500*(n+1))}
 }
}
const claim=(e,p)=>e.claims?.[p]?.find(c=>c.mainsnak?.snaktype==='value')?.mainsnak?.datavalue?.value;
const years=v=>{if(!v?.time)return null;const m=v.time.match(/^([+-])(\d+)-/);if(!m)return null;const y=Number(m[2])*(m[1]==='-'?-1:1);return Number.isSafeInteger(y)?y:null};
async function main(){
 const ids=new Set(seed);
 for(const term of terms){
  const data=await request({action:'wbsearchentities',search:term,language:'en',type:'item',limit:'50'});
  for(const hit of data.search||[])if(/^Q[1-9]\d*$/.test(hit.id))ids.add(hit.id);
  await wait(250);
 }
 const people=new Map(),all=[...ids];
 for(let i=0;i<all.length;i+=40){
  const data=await request({action:'wbgetentities',ids:all.slice(i,i+40).join('|'),props:'labels|claims',languages:'en|hu'});
  for(const [id,e] of Object.entries(data.entities||{})){
   if(e.missing)continue;
   const instance=e.claims?.P31||[];
   if(!instance.some(c=>c.mainsnak?.datavalue?.value?.id==='Q5'))continue;
   const birth=years(claim(e,'P569')),death=years(claim(e,'P570'));
   if(!Number.isSafeInteger(birth)||birth>1900||death!==null&&(!Number.isSafeInteger(death)||death<birth))continue;
   people.set(id,{id:'wikidata:'+id,wikidataId:id,name:e.labels?.en?.value||e.labels?.hu?.value||id,birthYear:birth,deathYear:death,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',location:null});
  }
  console.log('Processed '+Math.min(i+40,all.length)+' of '+all.length+' candidates; '+people.size+' historical people');
  await wait(300);
 }
 if(!people.size)throw Error('No verified-human historical records; existing data unchanged');
 fs.mkdirSync('data/imports',{recursive:true});
 const records=[...people.values()].sort((a,b)=>a.wikidataId.localeCompare(b.wikidataId,undefined,{numeric:true}));
 fs.writeFileSync('data/imports/wikidata-people.json',JSON.stringify({schemaVersion:2,source:'Wikidata MediaWiki API',importedAt:new Date().toISOString(),reviewStatus:'unreviewed',people:records},null,2)+'\n');
 console.log('Imported '+records.length+' historical people');
}
main().catch(e=>{console.error(e);process.exitCode=1});

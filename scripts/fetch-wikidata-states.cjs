#!/usr/bin/env node
'use strict';
// Discovery catalogue of historical polities; NEVER invent historical borders.
const fs=require('node:fs');
const terms=['Roman Empire','Roman Republic','Byzantine Empire','Ottoman Empire','Mongol Empire','British Empire','Spanish Empire','Portuguese Empire','Russian Empire','Holy Roman Empire','Achaemenid Empire','Sasanian Empire','Parthian Empire','Seleucid Empire','Ptolemaic Kingdom','Macedonian Empire','Maurya Empire','Gupta Empire','Mughal Empire','Delhi Sultanate','Qing dynasty','Ming dynasty','Han dynasty','Tang dynasty','Song dynasty','Yuan dynasty','Qin dynasty','Aztec Empire','Inca Empire','Mali Empire','Songhai Empire','Ghana Empire','Kingdom of Kush','Kingdom of Aksum','Kingdom of Hungary','Kingdom of Poland','Polish Lithuanian Commonwealth','Kingdom of France','Kingdom of England','Kingdom of Scotland','Kingdom of Prussia','Austro-Hungarian Empire','Habsburg monarchy','German Empire','Weimar Republic','Soviet Union','Yugoslavia','Czechoslovakia','Kingdom of Jerusalem','Carolingian Empire','Abbasid Caliphate','Umayyad Caliphate','Fatimid Caliphate','Safavid Iran','Timurid Empire','Golden Horde','Kievan Rus','Grand Duchy of Lithuania','Republic of Venice','Republic of Genoa','Dutch Republic','First French Empire','Second French Empire','United States of America','Confederate States of America','Kingdom of Italy','Empire of Japan','Joseon','Goryeo','Khmer Empire','Srivijaya','Majapahit','Ayutthaya Kingdom','Kingdom of Siam','Duchy of Burgundy','Kingdom of Bohemia'];
const api='https://www.wikidata.org/w/api.php';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(params){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await fetch(api+'?'+new URLSearchParams({...params,format:'json'}),{headers:{'User-Agent':'ChronoEarthHistoricalDatabase/0.5 (https://github.com/scarab0793/chronoearth)'},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Wikidata HTTP '+r.status);
   const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j;
  }catch(e){if(attempt===2)throw e;await wait(1500*(attempt+1))}
 }
}
const claim=(e,p)=>e.claims?.[p]?.find(c=>c.mainsnak?.snaktype==='value')?.mainsnak?.datavalue?.value;
const year=v=>{const m=String(v?.time||'').match(/^([+-])(\d+)-/);if(!m)return null;const y=Number(m[2])*(m[1]==='-'?-1:1);return Number.isSafeInteger(y)?y:null};
async function main(){
 const ids=new Set();
 for(const term of terms){
  const j=await get({action:'wbsearchentities',search:term,language:'en',type:'item',limit:'3'});
  for(const x of j.search||[])if(/^Q[1-9]\d*$/.test(x.id))ids.add(x.id);
  await wait(180);
 }
 const states=new Map(),all=[...ids];
 for(let i=0;i<all.length;i+=40){
  const j=await get({action:'wbgetentities',ids:all.slice(i,i+40).join('|'),props:'labels|descriptions|claims',languages:'en|hu'});
  for(const [id,e] of Object.entries(j.entities||{})){
   if(e.missing||!e.labels?.en?.value)continue;
   const kinds=(e.claims?.P31||[]).map(x=>x.mainsnak?.datavalue?.value?.id).filter(Boolean);
   if(kinds.includes('Q5')||kinds.includes('Q515'))continue;
   const from=year(claim(e,'P571'))??year(claim(e,'P580'));
   const to=year(claim(e,'P576'))??year(claim(e,'P582'));
   if(from===null||from>2026||to!==null&&to<from)continue;
   states.set(id,{id:'wikidata:'+id,wikidataId:id,name:e.labels.en.value,from,to,description:e.descriptions?.en?.value||'',typeIds:kinds,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',borderStatus:'unmapped',geometry:null});
  }
  await wait(250);
 }
 if(!states.size)throw Error('No dated polity candidates; preserve previous data');
 fs.mkdirSync('data/imports',{recursive:true});
 const records=[...states.values()].sort((a,b)=>a.from-b.from||a.wikidataId.localeCompare(b.wikidataId));
 fs.writeFileSync('data/imports/wikidata-states.json',JSON.stringify({schemaVersion:1,source:'Wikidata MediaWiki API',importedAt:new Date().toISOString(),reviewStatus:'unreviewed',note:'Candidate historical polities. Type, foundation/dissolution dates and boundaries require verification.',states:records},null,2)+'\n');
 console.log('Imported '+records.length+' historical polity candidates');
}
main().catch(e=>{console.error(e);process.exitCode=1});

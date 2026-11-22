#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const ids=['Q1748','Q12544','Q34266','Q11772','Q28513','Q220','Q64','Q90','Q84','Q60','Q65','Q1490','Q1489','Q1524','Q1520','Q1780','Q1861','Q19660','Q12191','Q2449','Q649','Q25270','Q1439','Q8686','Q472','Q34692','Q242','Q34370','Q1435','Q1353','Q1311','Q1533','Q19689','Q1770','Q384','Q727','Q85','Q174','Q1740','Q1744','Q1764','Q1438','Q11194','Q1431','Q1563','Q1579','Q1580','Q1583','Q1587','Q1589'];
const allowedCityIds=new Set(['Q727','Q1520','Q1524','Q1861','Q64','Q1780','Q19660','Q85','Q1533','Q1748','Q1353','Q1563','Q34692','Q84','Q65','Q1489','Q60','Q90','Q1764','Q220','Q174','Q11194','Q8686','Q19689','Q1490','Q1435']);
const endpoint='https://www.wikidata.org/w/api.php';
const params=new URLSearchParams({action:'wbgetentities',ids:ids.join('|'),props:'labels|claims',languages:'en|hu',format:'json'});
async function main(){
 const response=await fetch(endpoint+'?'+params,{headers:{'User-Agent':'ChronoEarthHistoricalDatabase/0.1 (https://github.com/scarab0793/chronoearth)'}});
 if(!response.ok)throw Error('Wikidata API HTTP '+response.status);
 const data=await response.json();const cities=[];
 for(const [qid,e] of Object.entries(data.entities||{})){
  if(e.missing||!allowedCityIds.has(qid))continue;
  const claim=(prop)=>e.claims?.[prop]?.find(c=>c.mainsnak?.snaktype==='value')?.mainsnak?.datavalue?.value;
  const coordinates=claim('P625');if(!coordinates||!Number.isFinite(coordinates.latitude)||!Number.isFinite(coordinates.longitude))continue;
  const parseYear=(value)=>{if(!value?.time)return null;const match=value.time.match(/^([+-])(\d+)-/);if(!match)return null;const y=Number(match[2])*(match[1]==='-'?-1:1);return Number.isSafeInteger(y)?y:null};
  const from=parseYear(claim('P571'))??parseYear(claim('P1319'));
  const to=parseYear(claim('P576'))??parseYear(claim('P1326'));
  // Do not invent a historical lifespan from present-day city status.
  if(from===null&&to===null)continue;
  const name=e.labels?.en?.value||e.labels?.hu?.value||qid;
  cities.push({name,lat:coordinates.latitude,lng:coordinates.longitude,from:from??-10000,to:to??2026,region:'',source:'https://www.wikidata.org/wiki/'+qid,precision:'approximate',note:'Wikidata-derived dates and coordinates; historical interpretation requires verification.',wikidataId:qid,reviewStatus:'unreviewed'});
 }
 cities.sort((a,b)=>a.name.localeCompare(b.name));
 fs.mkdirSync('data/imports',{recursive:true});
 fs.writeFileSync('data/imports/wikidata-cities.json',JSON.stringify({schemaVersion:1,source:'Wikidata',reviewStatus:'unreviewed',importedAt:new Date().toISOString(),cities},null,2)+'\n');
 console.log('Wrote '+cities.length+' dated, geolocated Wikidata records');
 if(cities.length===0)throw Error('No dated and geolocated records returned; refusing empty replacement');
}
main().catch(e=>{console.error(e);process.exitCode=1});

#!/usr/bin/env node
'use strict';
// Validate imported datasets independently from the curated historical corpus.
const fs=require('node:fs');
const definitions=[
 ['cities','data/imports/wikidata-cities.json','cities'],
 ['people','data/imports/wikidata-people.json','people'],
 ['events','data/imports/wikidata-events.json','events'],
 ['states','data/imports/wikidata-states.json','states']
];
let errors=0;
function check(ok,message){if(!ok){console.error('ERROR: '+message);errors++}}
for(const [kind,file,key] of definitions){
 if(!fs.existsSync(file)){console.log('SKIP: '+file+' not imported yet');continue}
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 const rows=data[key];
 check(Array.isArray(rows)&&rows.length>0,file+': missing records');
 if(!Array.isArray(rows))continue;
 const seen=new Set();
 for(let i=0;i<rows.length;i++){
  const p=rows[i],prefix=file+' ['+i+']';
  check(typeof p.name==='string'&&p.name.trim().length>0,prefix+': missing name');
  check(/^Q[1-9]\d*$/.test(p.wikidataId||''),prefix+': invalid Wikidata ID');
  check(!seen.has(p.wikidataId),prefix+': duplicate Wikidata ID');seen.add(p.wikidataId);
  check(p.source==='https://www.wikidata.org/wiki/'+p.wikidataId,prefix+': invalid source');
  check(p.reviewStatus==='unreviewed',prefix+': must mark source records unreviewed');
  if(kind==='cities'){
   check(Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180,prefix+': invalid coordinates');
   check(Number.isSafeInteger(p.from)&&Number.isSafeInteger(p.to)&&p.from<=p.to,prefix+': invalid time range');
  }else if(kind==='people'){
   check(Number.isSafeInteger(p.birthYear)&&p.birthYear<=1900,prefix+': invalid birth year');
   check(p.deathYear===null||Number.isSafeInteger(p.deathYear)&&p.deathYear>=p.birthYear,prefix+': invalid death year');
   check(p.location===null,prefix+': unverifiable location must remain null');
  }else if(kind==='events'){
   check(Number.isSafeInteger(p.year)&&p.year>=-10000&&p.year<=2026,prefix+': invalid event year');
   check(p.location===null,prefix+': unverified event location must remain null');
  }else{
   check(Number.isSafeInteger(p.from)&&p.from<=2026,prefix+': invalid foundation year');
   check(p.to===null||Number.isSafeInteger(p.to)&&p.to>=p.from,prefix+': invalid dissolution year');
   check(p.geometry===null&&p.borderStatus==='unmapped',prefix+': missing verified boundaries must remain unmapped');
  }
 }
 console.log(kind+': '+rows.length+' checked records');
}
if(errors){console.error(errors+' import validation error(s)');process.exitCode=1}else console.log('All present import datasets passed structural checks');

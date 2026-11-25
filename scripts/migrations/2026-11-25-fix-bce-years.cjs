#!/usr/bin/env node
'use strict';
// One-off data fix: settlement years read from SPARQL before this fix used astronomical
// numbering for BCE year-precision dates (one year too late). Applies the API-verified
// values from the companion JSON. Idempotent: a record is changed only if it still holds
// the stored (shifted) value.
const fs=require('node:fs');
const file='data/imports/wikidata-cities.json';
const fix=JSON.parse(fs.readFileSync(__dirname+'/2026-11-25-fix-bce-years.json','utf8')).records;
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const byId=new Map(data.cities.map(c=>[c.wikidataId,c]));
let changed=0,skipped=0;
for(const [id,stored,apiYear,precision] of fix){
 const c=byId.get(id);
 if(!c||c.reviewStatus!=='unreviewed'||precision<9||stored===apiYear){skipped++;continue}
 if(c.from===stored){c.from=apiYear;changed++}else skipped++;
}
fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
console.log('BCE year fix: '+changed+' records corrected, '+skipped+' unchanged');

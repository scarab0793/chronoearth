#!/usr/bin/env node
'use strict';
// Reproducible coverage snapshot from committed import data; no invented records.
const fs=require('node:fs');
const kinds=['cities','people','events','states','battles','ancient-settlements','castles','located-events'];
const KEYS={'ancient-settlements':'settlements','located-events':'events'};
const report={schemaVersion:1,generatedAt:new Date().toISOString(),total:0,byCategory:{},centuries:{},warnings:[]};
for(const kind of kinds){
 const file='data/imports/wikidata-'+kind+'.json';
 if(!fs.existsSync(file)){report.warnings.push(file+' missing');continue}
 const rows=JSON.parse(fs.readFileSync(file,'utf8'))[KEYS[kind]||kind];
 if(!Array.isArray(rows))throw Error(file+' invalid records');
 const years=rows.map(r=>kind==='people'?r.birthYear:kind==='events'?r.year:kind==='battles'||kind==='castles'||kind==='located-events'?r.y:r.from).filter(Number.isSafeInteger);
 const unreviewed=rows.filter(r=>r.reviewStatus==='unreviewed').length;
 const withSource=rows.filter(r=>r.source==='https://www.wikidata.org/wiki/'+r.wikidataId).length;
 report.byCategory[kind]={count:rows.length,unreviewed,withSource,earliestYear:years.length?Math.min(...years):null,latestYear:years.length?Math.max(...years):null};
 report.total+=rows.length;
 for(const year of years){
  const century=Math.floor((year-1)/100)+1;
  const key=String(century);
  if(!report.centuries[key])report.centuries[key]=Object.fromEntries(kinds.map(k=>[k,0]));
  report.centuries[key][kind]++;
 }
}
report.centuries=Object.fromEntries(Object.entries(report.centuries).sort((a,b)=>Number(a[0])-Number(b[0])));
fs.mkdirSync('data/reports',{recursive:true});
fs.writeFileSync('data/reports/import-coverage.json',JSON.stringify(report,null,2)+'\n');
console.log('Import coverage report: '+report.total+' source records');
for(const [kind,summary] of Object.entries(report.byCategory))console.log(kind+': '+summary.count+' records, '+summary.withSource+' sourced, '+summary.unreviewed+' unreviewed');

#!/usr/bin/env node
'use strict';
// Normalize Wikidata SPARQL JSON results without silently inventing dates or coordinates.
// Usage: node scripts/import-wikidata.cjs input.json output.json
const fs=require('node:fs');
const path=require('node:path');
const input=process.argv[2],output=process.argv[3];
if(!input||!output){console.error('Usage: node scripts/import-wikidata.cjs input.json output.json');process.exit(2)}
const raw=JSON.parse(fs.readFileSync(input,'utf8'));
if(!Array.isArray(raw.results?.bindings))throw Error('Expected SPARQL JSON results.bindings');
const val=(row,key)=>row[key]?.value??null;
const qid=(uri)=>{const m=String(uri||'').match(/\/entity\/(Q[1-9][0-9]*)$/);return m?m[1]:null};
const date=(str)=>{if(!str)return null;const m=String(str).match(/^(-?\d{1,16})-(\d{2})-(\d{2})T/);if(!m)return null;const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);return Number.isSafeInteger(year)&&month>=1&&month<=12&&day>=1&&day<=31?{year,month,day,precision:'day-as-exported'}:null};
const coord=(s)=>{if(!s)return null;const m=String(s).match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);if(!m)return null;const longitude=Number(m[1]),latitude=Number(m[2]);return Math.abs(latitude)<=90&&Math.abs(longitude)<=180?{latitude,longitude}:null};
const records=new Map(),issues=[];
for(const [i,row] of raw.results.bindings.entries()){
 const id=qid(val(row,'item'));if(!id){issues.push({row:i,reason:'invalid-item-uri'});continue}
 const name=val(row,'itemLabel')||id;
 let record=records.get(id);
 if(!record){record={id:'wikidata:'+id,externalIds:{wikidata:id},type:'historical-entity',names:{und:name},dates:{inception:null,dissolution:null},location:null,claims:[],provenance:{source:'Wikidata SPARQL export',sourceUrl:'https://www.wikidata.org/wiki/'+id,importedFrom:path.basename(input),retrievedAt:null},reviewStatus:'unreviewed'};records.set(id,record)}
 if(name!==id)record.names.und=name;
 for(const [field,kind] of [['inception','inception'],['dissolution','dissolution']]){
  const d=date(val(row,field));if(d){record.dates[kind]=d;record.claims.push({property:kind,value:d,source:'wikidata:'+id,verification:'unreviewed'})}
 }
 const point=coord(val(row,'coord'));if(point){record.location=point;record.claims.push({property:'coordinates',value:point,source:'wikidata:'+id,verification:'unreviewed'})}
}
const result={schemaVersion:1,generatedAt:new Date().toISOString(),licenseNotice:'Check Wikidata and linked source licenses before redistribution. Imported assertions are unverified.',recordCount:records.size,records:[...records.values()].sort((a,b)=>a.id.localeCompare(b.id)),issues};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log('Imported '+result.recordCount+' entities; skipped '+issues.length+' rows');

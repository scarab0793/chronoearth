#!/usr/bin/env node
'use strict';
// Checkpointed import of castles, forts, fortifications and hillforts from Wikidata.
// Records are unreviewed candidates, drawn as construction events: the year is the
// documented inception (P571). An end year is set only when Wikidata records the
// structure's destruction or dissolution (P576); a missing P576 does not mean the
// structure still stands, so no end is guessed. Coordinates must be the structure's own
// (P625). Dates come from the MediaWiki API (historical year numbering), never SPARQL.
const {sparql,entityClaims,timeClaim,parsePoint,qidOf,runCheckpointedImport}=require('./lib/wikidata-import.cjs');

const PAGE_SIZE=50; // wbgetentities accepts at most 50 ids per request
const KINDS={castle:'castle',fort:'fort',fortification:'fortification',hillfort:'hillfort'};

const escapeIri=s=>String(s).replace(/[\\"]/g,'');
function query(wikidataClass,cursor){return `SELECT ?item ?itemLabel ?coord ?country ?countryLabel WHERE {
  { SELECT ?item WHERE {
      ?item wdt:P31 wd:${wikidataClass} .
      ?item wdt:P625 [] .
      FILTER EXISTS { ?item wdt:P571 [] }
      FILTER(STR(?item) > "${escapeIri(cursor)}")
    } ORDER BY STR(?item) LIMIT ${PAGE_SIZE} }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P17 ?country }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY STR(?item)`}

async function fetchPage(categoryState,cursor){
 const rows=await sparql(query(categoryState.wikidataClass,cursor));
 const items=[...new Set(rows.map(r=>r.item?.value).filter(v=>qidOf(v)))].sort();
 return {items,rows};
}

const LABEL={castle:'Castle',fort:'Fort',fortification:'Fortification',hillfort:'Hillfort'};
function describe(r){
 const parts=[LABEL[r.kind]+' imported automatically from Wikidata; not yet historically reviewed. The year is its recorded inception (construction or founding).'];
 if(r.end)parts.push('Wikidata records its destruction or dissolution in '+r.end+'.');
 if(r.datePrecision!=='day'&&r.datePrecision!=='month'&&r.datePrecision!=='year')parts.push('Inception is known only to '+r.datePrecision+' precision.');
 if(r.calendar==='julian')parts.push('Date as recorded in the Julian calendar.');
 return parts.join(' ');
}

async function processPage(category,page){
 const byItem=new Map();
 for(const row of page.rows){
  const id=qidOf(row.item?.value);if(!id)continue;
  const e=byItem.get(id)||{label:null,coord:null,country:null};
  e.label=e.label||row.itemLabel?.value||null;
  e.coord=e.coord||parsePoint(row.coord?.value);
  if(!e.country&&row.countryLabel?.value&&row.countryLabel.value!==qidOf(row.country?.value))e.country=row.countryLabel.value;
  byItem.set(id,e);
 }
 const ids=[...byItem.keys()];
 const entities=await entityClaims(ids);
 const records=[];
 for(const id of ids){
  const e=byItem.get(id),entity=entities[id];
  if(!entity||entity.missing!==undefined||!e.coord)continue;
  const name=e.label&&e.label!==id?e.label:null;
  if(!name)continue;
  const start=timeClaim(entity,'P571');
  if(!start||start.year<-10000||start.year>2026)continue;
  const end=timeClaim(entity,'P576');
  const r={name,kind:KINDS[category]||category,y:start.year,datePrecision:start.precision,calendar:start.calendar,
   lat:e.coord.lat,lng:e.coord.lng,precision:'exact',region:'',
   source:'https://www.wikidata.org/wiki/'+id,wikidataId:id,reviewStatus:'unreviewed'};
  if(start.month)r.month=start.month;
  if(start.day)r.day=start.day;
  if(end&&end.year>start.year&&end.year<=2026)r.end=end.year;
  if(e.country)r.country=e.country;
  r.note=describe(r);
  records.push(r);
 }
 return records;
}

runCheckpointedImport({
 title:'Castle and fortification import',
 stateFile:'data/import-state.json',
 sectionKey:'castles',
 dataFile:'data/imports/wikidata-castles.json',
 recordsKey:'castles',
 meta:{schemaVersion:1,source:'Wikidata SPARQL + MediaWiki API',reviewStatus:'unreviewed',
  note:'Candidate castles, forts, fortifications and hillforts as construction events: y is the recorded inception, end only when destruction or dissolution is recorded. Years use historical numbering (negative = BCE, no year 0).'},
 fetchPage,
 processPage
}).catch(error=>{console.error(error);process.exitCode=1});

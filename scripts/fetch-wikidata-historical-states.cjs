#!/usr/bin/env node
'use strict';
// Checkpointed, class-based import of historical states into data/imports/wikidata-states.json
// (the same catalogue the search-based scripts/fetch-wikidata-states.cjs fills). Records are
// unreviewed candidates; borders are never invented (geometry stays null, borderStatus
// "unmapped").
//
// from = inception (P571), else start time (P580). to = dissolution (P576), else end time
// (P582), else null with endStatus "not-recorded" (for a historical country this means the
// end is unknown, not that it still exists). Dates come from the MediaWiki API (historical
// year numbering), never from SPARQL, which shifts BCE years by one.
const {sparql,entityClaims,timeClaim,qidOf,runCheckpointedImport}=require('./lib/wikidata-import.cjs');

const PAGE_SIZE=50;
const escapeIri=s=>String(s).replace(/[\\"]/g,'');
function query(wikidataClass,cursor){return `SELECT ?item ?itemLabel ?desc WHERE {
  { SELECT ?item WHERE {
      ?item wdt:P31 wd:${wikidataClass} .
      FILTER EXISTS { ?item wdt:P571|wdt:P580 [] }
      FILTER(STR(?item) > "${escapeIri(cursor)}")
    } ORDER BY STR(?item) LIMIT ${PAGE_SIZE} }
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc)="en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY STR(?item)`}

async function fetchPage(categoryState,cursor){
 const rows=await sparql(query(categoryState.wikidataClass,cursor));
 const items=[...new Set(rows.map(r=>r.item?.value).filter(v=>qidOf(v)))].sort();
 return {items,rows};
}

// Items that are people or settlements are not states, whatever else they are typed as.
const EXCLUDE=new Set(['Q5','Q515','Q486972','Q1549591','Q3957','Q532']);

async function processPage(_category,page){
 const byItem=new Map();
 for(const row of page.rows){
  const id=qidOf(row.item?.value);if(!id)continue;
  const e=byItem.get(id)||{label:null,desc:''};
  e.label=e.label||row.itemLabel?.value||null;
  e.desc=e.desc||row.desc?.value||'';
  byItem.set(id,e);
 }
 const ids=[...byItem.keys()];
 const entities=await entityClaims(ids);
 const records=[];
 for(const id of ids){
  const e=byItem.get(id),entity=entities[id];
  if(!entity||entity.missing!==undefined)continue;
  const name=e.label&&e.label!==id?e.label:null;
  if(!name)continue;
  const typeIds=[...new Set((entity.claims?.P31||[]).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value?.id).filter(Boolean))];
  if(typeIds.some(t=>EXCLUDE.has(t)))continue;
  const start=timeClaim(entity,'P571')||timeClaim(entity,'P580');
  if(!start||start.year<-10000||start.year>2026)continue;
  const end=timeClaim(entity,'P576')||timeClaim(entity,'P582');
  if(end&&(end.year<start.year||end.year>2026))continue; // contradictory dates: leave for review
  records.push({id:'wikidata:'+id,wikidataId:id,name,from:start.year,to:end?end.year:null,
   fromPrecision:start.precision,toPrecision:end?end.precision:null,endStatus:end?'recorded':'not-recorded',
   description:e.desc,typeIds,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',borderStatus:'unmapped',geometry:null});
 }
 return records;
}

runCheckpointedImport({
 title:'Historical state import (class-based)',
 stateFile:'data/import-state.json',
 sectionKey:'states',
 dataFile:'data/imports/wikidata-states.json',
 recordsKey:'states',
 meta:{schemaVersion:1,source:'Wikidata SPARQL + MediaWiki API',reviewStatus:'unreviewed',
  note:'Candidate historical polities. Type, foundation/dissolution dates and boundaries require verification. to=null means no end is recorded (endStatus). Years use historical numbering (negative = BCE, no year 0).'},
 fetchPage,
 processPage
}).catch(error=>{console.error(error);process.exitCode=1});

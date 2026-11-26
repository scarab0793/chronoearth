#!/usr/bin/env node
'use strict';
// Checkpointed keyset import of dated settlements into data/imports/wikidata-cities.json.
// Unlike the offset-based scripts/fetch-wikidata-cities.cjs, which pages through every item
// of a class (most villages have no recorded date), the query here only returns items that
// have coordinates (P625) and an inception (P571), so every page is usable.
//
// Record schema matches the existing settlement records: from = inception, to = dissolution
// (P576) or 2026 when none is recorded (the existing convention for settlements). Dates come
// from the MediaWiki API (historical year numbering), never from SPARQL, which shifts BCE
// years by one. Records are unreviewed; reviewed records are never overwritten.
const {sparql,entityClaims,timeClaim,parsePoint,qidOf,runCheckpointedImport}=require('./lib/wikidata-import.cjs');

const PAGE_SIZE=50; // wbgetentities accepts at most 50 ids per request
const CURRENT_YEAR=2026;
const NOTE='Automatically imported settlement; dates and coordinates are unverified and may refer to a modern site.';

const escapeIri=s=>String(s).replace(/[\\"]/g,'');
function query(wikidataClass,cursor){return `SELECT ?item ?itemLabel ?coord WHERE {
  { SELECT DISTINCT ?item WHERE {
      # Keep the written join order: on the 255k villages this takes ~4-13 s per page,
      # against ~15-25 s with the default planner and FILTER EXISTS (measured 2026-11-26).
      hint:Query hint:optimizer "None" .
      ?item wdt:P31 wd:${wikidataClass} .
      ?item wdt:P571 [] .
      ?item wdt:P625 [] .
      FILTER(STR(?item) > "${escapeIri(cursor)}")
    } ORDER BY STR(?item) LIMIT ${PAGE_SIZE} }
  OPTIONAL { ?item wdt:P625 ?coord }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY STR(?item)`}

async function fetchPage(categoryState,cursor){
 const rows=await sparql(query(categoryState.wikidataClass,cursor));
 const items=[...new Set(rows.map(r=>r.item?.value).filter(v=>qidOf(v)))].sort();
 return {items,rows};
}

async function processPage(_category,page){
 const byItem=new Map();
 for(const row of page.rows){
  const id=qidOf(row.item?.value);if(!id)continue;
  const e=byItem.get(id)||{label:null,coord:null};
  e.label=e.label||row.itemLabel?.value||null;
  e.coord=e.coord||parsePoint(row.coord?.value);
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
  if(!start||start.year<-10000||start.year>CURRENT_YEAR)continue;
  const end=timeClaim(entity,'P576');
  if(end&&(end.year<start.year||end.year>CURRENT_YEAR))continue; // contradictory dates: leave for review
  records.push({name,lat:e.coord.lat,lng:e.coord.lng,from:start.year,to:end?end.year:CURRENT_YEAR,
   fromPrecision:start.precision,toPrecision:end?end.precision:null,region:'',
   source:'https://www.wikidata.org/wiki/'+id,precision:'approximate',note:NOTE,wikidataId:id,reviewStatus:'unreviewed'});
 }
 return records;
}

runCheckpointedImport({
 title:'Dated settlement import (keyset)',
 stateFile:'data/import-state.json',
 sectionKey:'datedSettlements',
 dataFile:'data/imports/wikidata-cities.json',
 recordsKey:'cities',
 meta:{schemaVersion:2,source:'Wikidata SPARQL + MediaWiki API',reviewStatus:'unreviewed'},
 fetchPage,
 processPage
}).catch(error=>{console.error(error);process.exitCode=1});

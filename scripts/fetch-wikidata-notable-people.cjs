#!/usr/bin/env node
'use strict';
// Checkpointed import of notable historical people by occupation (P106) into
// data/imports/wikidata-people.json. Records are unreviewed candidates.
//
// Selection: human (P31 Q5), born no later than 1900, an article in at least 20 Wikipedia
// language editions (a notability threshold), and a place of birth (P19) with coordinates.
// Birth and death years come from the MediaWiki API (historical year numbering), never from
// SPARQL, which shifts BCE years by one. The place of birth is stored separately in
// birthPlace; location stays null, because where a person lived or acted is not recorded.
const {sparql,entityClaims,timeClaim,parsePoint,qidOf,runCheckpointedImport}=require('./lib/wikidata-import.cjs');

const PAGE_SIZE=50;
const MIN_SITELINKS=20;
const LATEST_BIRTH=1900;

const escapeIri=s=>String(s).replace(/[\\"]/g,'');
function query(occupation,cursor){return `SELECT ?item ?itemLabel ?bp ?bpLabel ?bpCoord WHERE {
  { SELECT DISTINCT ?item WHERE {
      # Keep the written join order: start from the occupation, which is far smaller than
      # the set of all humans (measured 2026-11-27: 1-19 s per page).
      hint:Query hint:optimizer "None" .
      ?item wdt:P106 wd:${occupation} .
      ?item wikibase:sitelinks ?sitelinks . FILTER(?sitelinks >= ${MIN_SITELINKS})
      ?item wdt:P569 ?birth . FILTER(YEAR(?birth) <= ${LATEST_BIRTH})
      ?item wdt:P19/wdt:P625 [] .
      FILTER(STR(?item) > "${escapeIri(cursor)}")
    } ORDER BY STR(?item) LIMIT ${PAGE_SIZE} }
  ?item wdt:P19 ?bp . ?bp wdt:P625 ?bpCoord .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY STR(?item)`}

async function fetchPage(categoryState,cursor){
 const rows=await sparql(query(categoryState.wikidataClass,cursor));
 const items=[...new Set(rows.map(r=>r.item?.value).filter(v=>qidOf(v)))].sort();
 return {items,rows};
}

// Best non-deprecated item value of a property, preferring preferred-rank statements.
function itemClaim(entity,property){
 const claims=(entity?.claims?.[property]||[]).filter(c=>c.rank!=='deprecated'&&c.mainsnak?.snaktype==='value');
 const pick=claims.find(c=>c.rank==='preferred')||claims[0];
 return pick?.mainsnak?.datavalue?.value?.id||null;
}

async function processPage(category,page,existing){
 const byItem=new Map();
 for(const row of page.rows){
  const id=qidOf(row.item?.value);if(!id)continue;
  const e=byItem.get(id)||{label:null,places:new Map()};
  e.label=e.label||row.itemLabel?.value||null;
  const bp=qidOf(row.bp?.value),point=parsePoint(row.bpCoord?.value);
  if(bp&&point&&!e.places.has(bp))e.places.set(bp,{id:bp,name:row.bpLabel?.value&&row.bpLabel.value!==bp?row.bpLabel.value:null,...point});
  byItem.set(id,e);
 }
 const ids=[...byItem.keys()];
 const entities=await entityClaims(ids);
 const records=[];
 for(const id of ids){
  const e=byItem.get(id),entity=entities[id];
  if(!entity||entity.missing!==undefined)continue;
  const types=(entity.claims?.P31||[]).map(c=>c.mainsnak?.datavalue?.value?.id);
  if(!types.includes('Q5'))continue;
  const name=e.label&&e.label!==id?e.label:null;
  if(!name)continue;
  const birth=timeClaim(entity,'P569');
  if(!birth||birth.year>LATEST_BIRTH||birth.year<-10000)continue;
  const death=timeClaim(entity,'P570');
  if(death&&(death.year<birth.year||death.year>2026))continue; // contradictory dates: leave for review
  // Use the best-ranked place of birth; skip the person if it has no coordinates.
  const placeId=itemClaim(entity,'P19');
  const place=placeId?e.places.get(placeId):null;
  if(!place)continue;
  const previous=existing.get(id);
  const occupations=[...new Set([...(previous?.occupations||[]),category])].sort();
  records.push({id:'wikidata:'+id,wikidataId:id,name,birthYear:birth.year,deathYear:death?death.year:null,
   birthPrecision:birth.precision,deathPrecision:death?death.precision:null,occupations,
   birthPlace:{id:place.id,name:place.name,lat:place.lat,lng:place.lng},
   source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',location:null});
 }
 return records;
}

runCheckpointedImport({
 title:'Notable people import (by occupation)',
 stateFile:'data/import-state.json',
 sectionKey:'people',
 dataFile:'data/imports/wikidata-people.json',
 recordsKey:'people',
 meta:{schemaVersion:2,source:'Wikidata SPARQL + MediaWiki API',reviewStatus:'unreviewed',
  note:'Candidate historical people. Occupation-based records: born by 1900, at least 20 Wikipedia language editions, place of birth with coordinates (birthPlace). location stays null: where a person lived or acted is not recorded. Years use historical numbering (negative = BCE, no year 0).'},
 fetchPage,
 processPage
}).catch(error=>{console.error(error);process.exitCode=1});

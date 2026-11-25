#!/usr/bin/env node
'use strict';
// Checkpointed import of historical capitals: for each state-like item, the capitals (P36)
// whose period is documented on Wikidata. Records are unreviewed candidates.
//
// A capital period is kept only when its start is known: the P580 (start time) qualifier.
// Its end is the P582 (end time) qualifier, else the state's dissolution (P576), else, for
// a state that still exists (not a historical country), the present. Capitals without a documented start are skipped
// rather than guessed. Dates come from the MediaWiki API (historical year numbering).
const {sparql,entityClaims,timeClaim,parsePoint,qidOf,runCheckpointedImport}=require('./lib/wikidata-import.cjs');

const PAGE_SIZE=50;
const CURRENT_YEAR=2026;
// Direct P31 classes treated as states (checked on Wikidata, 2026-11-25).
const STATE_CLASSES=['Q3024240','Q3624078','Q6256','Q48349','Q417175','Q133442','Q1250464','Q28171280','Q164950','Q10711424'];

const escapeIri=s=>String(s).replace(/[\\"]/g,'');
function query(cursor){return `SELECT ?state ?stateLabel ?city ?cityLabel ?coord WHERE {
  { SELECT DISTINCT ?state WHERE {
      # Keep the written join order (classes first): the default planner starts from all
      # P36 statements and took ~70 s per page; this order takes ~2 s.
      hint:Query hint:optimizer "None" .
      VALUES ?cls { ${STATE_CLASSES.map(q=>'wd:'+q).join(' ')} }
      ?state wdt:P31 ?cls .
      ?state p:P36 ?capitalStatement .
      ?capitalStatement pq:P580 [] .
      FILTER(STR(?state) > "${escapeIri(cursor)}")
    } ORDER BY STR(?state) LIMIT ${PAGE_SIZE} }
  ?state p:P36/ps:P36 ?city .
  OPTIONAL { ?city wdt:P625 ?coord }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY STR(?state)`}

async function fetchPage(_categoryState,cursor){
 const rows=await sparql(query(cursor));
 const items=[...new Set(rows.map(r=>r.state?.value).filter(v=>qidOf(v)))].sort();
 return {items,rows};
}

function qualifierTime(claim,property){
 const q=(claim.qualifiers?.[property]||[]).find(s=>s.snaktype==='value'&&s.datavalue?.type==='time');
 return q?timeClaim({claims:{[property]:[{rank:'normal',mainsnak:q}]}},property):null;
}

async function processPage(_category,page){
 const states=new Map();
 for(const row of page.rows){
  const stateId=qidOf(row.state?.value),cityId=qidOf(row.city?.value);
  if(!stateId||!cityId)continue;
  const s=states.get(stateId)||{name:row.stateLabel?.value,cities:new Map()};
  const c=s.cities.get(cityId)||{name:row.cityLabel?.value,point:null};
  c.point=c.point||parsePoint(row.coord?.value);
  s.cities.set(cityId,c);
  states.set(stateId,s);
 }
 const ids=[...states.keys()];
 const entities=await entityClaims(ids);
 const records=[];
 for(const id of ids){
  const s=states.get(id),entity=entities[id];
  if(!entity||entity.missing!==undefined)continue;
  const name=s.name&&s.name!==id?s.name:null;
  if(!name)continue;
  const dissolved=timeClaim(entity,'P576');
  const historical=(entity.claims?.P31||[]).some(c=>c.mainsnak?.datavalue?.value?.id==='Q3024240');
  const capitals=[];
  for(const claim of entity.claims?.P36||[]){
   if(claim.rank==='deprecated'||claim.mainsnak?.snaktype!=='value')continue;
   const cityId=claim.mainsnak.datavalue?.value?.id;
   const city=s.cities.get(cityId);
   if(!city||!city.point||!city.name||city.name===cityId)continue;
   const start=qualifierTime(claim,'P580');
   if(!start)continue;
   const end=qualifierTime(claim,'P582');
   let to,periodEnd;
   if(end){to=end.year;periodEnd='qualifier'}
   else if(dissolved){to=dissolved.year;periodEnd='state-dissolution'}
   else if(!historical){to=CURRENT_YEAR;periodEnd='present'}
   else continue; // a historical state without an end date: the period's end is unknown
   if(start.year>CURRENT_YEAR||to<start.year)continue;
   capitals.push({cityId,name:city.name,lat:city.point.lat,lng:city.point.lng,from:start.year,to,fromPrecision:start.precision,toPrecision:end?end.precision:periodEnd==='state-dissolution'?dissolved.precision:null,periodEnd});
  }
  if(!capitals.length)continue;
  capitals.sort((a,b)=>a.from-b.from||a.cityId.localeCompare(b.cityId));
  records.push({name,wikidataId:id,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',capitals});
 }
 return records;
}

runCheckpointedImport({
 title:'Historical capital import',
 stateFile:'data/import-state.json',
 sectionKey:'capitals',
 dataFile:'data/imports/wikidata-capitals.json',
 recordsKey:'capitals',
 meta:{schemaVersion:1,source:'Wikidata SPARQL + MediaWiki API',reviewStatus:'unreviewed',
  note:'Candidate capital periods per state (P36). Only periods with a documented start (P580) are included; the end is the P582 qualifier, the state dissolution, or the present (see periodEnd). Years use historical numbering (negative = BCE, no year 0).'},
 fetchPage,
 processPage
}).catch(error=>{console.error(error);process.exitCode=1});

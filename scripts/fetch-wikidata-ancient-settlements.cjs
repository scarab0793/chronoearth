#!/usr/bin/env node
'use strict';
// Checkpointed import of ancient, abandoned and former settlements and archaeological sites.
// Records are unreviewed candidates.
//
// A record needs coordinates (P625) and a documented time span; nothing is guessed:
//  - dateBasis "own": the item's own start (P571 inception, else P580 start time) AND its
//    own end (P576 dissolved/abandoned, else P582 end time);
//  - otherwise dateBasis "period": the items listed under P2348 (time period), when every
//    listed period has both a start and an end; the span runs from the earliest start to the
//    latest end. This is coarse (an archaeological period, not the site's own history) and
//    is marked as such.
// Items with neither are skipped. All dates come from the MediaWiki API (historical year
// numbering), never from SPARQL, which shifts BCE years by one.
const {sparql,entityClaims,timeClaim,parsePoint,qidOf,runCheckpointedImport}=require('./lib/wikidata-import.cjs');

const PAGE_SIZE=50;
const MIN_YEAR=-10000,MAX_YEAR=2026;
const KINDS={ancient_city:'ancient-city',former_settlement:'former-settlement',abandoned_village:'abandoned-village',ghost_town:'ghost-town',archaeological_site:'archaeological-site'};

const escapeIri=s=>String(s).replace(/[\\"]/g,'');
function query(wikidataClass,cursor){return `SELECT ?item ?itemLabel ?coord ?period WHERE {
  { SELECT ?item WHERE {
      ?item wdt:P31 wd:${wikidataClass} .
      ?item wdt:P625 [] .
      FILTER EXISTS { ?item wdt:P571|wdt:P580|wdt:P2348 [] }
      FILTER(STR(?item) > "${escapeIri(cursor)}")
    } ORDER BY STR(?item) LIMIT ${PAGE_SIZE} }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P2348 ?period }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY STR(?item)`}

async function fetchPage(categoryState,cursor){
 const rows=await sparql(query(categoryState.wikidataClass,cursor));
 const items=[...new Set(rows.map(r=>r.item?.value).filter(v=>qidOf(v)))].sort();
 return {items,rows};
}

async function claimsInChunks(ids){
 const out={};
 for(let i=0;i<ids.length;i+=50)Object.assign(out,await entityClaims(ids.slice(i,i+50)));
 return out;
}

// Period spans are shared by many sites; cache them for the whole run.
const periodCache=new Map();
async function periodSpans(ids){
 const missing=ids.filter(id=>!periodCache.has(id));
 if(missing.length){
  const entities=await claimsInChunks(missing);
  for(const id of missing){
   const e=entities[id];
   const start=e&&e.missing===undefined?timeClaim(e,'P580')||timeClaim(e,'P571'):null;
   const end=e&&e.missing===undefined?timeClaim(e,'P582')||timeClaim(e,'P576'):null;
   periodCache.set(id,start&&end&&start.year<=end.year?{start,end}:null);
  }
 }
 return ids.map(id=>periodCache.get(id));
}

function describe(r){
 const parts=['Automatically imported from Wikidata ('+r.kind.replace(/-/g,' ')+'); not yet historically reviewed.'];
 if(r.dateBasis==='period')parts.push('Time span derived from the archaeological or historical period(s) recorded for the site, not from dates of the site itself.');
 else parts.push('Time span from the start and end dates recorded for the site.');
 return parts.join(' ');
}

async function processPage(category,page){
 const byItem=new Map();
 for(const row of page.rows){
  const id=qidOf(row.item?.value);if(!id)continue;
  const e=byItem.get(id)||{label:null,coord:null,periods:new Set()};
  e.label=e.label||row.itemLabel?.value||null;
  e.coord=e.coord||parsePoint(row.coord?.value);
  const p=qidOf(row.period?.value);if(p)e.periods.add(p);
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
  const ownStart=timeClaim(entity,'P571')||timeClaim(entity,'P580');
  const ownEnd=timeClaim(entity,'P576')||timeClaim(entity,'P582');
  let from,to,basis,fromPrecision,toPrecision,periodIds;
  if(ownStart&&ownEnd){
   from=ownStart.year;to=ownEnd.year;basis='own';fromPrecision=ownStart.precision;toPrecision=ownEnd.precision;
  }else if(e.periods.size){
   periodIds=[...e.periods].sort();
   const spans=await periodSpans(periodIds);
   if(spans.some(s=>!s))continue; // a listed period has no documented span
   const first=spans.reduce((a,b)=>b.start.year<a.start.year?b:a),last=spans.reduce((a,b)=>b.end.year>a.end.year?b:a);
   from=first.start.year;to=last.end.year;basis='period';fromPrecision=first.start.precision;toPrecision=last.end.precision;
  }else continue;
  if(from>to||from<MIN_YEAR||to>MAX_YEAR)continue;
  const r={name,kind:KINDS[category]||category,lat:e.coord.lat,lng:e.coord.lng,from,to,fromPrecision,toPrecision,dateBasis:basis,
   region:'',source:'https://www.wikidata.org/wiki/'+id,precision:'approximate',wikidataId:id,reviewStatus:'unreviewed'};
  if(periodIds)r.periodIds=periodIds;
  r.note=describe(r);
  records.push(r);
 }
 return records;
}

runCheckpointedImport({
 title:'Ancient and abandoned settlement import',
 stateFile:'data/import-state.json',
 sectionKey:'ancientSettlements',
 dataFile:'data/imports/wikidata-ancient-settlements.json',
 recordsKey:'settlements',
 meta:{schemaVersion:1,source:'Wikidata SPARQL + MediaWiki API',reviewStatus:'unreviewed',
  note:'Candidate ancient, former and abandoned settlements and archaeological sites. dateBasis "own" uses the site\'s recorded start and end; "period" uses the span of its recorded time periods (P2348) and is coarse. Years use historical numbering (negative = BCE, no year 0).'},
 fetchPage,
 processPage
}).catch(error=>{console.error(error);process.exitCode=1});

#!/usr/bin/env node
'use strict';
// Checkpointed import of battles and sieges from Wikidata. Records are unreviewed candidates.
// Discovery and coordinates come from SPARQL; dates come from the MediaWiki API because the
// SPARQL service converts dates to the proleptic Gregorian calendar with astronomical year
// numbering (216 BCE is returned as -0215), while the API keeps the stored historical value.
const {sparql,entityClaims,timeClaim,parsePoint,qidOf,runCheckpointedImport}=require('./lib/wikidata-import.cjs');

const PAGE_SIZE=50; // wbgetentities accepts at most 50 ids per request
const KINDS={battle:'battle',siege:'siege'};

const escapeIri=s=>String(s).replace(/[\\"]/g,'');
function query(wikidataClass,cursor){return `SELECT ?item ?itemLabel ?coord ?loc ?locLabel ?locCoord ?partOf ?partOfLabel WHERE {
  { SELECT ?item WHERE {
      ?item wdt:P31 wd:${wikidataClass} .
      FILTER EXISTS { ?item wdt:P585|wdt:P580 [] }
      FILTER(STR(?item) > "${escapeIri(cursor)}")
    } ORDER BY STR(?item) LIMIT ${PAGE_SIZE} }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL {
    ?item wdt:P276 ?loc . ?loc wdt:P625 ?locCoord .
    # A country or continent centroid is not a usable battle position.
    FILTER NOT EXISTS { VALUES ?broad { wd:Q6256 wd:Q3624078 wd:Q3024240 wd:Q5107 wd:Q7275 wd:Q10864048 wd:Q35657 } ?loc wdt:P31 ?broad }
  }
  OPTIONAL { ?item wdt:P361 ?partOf }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hu". }
} ORDER BY STR(?item)`}

async function fetchPage(categoryState,cursor){
 const rows=await sparql(query(categoryState.wikidataClass,cursor));
 const items=[...new Set(rows.map(r=>r.item?.value).filter(v=>qidOf(v)))].sort();
 return {items,rows};
}

function describe(r){
 const kind=r.kind==='siege'?'Siege':'Battle';
 const parts=[kind+' imported automatically from Wikidata; not yet historically reviewed.'];
 if(r.partOf)parts.push('Part of: '+r.partOf+'.');
 if(r.precision==='location-derived')parts.push('Map position is the coordinate of the recorded location'+(r.locationName?' ('+r.locationName+')':'')+', not of the battlefield itself.');
 if(r.datePrecision!=='day'&&r.datePrecision!=='month')parts.push('Date is known only to '+r.datePrecision+' precision.');
 if(r.calendar==='julian')parts.push('Date as recorded in the Julian calendar.');
 return parts.join(' ');
}

async function processPage(category,page){
 const byItem=new Map();
 for(const row of page.rows){
  const id=qidOf(row.item?.value);if(!id)continue;
  const e=byItem.get(id)||{id,label:null,coord:null,loc:null,partOf:null};
  e.label=e.label||row.itemLabel?.value||null;
  e.coord=e.coord||parsePoint(row.coord?.value);
  if(!e.loc){const p=parsePoint(row.locCoord?.value);if(p)e.loc={...p,id:qidOf(row.loc?.value),name:row.locLabel?.value||null}}
  if(!e.partOf&&qidOf(row.partOf?.value))e.partOf={id:qidOf(row.partOf.value),name:row.partOfLabel?.value||null};
  byItem.set(id,e);
 }
 const ids=[...byItem.keys()];
 const entities=await entityClaims(ids);
 const records=[];
 for(const id of ids){
  const e=byItem.get(id),entity=entities[id];
  if(!entity||entity.missing!==undefined)continue;
  const start=timeClaim(entity,'P585')||timeClaim(entity,'P580');
  if(!start)continue;
  const place=e.coord||e.loc;
  if(!place)continue;
  // Labels that are just the QID mean no English/Hungarian label exists.
  const name=e.label&&e.label!==id?e.label:null;
  if(!name)continue;
  const end=timeClaim(entity,'P582');
  const r={name,kind:KINDS[category]||category,y:start.year,datePrecision:start.precision,calendar:start.calendar,
   lat:place.lat,lng:place.lng,precision:e.coord?'exact':'location-derived',region:'',
   source:'https://www.wikidata.org/wiki/'+id,wikidataId:id,reviewStatus:'unreviewed'};
  if(start.month)r.month=start.month;
  if(start.day)r.day=start.day;
  if(end&&end.year>start.year)r.end=end.year;
  if(!e.coord&&e.loc){r.locationId=e.loc.id;if(e.loc.name)r.locationName=e.loc.name}
  if(e.partOf){r.partOfId=e.partOf.id;if(e.partOf.name&&e.partOf.name!==e.partOf.id)r.partOf=e.partOf.name}
  r.note=describe(r);
  records.push(r);
 }
 return records;
}

runCheckpointedImport({
 title:'Battle and siege import',
 stateFile:'data/import-state.json',
 sectionKey:'battles',
 dataFile:'data/imports/wikidata-battles.json',
 recordsKey:'battles',
 meta:{schemaVersion:1,source:'Wikidata SPARQL + MediaWiki API',reviewStatus:'unreviewed',
  note:'Candidate battles and sieges. Dates use historical year numbering (negative = BCE, no year 0) in the calendar recorded on Wikidata. Locations may be derived from the recorded place rather than the battlefield.'},
 fetchPage,
 processPage
}).catch(error=>{console.error(error);process.exitCode=1});

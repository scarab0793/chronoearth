'use strict';
// Test-only fetch replacement for the battle importer, preloaded with `node -r`.
// Scenario (STUB_SCENARIO JSON file):
//  classes: {Q178561: [{id, label, coord:[lat,lng], loc:{id,name,coord:[lat,lng]}, partOf:{id,name}}]}
//  claims:  {Q1: {P585: {time:'-0216-08-02T00:00:00Z', precision:11, calendar:'julian'|'gregorian', rank}}}
//  failSparql: [callNumber,...] (1-based) -> HTTP 500;  failApi: [callNumber,...] -> HTTP 500
// Calls are appended to scenario.calls.
const fs=require('node:fs');
const file=process.env.STUB_SCENARIO;
const E='http://www.wikidata.org/entity/';
const CAL={julian:'http://www.wikidata.org/entity/Q1985786',gregorian:'http://www.wikidata.org/entity/Q1985727'};
const point=c=>({value:'Point('+c[1]+' '+c[0]+')'});
const json=(body,status=200)=>({ok:status<400,status,headers:{get:()=>null},json:async()=>body});
global.fetch=async url=>{
 const s=JSON.parse(fs.readFileSync(file,'utf8'));
 s.calls=s.calls||[];
 const u=new URL(url);
 if(u.hostname==='query.wikidata.org'){
  const q=u.searchParams.get('query');
  const cls=q.match(/wdt:P31 wd:(Q\d+)/)[1];
  const cursor=q.match(/FILTER\(STR\(\?item\) > "([^"]*)"\)/)[1];
  const limit=Number(q.match(/LIMIT (\d+)/)[1]);
  s.calls.push({kind:'sparql',cls,cursor});
  const n=s.calls.filter(c=>c.kind==='sparql').length;
  fs.writeFileSync(file,JSON.stringify(s));
  if((s.failSparql||[]).includes(n))return json({},500);
  const items=(s.classes?.[cls]||[]).map(i=>({...i,iri:E+i.id})).filter(i=>i.iri>cursor).sort((a,b)=>a.iri<b.iri?-1:1).slice(0,limit);
  const bindings=items.map(i=>{
   const b={item:{value:i.iri},itemLabel:{value:i.label??i.id}};
   if(i.coord)b.coord=point(i.coord);
   if(i.loc){b.loc={value:E+i.loc.id};b.locLabel={value:i.loc.name};b.locCoord=point(i.loc.coord)}
   if(i.partOf){b.partOf={value:E+i.partOf.id};b.partOfLabel={value:i.partOf.name}}
   return b;
  });
  return json({results:{bindings}});
 }
 const ids=u.searchParams.get('ids').split('|');
 s.calls.push({kind:'api',ids});
 const n=s.calls.filter(c=>c.kind==='api').length;
 fs.writeFileSync(file,JSON.stringify(s));
 if((s.failApi||[]).includes(n))return json({},500);
 const entities={};
 for(const id of ids){
  const claims={};
  for(const [prop,v] of Object.entries(s.claims?.[id]||{}))claims[prop]=[{rank:v.rank||'normal',mainsnak:{snaktype:'value',datavalue:{type:'time',value:{time:v.time,precision:v.precision,calendarmodel:CAL[v.calendar||'gregorian']}}}}];
  entities[id]={id,claims};
 }
 return json({entities});
};

'use strict';
// Test-only fetch replacement for the ancient settlement importer, preloaded with `node -r`.
// Scenario (STUB_SCENARIO JSON file):
//  classes: {Q15661340: [{id, label, coord:[lat,lng], periods:['Q11761']}]}
//  claims:  {Q1: {P571: {time:'-0753-00-00T00:00:00Z', precision:9}, P576: {...}}}  (items and periods)
//  failSparql / failApi: [callNumber,...] (1-based) -> HTTP 500
const fs=require('node:fs');
const file=process.env.STUB_SCENARIO;
const E='http://www.wikidata.org/entity/';
const GREG='http://www.wikidata.org/entity/Q1985727';
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
  const items=(s.classes?.[cls]||[]).filter(i=>i.coord).map(i=>({...i,iri:E+i.id})).filter(i=>i.iri>cursor).sort((a,b)=>a.iri<b.iri?-1:1).slice(0,limit);
  const bindings=[];
  for(const i of items){
   const base={item:{value:i.iri},itemLabel:{value:i.label??i.id},coord:{value:'Point('+i.coord[1]+' '+i.coord[0]+')'}};
   if(i.periods?.length)for(const p of i.periods)bindings.push({...base,period:{value:E+p}});
   else bindings.push(base);
  }
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
  for(const [prop,v] of Object.entries(s.claims?.[id]||{}))claims[prop]=[{rank:v.rank||'normal',mainsnak:{snaktype:'value',datavalue:{type:'time',value:{time:v.time,precision:v.precision??9,calendarmodel:GREG}}}}];
  entities[id]={id,claims};
 }
 return json({entities});
};

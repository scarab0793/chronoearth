'use strict';
// Test-only fetch replacement for the class-based state importer, preloaded with `node -r`.
// Scenario (STUB_SCENARIO JSON file):
//  classes: {Q3024240: [{id, label, desc, p31:['Q3024240'], P571:'+1000-00-00T00:00:00Z', P576:'...'}]}
//  failSparql / failApi: [callNumber,...] (1-based) -> HTTP 500
const fs=require('node:fs');
const file=process.env.STUB_SCENARIO;
const E='http://www.wikidata.org/entity/';
const GREG='http://www.wikidata.org/entity/Q1985727';
const json=(body,status=200)=>({ok:status<400,status,headers:{get:()=>null},json:async()=>body});
const time=t=>({rank:'normal',mainsnak:{snaktype:'value',datavalue:{type:'time',value:{time:t,precision:9,calendarmodel:GREG}}}});
global.fetch=async url=>{
 const s=JSON.parse(fs.readFileSync(file,'utf8'));
 s.calls=s.calls||[];
 const u=new URL(url);
 const all=Object.values(s.classes||{}).flat();
 if(u.hostname==='query.wikidata.org'){
  const q=u.searchParams.get('query');
  const cls=q.match(/wdt:P31 wd:(Q\d+)/)[1];
  const cursor=q.match(/FILTER\(STR\(\?item\) > "([^"]*)"\)/)[1];
  const limit=Number(q.match(/LIMIT (\d+)/)[1]);
  s.calls.push({kind:'sparql',cls,cursor});
  const n=s.calls.filter(c=>c.kind==='sparql').length;
  fs.writeFileSync(file,JSON.stringify(s));
  if((s.failSparql||[]).includes(n))return json({},500);
  const items=(s.classes?.[cls]||[]).filter(i=>i.P571||i.P580).filter(i=>E+i.id>cursor).sort((a,b)=>E+a.id<E+b.id?-1:1).slice(0,limit);
  return json({results:{bindings:items.map(i=>{const b={item:{value:E+i.id},itemLabel:{value:i.label??i.id}};if(i.desc)b.desc={value:i.desc};return b})}});
 }
 const ids=u.searchParams.get('ids').split('|');
 s.calls.push({kind:'api',ids});
 const n=s.calls.filter(c=>c.kind==='api').length;
 fs.writeFileSync(file,JSON.stringify(s));
 if((s.failApi||[]).includes(n))return json({},500);
 const entities={};
 for(const id of ids){
  const i=all.find(x=>x.id===id)||{};
  const claims={P31:(i.p31||[]).map(c=>({rank:'normal',mainsnak:{snaktype:'value',datavalue:{type:'wikibase-entityid',value:{id:c}}}}))};
  for(const p of ['P571','P580','P576','P582'])if(i[p])claims[p]=[time(i[p])];
  entities[id]={id,claims};
 }
 return json({entities});
};

'use strict';
// Test-only fetch replacement for the notable people importer, preloaded with `node -r`.
// Scenario (STUB_SCENARIO JSON file):
//  occupations: {Q116: [{id, label, p31:['Q5'], P569:'+1000-00-00T00:00:00Z', P570:'...',
//                        places:[{id, label, coord:[lat,lng]}], P19:'Q90'}]}
//  failSparql / failApi: [callNumber,...] (1-based) -> HTTP 500
const fs=require('node:fs');
const file=process.env.STUB_SCENARIO;
const E='http://www.wikidata.org/entity/';
const GREG='http://www.wikidata.org/entity/Q1985727';
const json=(body,status=200)=>({ok:status<400,status,headers:{get:()=>null},json:async()=>body});
const time=t=>({rank:'normal',mainsnak:{snaktype:'value',datavalue:{type:'time',value:{time:t,precision:9,calendarmodel:GREG}}}});
const item=id=>({rank:'normal',mainsnak:{snaktype:'value',datavalue:{type:'wikibase-entityid',value:{id}}}});
global.fetch=async url=>{
 const s=JSON.parse(fs.readFileSync(file,'utf8'));
 s.calls=s.calls||[];
 const u=new URL(url);
 const all=Object.values(s.occupations||{}).flat();
 if(u.hostname==='query.wikidata.org'){
  const q=u.searchParams.get('query');
  const occ=q.match(/wdt:P106 wd:(Q\d+)/)[1];
  const cursor=q.match(/FILTER\(STR\(\?item\) > "([^"]*)"\)/)[1];
  const limit=Number(q.match(/LIMIT (\d+)/)[1]);
  s.calls.push({kind:'sparql',occ,cursor});
  const n=s.calls.filter(c=>c.kind==='sparql').length;
  fs.writeFileSync(file,JSON.stringify(s));
  if((s.failSparql||[]).includes(n))return json({},500);
  const people=(s.occupations?.[occ]||[]).filter(p=>(p.places||[]).length).filter(p=>E+p.id>cursor).sort((a,b)=>E+a.id<E+b.id?-1:1).slice(0,limit);
  const bindings=[];
  for(const p of people)for(const pl of p.places)bindings.push({item:{value:E+p.id},itemLabel:{value:p.label??p.id},bp:{value:E+pl.id},bpLabel:{value:pl.label??pl.id},bpCoord:{value:'Point('+pl.coord[1]+' '+pl.coord[0]+')'}});
  return json({results:{bindings}});
 }
 const ids=u.searchParams.get('ids').split('|');
 s.calls.push({kind:'api',ids});
 const n=s.calls.filter(c=>c.kind==='api').length;
 fs.writeFileSync(file,JSON.stringify(s));
 if((s.failApi||[]).includes(n))return json({},500);
 const entities={};
 for(const id of ids){
  const p=all.find(x=>x.id===id)||{};
  const claims={P31:(p.p31||['Q5']).map(item)};
  for(const k of ['P569','P570'])if(p[k])claims[k]=[time(p[k])];
  const bp=p.P19||p.places?.[0]?.id;if(bp)claims.P19=[item(bp)];
  entities[id]={id,claims};
 }
 return json({entities});
};

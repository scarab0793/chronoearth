'use strict';
// Test-only fetch replacement for the capital importer, preloaded with `node -r`.
// Scenario (STUB_SCENARIO JSON file):
//  states: [{id, label, p31:['Q3024240'], dissolved:'+1946-01-01T00:00:00Z',
//            capitals:[{id, label, coord:[lat,lng], start:'+1000-...', end:'+1543-...', rank}]}]
//  failSparql / failApi: [callNumber,...] (1-based) -> HTTP 500
const fs=require('node:fs');
const file=process.env.STUB_SCENARIO;
const E='http://www.wikidata.org/entity/';
const GREG='http://www.wikidata.org/entity/Q1985727';
const json=(body,status=200)=>({ok:status<400,status,headers:{get:()=>null},json:async()=>body});
const time=t=>({snaktype:'value',datavalue:{type:'time',value:{time:t,precision:9,calendarmodel:GREG}}});
global.fetch=async url=>{
 const s=JSON.parse(fs.readFileSync(file,'utf8'));
 s.calls=s.calls||[];
 const u=new URL(url);
 if(u.hostname==='query.wikidata.org'){
  const q=u.searchParams.get('query');
  const cursor=q.match(/FILTER\(STR\(\?state\) > "([^"]*)"\)/)[1];
  const limit=Number(q.match(/LIMIT (\d+)/)[1]);
  s.calls.push({kind:'sparql',cursor});
  const n=s.calls.filter(c=>c.kind==='sparql').length;
  fs.writeFileSync(file,JSON.stringify(s));
  if((s.failSparql||[]).includes(n))return json({},500);
  const states=(s.states||[]).filter(st=>E+st.id>cursor&&st.capitals.some(c=>c.start)).sort((a,b)=>E+a.id<E+b.id?-1:1).slice(0,limit);
  const bindings=[];
  for(const st of states)for(const c of st.capitals){
   const b={state:{value:E+st.id},stateLabel:{value:st.label??st.id},city:{value:E+c.id},cityLabel:{value:c.label??c.id}};
   if(c.coord)b.coord={value:'Point('+c.coord[1]+' '+c.coord[0]+')'};
   bindings.push(b);
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
  const st=(s.states||[]).find(x=>x.id===id);
  const claims={P31:(st.p31||[]).map(c=>({rank:'normal',mainsnak:{snaktype:'value',datavalue:{type:'wikibase-entityid',value:{id:c}}}})),
   P36:st.capitals.map(c=>{const qualifiers={};if(c.start)qualifiers.P580=[time(c.start)];if(c.end)qualifiers.P582=[time(c.end)];return {rank:c.rank||'normal',mainsnak:{snaktype:'value',datavalue:{type:'wikibase-entityid',value:{id:c.id}}},qualifiers}})};
  if(st.dissolved)claims.P576=[{rank:'normal',mainsnak:time(st.dissolved)}];
  entities[id]={id,claims};
 }
 return json({entities});
};

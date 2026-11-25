'use strict';
// Test-only replacement for global fetch, preloaded with `node -r`. Reads the scenario from
// STUB_SCENARIO: {pages:{<pageIndex>:[bindings]}, fail:{<pageIndex>:{status,retryAfter}}}.
// Pages are keyed by OFFSET/100. Every call is appended to scenario.calls for assertions.
const fs=require('node:fs');
const file=process.env.STUB_SCENARIO;
global.fetch=async url=>{
 const scenario=JSON.parse(fs.readFileSync(file,'utf8'));
 const query=new URL(url).searchParams.get('query');
 const offset=Number(query.match(/OFFSET (\d+)/)[1]);
 const cls=query.match(/wdt:P31 wd:(Q\d+)/)[1];
 (scenario.calls=scenario.calls||[]).push({offset,cls});
 fs.writeFileSync(file,JSON.stringify(scenario));
 const page=String(offset/100);
 const fail=scenario.fail?.[page];
 if(fail){
  const headers=new Map(fail.retryAfter!==undefined?[['retry-after',String(fail.retryAfter)]]:[]);
  return {ok:false,status:fail.status,headers:{get:k=>headers.get(k.toLowerCase())??null},json:async()=>({})};
 }
 const bindings=scenario.pages?.[page]??[];
 return {ok:true,status:200,headers:{get:()=>null},json:async()=>({results:{bindings}})};
};

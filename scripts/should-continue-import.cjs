#!/usr/bin/env node
'use strict';
// Prints "yes" when a checkpointed import section should start another run right away:
// the last run made progress without errors (page limit or time budget reached, or a
// category finished) and at least one category in the queue is still open. Prints "no"
// otherwise, so failures and finished queues fall back to the regular schedule.
const fs=require('node:fs');

function shouldContinue(state,sectionKey){
 const s=state?.[sectionKey];
 if(!s||!s.categories||!s.lastRun)return false;
 const r=s.lastRun;
 const progressed=r.outcome==='complete'||r.outcome==='exhausted'||(r.outcome==='partial'&&r.stopReason==='time_budget'&&!r.error);
 if(!progressed||!(r.pagesFetched>0))return false;
 return Object.values(s.categories).some(c=>c.status!=='exhausted');
}

if(require.main===module){
 const [sectionKey,file='data/import-state.json']=process.argv.slice(2);
 if(!sectionKey){console.error('usage: should-continue-import.cjs <section> [state file]');process.exit(2)}
 console.log(shouldContinue(JSON.parse(fs.readFileSync(file,'utf8')),sectionKey)?'yes':'no');
}
module.exports={shouldContinue};

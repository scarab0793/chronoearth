const fs=require('node:fs');
const features=JSON.parse(fs.readFileSync('data/regions-schematic.geojson','utf8')).features;
const states=JSON.parse(fs.readFileSync('data/states-v1.json','utf8')).states;
const regions=['Afrika','Amerika','Ázsia','Európa'];
const windows=features.map(f=>({id:f.properties.id,year:f.properties.snapshotYear,from:f.properties.from,to:f.properties.to,regions:f.properties.regions||[],stateId:f.properties.stateId||null,status:f.properties.geometryStatus}));
const verified=windows.filter(f=>f.status==='verified').length;
const missingState=windows.filter(f=>!f.stateId);
const bins=[{label:'Before 500 BCE',from:-10000,to:-501},{label:'500 BCE–499 CE',from:-500,to:499},{label:'500–1499',from:500,to:1499},{label:'1500–1799',from:1500,to:1799},{label:'1800–2026',from:1800,to:2026}];
const rows=regions.map(region=>({region,counts:bins.map(b=>windows.filter(w=>w.regions.includes(region)&&w.year>=b.from&&w.year<=b.to).length)}));
const lines=['# ChronoEarth historical map coverage audit','','This is an inventory of illustrative map snapshots, **not** evidence of verified borders.','', '- Snapshots: '+windows.length,'- Verified boundary geometries: '+verified,'- Illustrative/unverified: '+(windows.length-verified),'- Snapshots without linked state ID: '+missingState.length,'','| Region | '+bins.map(b=>b.label).join(' | ')+' |','|---|'+bins.map(()=>'---:|').join(''),...rows.map(r=>'| '+r.region+' | '+r.counts.join(' | ')+' |'),'','## Snapshots without state links',...(missingState.length?missingState.map(w=>'- '+w.id+' ('+w.year+')'):['None']),'','## Reference snapshots',...windows.sort((a,b)=>a.year-b.year).map(w=>'- '+w.year+': '+w.id+' ('+w.from+'–'+w.to+'); '+w.status+'; '+(w.stateId||'unlinked')),''];
const mappedStates=new Set(windows.map(w=>w.stateId).filter(Boolean));
const unmappedStates=states.filter(st=>!mappedStates.has(st.id));
lines.push('## Historical states without map snapshots','',...(unmappedStates.length?unmappedStates.map(st=>'- '+st.name+' ('+st.from+'–'+st.to+')'):['None']),'');
lines.push('## Reference-year gaps by region','','These are gaps **between** reference years, not proof that no state existed in the interval.','');
for(const region of regions){const years=[...new Set(windows.filter(w=>w.regions.includes(region)).map(w=>w.year))].sort((a,b)=>a-b);
lines.push('### '+region,'',years.length?'Reference years: '+years.join(', '):'No reference years','');
if(years.length>1){const gaps=years.slice(1).map((year,i)=>({from:years[i],to:year,years:year-years[i]})).sort((a,b)=>b.years-a.years).slice(0,5);
lines.push('Largest gaps: '+gaps.map(g=>g.from+' to '+g.to+' ('+g.years+' years)').join('; '),'')}
}
const research=JSON.parse(fs.readFileSync('data/map-research-queue.json','utf8'));
lines.push('## Map research backlog','','Candidate years below are **research targets**, not existing or verified maps.','', '| Priority | Historical state | Candidate years | Research status |','|---|---|---|---|');
const priorityOrder={high:0,medium:1,low:2};
for(const target of research.targets.slice().sort((a,b)=>priorityOrder[a.priority]-priorityOrder[b.priority])){
const state=states.find(s=>s.id===target.stateId);
lines.push('| '+target.priority+' | '+(state?state.name:target.stateId)+' | '+target.candidateYears.join(', ')+' | '+target.status+' |');
}
lines.push('','### Research questions','');
for(const target of research.targets){const state=states.find(s=>s.id===target.stateId);lines.push('- **'+(state?state.name:target.stateId)+'**: '+target.researchFocus)}
lines.push('');
const report=lines.join('\n');
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,report);
else process.stdout.write(report);

const fs=require('node:fs');
const assert=require('node:assert/strict');
const load=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const events=load('data/events-v1.json').events;
const cities=load('data/cities-v1.json').cities;
const routes=load('data/routes-v1.json').routes;
const people=load('data/people-v1.json').people;
const states=load('data/states-v1.json').states;
const regions=load('data/regions-schematic.geojson').features;
const errors=[];
const validRegions=['Afrika','Amerika','Ázsia','Európa'];
const ids=new Set();
const unique=(id,label)=>{if(ids.has(id))errors.push(label+' duplicate id '+id);ids.add(id)};
const check=(ok,msg)=>{if(!ok)errors.push(msg)};
const year=n=>Number.isInteger(n)&&n>=-10000&&n<=2100;
const lat=n=>typeof n==='number'&&Number.isFinite(n)&&n>=-90&&n<=90;
const lng=n=>typeof n==='number'&&Number.isFinite(n)&&n>=-180&&n<=180;
const link=u=>typeof u==='string'&&/^https:\/\//.test(u);
events.forEach((e,i)=>{const k='event '+i;check(e.i18n&&typeof e.i18n.en?.title==='string'&&typeof e.i18n.en?.desc==='string',k+' missing English i18n');if(e.i18n){for(const [lang,t] of Object.entries(e.i18n)){check(['en','de','es','fr','it','hu','pl'].includes(lang),k+' unsupported language '+lang);check(typeof t.title==='string'&&t.title.trim().length>2&&typeof t.desc==='string'&&t.desc.trim().length>5,k+' invalid translation '+lang)}}check(year(e.y),k+' invalid year');check(lat(e.lat)&&lng(e.lng),k+' invalid coordinates');check(typeof e.title==='string'&&e.title.length>3,k+' missing title');check(link(e.src),k+' missing source');check(validRegions.includes(e.region),k+' invalid region');if(e.datePrecision==='day'){check(Number.isInteger(e.month)&&e.month>=1&&e.month<=12,k+' invalid month');check(Number.isInteger(e.day)&&e.day>=1&&e.day<=31,k+' invalid day');if(e.month>=1&&e.month<=12&&e.day>=1&&e.day<=31){const d=new Date(0);d.setUTCFullYear(e.y,e.month-1,e.day);check(d.getUTCFullYear()===e.y&&d.getUTCMonth()===e.month-1&&d.getUTCDate()===e.day,k+' nonexistent calendar date')}}else check(e.month===undefined&&e.day===undefined,k+' date fields without day precision')});
const checkDirectory=(items,type)=>items.forEach((p,i)=>{const k=type+' '+i;check(typeof p.id==='string'&&p.id.length>2,k+' invalid id');unique(p.id,k);check(typeof p.name==='string'&&p.name.trim().length>2,k+' invalid name');check(year(p.from)&&year(p.to)&&p.from<=p.to,k+' invalid date range');check(lat(p.lat)&&lng(p.lng),k+' invalid coordinates');check(validRegions.includes(p.region),k+' invalid region');check(link(p.source),k+' invalid source');check(typeof p.note==='string'&&p.note.length>15,k+' missing note');check(Array.isArray(p.aliases)&&p.aliases.every(a=>typeof a==='string'&&a.trim()),k+' invalid aliases')});
checkDirectory(people,'person');checkDirectory(states,'state');
const peopleIds=new Set(people.map(p=>p.id));
const stateIds=new Set(states.map(p=>p.id));
events.forEach((e,i)=>{for(const [field,known] of [['relatedPeople',peopleIds],['relatedStates',stateIds]]){if(e[field]===undefined)continue;check(Array.isArray(e[field]),'event '+i+' '+field+' must be an array');if(!Array.isArray(e[field]))continue;check(new Set(e[field]).size===e[field].length,'event '+i+' '+field+' duplicate links');for(const id of e[field])check(known.has(id),'event '+i+' '+field+' unknown target '+id)}});

const relationships=load('data/states-v1.json').relationships||[];
const relationTypes=new Set(['transition','continuation','dynastic-branch']);
const relationPairs=new Set();
relationships.forEach((r,i)=>{const k='state relationship '+i;check(stateIds.has(r.from)&&stateIds.has(r.to),k+' unknown state endpoint');check(r.from!==r.to,k+' self reference');check(relationTypes.has(r.type),k+' invalid relationship type');check(year(r.approximateYear),k+' invalid reference year');check(r.datePrecision==='approximate',k+' missing approximate date precision');check(typeof r.note==='string'&&r.note.length>=30,k+' missing historical explanation');const pair=r.from+'>'+r.to;check(!relationPairs.has(pair),k+' duplicate directed relationship');relationPairs.add(pair);const from=states.find(p=>p.id===r.from),to=states.find(p=>p.id===r.to);if(from&&to)check(r.approximateYear>=Math.min(from.from,to.from)-25&&r.approximateYear<=Math.max(from.to,to.to)+25,k+' transition year outside plausible state chronology')});
for(const st of states){for(const [field,sourceField,targetField] of [['successorIds','from','to'],['predecessorIds','to','from']]){const links=st[field]||[];check(Array.isArray(links),'state '+st.id+' '+field+' must be array');if(!Array.isArray(links))continue;check(new Set(links).size===links.length,'state '+st.id+' duplicate '+field);for(const id of links){check(stateIds.has(id),'state '+st.id+' unknown '+field+' '+id);check(relationships.some(r=>r[sourceField]===st.id&&r[targetField]===id),'state '+st.id+' '+field+' missing typed relationship to '+id)}}}
for(const r of relationships){const from=states.find(s=>s.id===r.from),to=states.find(s=>s.id===r.to);if(from&&to){check((from.successorIds||[]).includes(to.id),'typed relationship missing successor backlink '+r.from+' -> '+r.to);check((to.predecessorIds||[]).includes(from.id),'typed relationship missing predecessor backlink '+r.from+' -> '+r.to)}}

cities.forEach((c,i)=>{const k='city '+i;check(year(c.from)&&year(c.to)&&c.from<=c.to,k+' invalid date range');check(lat(c.lat)&&lng(c.lng),k+' invalid coordinates');check(link(c.source),k+' missing source')});
routes.forEach((r,i)=>{const k='route '+i;check(year(r.from)&&year(r.to)&&r.from<=r.to,k+' invalid dates');check(Array.isArray(r.coords)&&r.coords.length>=2&&r.coords.every(p=>Array.isArray(p)&&p.length===2&&lat(p[0])&&lng(p[1])),k+' invalid route geometry');check(link(r.source),k+' missing source');check(Array.isArray(r.regions)&&r.regions.length>0&&r.regions.every(x=>validRegions.includes(x)),k+' invalid continent coverage')});
regions.forEach((f,i)=>{const k='region '+i;const p=f.properties||{};check(year(p.from)&&year(p.to)&&p.from<=p.to,k+' invalid dates');check(link(p.source),k+' missing source');check(Array.isArray(p.regions)&&p.regions.length>0&&p.regions.every(x=>validRegions.includes(x)),k+' invalid continent coverage');const ring=f.geometry?.coordinates?.[0];check(f.geometry?.type==='Polygon'&&Array.isArray(ring)&&ring.length>=4&&ring.every(p=>Array.isArray(p)&&p.length===2&&lng(p[0])&&lat(p[1]))&&JSON.stringify(ring[0])===JSON.stringify(ring[ring.length-1]),k+' invalid polygon')});
const snapshotIds=new Set();
regions.forEach((f,i)=>{const p=f.properties||{},k='region '+i;
check(typeof p.id==='string'&&p.id.length>0&&!snapshotIds.has(p.id),k+' missing or duplicate snapshot ID');snapshotIds.add(p.id);
check(typeof p.entityKey==='string'&&p.entityKey.trim().length>0,k+' missing historical entity key');
check(Number.isInteger(p.snapshotYear)&&p.snapshotYear>=p.from&&p.snapshotYear<=p.to,k+' reference year outside snapshot interval');
check(p.geometryStatus==='illustrative-not-verified',k+' must declare illustrative geometry quality');
check(p.to-p.from<=25,k+' schematic map interval is too broad for a dated reference snapshot');
if(p.stateId)check(stateIds.has(p.stateId),k+' references unknown historical state '+p.stateId);
});
const html=fs.readFileSync('index.html','utf8');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
const vm=require('node:vm');
check(html.includes('function nearestSnapshotYear('),'Historical snapshot selection is missing');
check(html.includes('refreshSnapshotChoices();render()'),'Historical snapshot picker does not refresh after loading');
check(html.includes('function renderDetailNavigation('),'Missing detail history navigation');
check(html.includes('appendRelatedEvents(p.id)'),'Missing reverse event links');
check(html.includes('const SEARCH_FILTER_LABELS='),'Missing search filter translations');
check(html.includes('document.getElementById(\'resultPeriod\').onchange=render'),'Search period filter is not wired');
check(html.includes('document.getElementById(\'resultType\').onchange=render'),'Search type filter is not wired');
const filterMatch=html.match(/const SEARCH_FILTER_LABELS=(\{[^;]+\});/);
if(filterMatch){try{const labels=JSON.parse(filterMatch[1]);for(const lang of ['en','de','es','fr','it','hu','pl'])check(Array.isArray(labels[lang])&&labels[lang].length===13&&labels[lang].every(x=>typeof x==='string'&&x.trim().length>0),'Search filter translations incomplete: '+lang)}catch(e){errors.push('Search filter translation JSON invalid: '+e.message)}}else errors.push('Search filter translation object not found');
for(const [id,expected] of [['resultType',6],['resultPeriod',6]]){const match=html.match(new RegExp('<select id="'+id+'"[^>]*>([\\s\\S]*?)<\\/select>'));check(Boolean(match),id+' missing from HTML');if(match)check((match[1].match(/<option\\b/g)||[]).length===expected,id+' expected '+expected+' options')}
const allEntityIds=new Set([...peopleIds,...stateIds]);check(allEntityIds.size===people.length+states.length,'Historical entity IDs must be unique');
inline.forEach((code,i)=>{try{new vm.Script(code,{filename:'inline-'+i+'.js'})}catch(e){errors.push('JavaScript syntax: '+e.message)}});
for(const p of ['data/events-v1.json','data/cities-v1.json','data/routes-v1.json','data/regions-schematic.geojson','data/people-v1.json','data/states-v1.json'])check(html.includes(p),'Page does not reference '+p);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('PASS: '+events.length+' events, '+cities.length+' cities, '+routes.length+' routes, '+regions.length+' regions, '+people.length+' people, '+states.length+' historical states; inline JavaScript syntax OK');

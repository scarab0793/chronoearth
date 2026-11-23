#!/usr/bin/env node
'use strict';
// Discovery catalogue of historical polities; NEVER invent historical borders.
const fs=require('node:fs');
const terms=['Roman Empire','Roman Republic','Byzantine Empire','Ottoman Empire','Mongol Empire','British Empire','Spanish Empire','Portuguese Empire','Russian Empire','Holy Roman Empire','Achaemenid Empire','Sasanian Empire','Parthian Empire','Seleucid Empire','Ptolemaic Kingdom','Macedonian Empire','Maurya Empire','Gupta Empire','Mughal Empire','Delhi Sultanate','Qing dynasty','Ming dynasty','Han dynasty','Tang dynasty','Song dynasty','Yuan dynasty','Qin dynasty','Aztec Empire','Inca Empire','Mali Empire','Songhai Empire','Ghana Empire','Kingdom of Kush','Kingdom of Aksum','Kingdom of Hungary','Kingdom of Poland','Polish Lithuanian Commonwealth','Kingdom of France','Kingdom of England','Kingdom of Scotland','Kingdom of Prussia','Austro-Hungarian Empire','Habsburg monarchy','German Empire','Weimar Republic','Soviet Union','Yugoslavia','Czechoslovakia','Kingdom of Jerusalem','Carolingian Empire','Abbasid Caliphate','Umayyad Caliphate','Fatimid Caliphate','Safavid Iran','Timurid Empire','Golden Horde','Kievan Rus','Grand Duchy of Lithuania','Republic of Venice','Republic of Genoa','Dutch Republic','First French Empire','Second French Empire','United States of America','Confederate States of America','Kingdom of Italy','Empire of Japan','Joseon','Goryeo','Khmer Empire','Srivijaya','Majapahit','Ayutthaya Kingdom','Kingdom of Siam','Duchy of Burgundy','Kingdom of Bohemia'];
const additionalTerms=["Sumer","Akkadian Empire","Neo-Sumerian Empire","Old Babylonian Empire","Neo-Babylonian Empire","Assyrian Empire","Neo-Assyrian Empire","Hittite Empire","Mitanni","Elam","Urartu","Lydia","Phrygia","Kingdom of Israel","Kingdom of Judah","Phoenicia","Carthage","Etruscan civilization","Sparta","Athens","Delian League","Peloponnesian League","Bactrian Kingdom","Greco-Bactrian Kingdom","Indo-Greek Kingdom","Kushan Empire","Satavahana dynasty","Chola dynasty","Pallava dynasty","Vijayanagara Empire","Maratha Empire","Sikh Empire","Pala Empire","Chalukya dynasty","Rashtrakuta dynasty","Ghaznavid Empire","Ghurid dynasty","Khwarazmian Empire","Ilkhanate","Chagatai Khanate","White Horde","Crimean Khanate","Kazan Khanate","Astrakhan Khanate","Nogai Horde","Zand dynasty","Afsharid dynasty","Qajar Iran","Pahlavi dynasty","Kingdom of Georgia","Kingdom of Armenia","Kingdom of Iberia","Kingdom of Albania Caucasus","Kingdom of Pontus","Kingdom of Pergamon","Kingdom of Bithynia","Kingdom of Cappadocia","Kingdom of Numidia","Kingdom of Mauretania","Vandal Kingdom","Ostrogothic Kingdom","Visigothic Kingdom","Lombard Kingdom","Frankish Kingdom","Merovingian dynasty","Kingdom of Burgundy","Kingdom of Asturias","Kingdom of León","Kingdom of Castile","Kingdom of Aragon","Kingdom of Navarre","Kingdom of Portugal","Crown of Aragon","Kingdom of Naples","Kingdom of Sicily","Kingdom of Sardinia","Grand Duchy of Tuscany","Duchy of Milan","Papal States","Kingdom of the Two Sicilies","Republic of Florence","Duchy of Savoy","Kingdom of Piedmont-Sardinia","Kingdom of Denmark","Kingdom of Norway","Kingdom of Sweden","Kalmar Union","Swedish Empire","Grand Duchy of Finland","Novgorod Republic","Principality of Moscow","Tsardom of Russia","Grand Duchy of Moscow","Kingdom of Serbia","Serbian Empire","First Bulgarian Empire","Second Bulgarian Empire","Kingdom of Croatia","Kingdom of Bosnia","Principality of Wallachia","Principality of Moldavia","Principality of Transylvania","Principality of Serbia","Kingdom of Romania","Kingdom of Greece","Republic of Ragusa","Duchy of Brittany","Duchy of Normandy","Duchy of Aquitaine","County of Flanders","Duchy of Brabant","Burgundian Netherlands","Spanish Netherlands","Austrian Netherlands","Kingdom of Belgium","Swiss Confederacy","Republic of the Seven United Netherlands","German Confederation","North German Confederation","Confederation of the Rhine","Kingdom of Bavaria","Kingdom of Saxony","Kingdom of Württemberg","Grand Duchy of Baden","Electorate of Hanover","Kingdom of Hanover","Kingdom of Westphalia","Duchy of Warsaw","Congress Poland","Second Polish Republic","Polish People's Republic","East Germany","West Germany","Kingdom of Ethiopia","Ethiopian Empire","Zagwe dynasty","Solomonic dynasty","Kingdom of Benin","Oyo Empire","Kanem Empire","Bornu Empire","Sokoto Caliphate","Dahomey","Asante Empire","Mutapa Empire","Great Zimbabwe","Kingdom of Kongo","Luba Kingdom","Lunda Empire","Kingdom of Rwanda","Kingdom of Burundi","Buganda","Kingdom of Ndongo","Kingdom of Loango","Kingdom of Makuria","Kingdom of Alodia","Kingdom of Nobatia","Kingdom of Kerma","Kingdom of Dʿmt","Kingdom of Saba","Himyarite Kingdom","Nabataean Kingdom","Palmyrene Empire","Kingdom of Osroene","Kingdom of Edessa","Rashidun Caliphate","Almoravid dynasty","Almohad Caliphate","Marinid Sultanate","Hafsid dynasty","Ayyubid dynasty","Mamluk Sultanate","Zirid dynasty","Idrisid dynasty","Kingdom of Morocco","Zanzibar Sultanate","Sultanate of Oman","Durrani Empire","Emirate of Afghanistan","Kingdom of Afghanistan","Tibetan Empire","Kingdom of Tibet","Western Xia","Liao dynasty","Jin dynasty 1115","Northern Wei","Sui dynasty","Three Kingdoms China","Eastern Zhou","Western Zhou","Shang dynasty","Xia dynasty","Nanyue","Dali Kingdom","Nanzhao","Lê dynasty","Nguyễn dynasty","Trần dynasty","Lý dynasty","Champa","Funan","Chenla","Pagan Kingdom","Toungoo dynasty","Konbaung dynasty","Lan Xang","Lan Na","Sukhothai Kingdom","Thonburi Kingdom","Rattanakosin Kingdom","Malacca Sultanate","Johor Sultanate","Brunei Empire","Sulu Sultanate","Mataram Sultanate","Sailendra dynasty","Kediri Kingdom","Singhasari","Tarumanagara","Kutai","Tondo","Butuan","Kingdom of Hawaiʻi","Tonga Empire","Tuʻi Tonga Empire","Rapa Nui","Tiwanaku","Wari Empire","Moche culture","Chimor","Chavín culture","Caral civilization","Maya civilization","Olmec civilization","Zapotec civilization","Mixtec civilization","Toltec Empire","Teotihuacan","Tarascan state","Tlaxcala","Kingdom of Guatemala","Viceroyalty of New Spain","Viceroyalty of Peru","Viceroyalty of New Granada","Viceroyalty of the Río de la Plata","Empire of Brazil","First Mexican Empire","Second Mexican Empire","Gran Colombia","Federal Republic of Central America","United Provinces of the Río de la Plata","Peru-Bolivian Confederation","Republic of Texas","New France","Thirteen Colonies","Dominion of Canada","Newfoundland Dominion","Cape Colony","Rhodesia","Federation of Rhodesia and Nyasaland","Union of South Africa","Orange Free State","South African Republic"];
const api='https://www.wikidata.org/w/api.php';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(params){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await fetch(api+'?'+new URLSearchParams({...params,format:'json'}),{headers:{'User-Agent':'ChronoEarthHistoricalDatabase/0.5 (https://github.com/scarab0793/chronoearth)'},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Wikidata HTTP '+r.status);
   const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j;
  }catch(e){if(attempt===2)throw e;await wait(1500*(attempt+1))}
 }
}
const claim=(e,p)=>e.claims?.[p]?.find(c=>c.mainsnak?.snaktype==='value')?.mainsnak?.datavalue?.value;
const year=v=>{const m=String(v?.time||'').match(/^([+-])(\d+)-/);if(!m)return null;const y=Number(m[2])*(m[1]==='-'?-1:1);return Number.isSafeInteger(y)?y:null};
async function main(){
 const ids=new Set();
 for(const term of [...terms,...additionalTerms]){
  const j=await get({action:'wbsearchentities',search:term,language:'en',type:'item',limit:'3'});
  for(const x of j.search||[])if(/^Q[1-9]\d*$/.test(x.id))ids.add(x.id);
  await wait(100);
 }
 const states=new Map(),all=[...ids];
 for(let i=0;i<all.length;i+=40){
  const j=await get({action:'wbgetentities',ids:all.slice(i,i+40).join('|'),props:'labels|descriptions|claims',languages:'en|hu'});
  for(const [id,e] of Object.entries(j.entities||{})){
   if(e.missing||!e.labels?.en?.value)continue;
   const kinds=(e.claims?.P31||[]).map(x=>x.mainsnak?.datavalue?.value?.id).filter(Boolean);
   if(kinds.includes('Q5')||kinds.includes('Q515'))continue;
   const from=year(claim(e,'P571'))??year(claim(e,'P580'));
   const to=year(claim(e,'P576'))??year(claim(e,'P582'));
   if(from===null||from>2026||to!==null&&to<from)continue;
   states.set(id,{id:'wikidata:'+id,wikidataId:id,name:e.labels.en.value,from,to,description:e.descriptions?.en?.value||'',typeIds:kinds,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',borderStatus:'unmapped',geometry:null});
  }
  await wait(250);
 }
 if(!states.size)throw Error('No dated polity candidates; preserve previous data');
 fs.mkdirSync('data/imports',{recursive:true});
 const records=[...states.values()].sort((a,b)=>a.from-b.from||a.wikidataId.localeCompare(b.wikidataId));
 fs.writeFileSync('data/imports/wikidata-states.json',JSON.stringify({schemaVersion:1,source:'Wikidata MediaWiki API',importedAt:new Date().toISOString(),reviewStatus:'unreviewed',note:'Candidate historical polities. Type, foundation/dissolution dates and boundaries require verification.',states:records},null,2)+'\n');
 console.log('Imported '+records.length+' historical polity candidates');
}
main().catch(e=>{console.error(e);process.exitCode=1});

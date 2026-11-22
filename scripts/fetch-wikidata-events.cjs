#!/usr/bin/env node
'use strict';
// Discovery via Wikidata API; validate event-type ancestry conservatively.
const fs=require('node:fs');
const terms=['Battle of Hastings','Battle of Waterloo','Battle of Marathon','Battle of Thermopylae','Battle of Agincourt','Battle of Stalingrad','Battle of Gettysburg','Battle of Trafalgar','Battle of Midway','Battle of Britain','Fall of Constantinople','French Revolution','Russian Revolution','American Revolution','Industrial Revolution','October Revolution','Glorious Revolution','Revolutions of 1848','Black Death','Great Fire of London','Great Depression','World War I','World War II','Thirty Years War','Hundred Years War','Crimean War','Napoleonic Wars','American Civil War','Korean War','Vietnam War','First Crusade','Fourth Crusade','Siege of Vienna','Siege of Leningrad','Sack of Rome','Magna Carta','Declaration of Independence','Treaty of Versailles','Treaty of Westphalia','Treaty of Tordesillas','Congress of Vienna','Berlin Wall fall','Apollo 11','Chernobyl disaster','Pompeii eruption','Lisbon earthquake','Great Famine Ireland','Spanish flu','Cuban Missile Crisis','Dissolution of the Soviet Union'];
const additionalTerms=["Battle of Cannae","Battle of Zama","Battle of Actium","Battle of Pharsalus","Battle of Gaugamela","Battle of Issus","Battle of Salamis","Battle of Plataea","Battle of Alesia","Battle of Adrianople","Battle of Tours","Battle of Manzikert","Battle of Hattin","Battle of Mohács","Battle of Lepanto","Battle of Vienna 1683","Battle of Blenheim","Battle of Poltava","Battle of Saratoga","Battle of Yorktown","Battle of Austerlitz","Battle of Borodino","Battle of Leipzig 1813","Battle of Antietam","Battle of Vicksburg","Battle of Königgrätz","Battle of Sedan 1870","Battle of Tsushima","Battle of the Marne","Battle of Verdun","Battle of the Somme","Battle of Jutland","Battle of Passchendaele","Battle of Tannenberg 1914","Battle of Moscow 1941","Battle of Kursk","Battle of El Alamein","Battle of Normandy","Battle of the Bulge","Battle of Berlin","Battle of Okinawa","Battle of Iwo Jima","Battle of Inchon","Battle of Dien Bien Phu","Battle of Khe Sanh","Battle of the Yarmouk","Battle of Talas","Battle of Kulikovo","Battle of Kosovo 1389","Battle of Nicopolis","Battle of Ankara 1402","Battle of Pavia 1525","Battle of Sekigahara","Battle of Plassey","Battle of Buxar","Battle of Adwa","Battle of Isandlwana","Battle of Rorke's Drift","Battle of Little Bighorn","Battle of the Alamo","Siege of Constantinople 1453","Siege of Jerusalem 1099","Siege of Baghdad 1258","Siege of Orleans","Siege of Malta 1565","Siege of Sarajevo","Fall of the Western Roman Empire","Fall of Baghdad 1258","Fall of Tenochtitlan","Fall of the Berlin Wall","Signing of the Magna Carta","Peace of Augsburg","Treaty of Utrecht","Treaty of Paris 1763","Treaty of Paris 1783","Treaty of Brest-Litovsk","Treaty of Trianon","Treaty of Saint-Germain-en-Laye 1919","Treaty of Nanking","Treaty of Portsmouth 1905","Treaty of San Francisco 1951","Edict of Milan","Edict of Nantes","Reformation","Protestant Reformation","Council of Trent","First Council of Nicaea","Great Schism of 1054","Meiji Restoration","Taika Reform","Taiping Rebellion","Boxer Rebellion","Indian Rebellion of 1857","Haitian Revolution","Mexican Revolution","Iranian Revolution","Xinhai Revolution","Cultural Revolution","Prague Spring","Hungarian Revolution of 1956","Velvet Revolution","Carnation Revolution","Arab Spring","Partition of India","Suez Crisis","Six-Day War","Yom Kippur War","Gulf War","Falklands War","Russo-Japanese War","First Opium War","Second Opium War","Boer War","Seven Years War","War of Spanish Succession","War of Austrian Succession","War of the Roses","Peloponnesian War","Punic Wars","Greco-Persian Wars","Great Northern War","Great Leap Forward","Holodomor","Armenian genocide","Rwandan genocide","Great Chinese Famine","Antonine Plague","Plague of Justinian","1918 influenza pandemic","COVID-19 pandemic","Haiti earthquake 2010","Indian Ocean earthquake and tsunami 2004","Krakatoa eruption 1883","Mount Tambora eruption 1815","Mount Vesuvius eruption 79","San Francisco earthquake 1906","Tangshan earthquake 1976","Great Kanto earthquake 1923","Hindenburg disaster","Titanic sinking","Challenger disaster","Columbia disaster","Sputnik 1 launch","First human spaceflight","Apollo 11 moon landing","First transatlantic flight","First powered flight","Invention of the printing press","Completion of the Suez Canal","Opening of the Panama Canal","Construction of the Great Wall of China","Construction of the Trans-Siberian Railway"];
const api='https://www.wikidata.org/w/api.php';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(params){
 for(let n=0;n<3;n++){
  try{
   const response=await fetch(api+'?'+new URLSearchParams({...params,format:'json'}),{headers:{'User-Agent':'ChronoEarthHistoricalDatabase/0.4 (https://github.com/scarab0793/chronoearth)'},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Wikidata HTTP '+response.status);
   const j=await response.json();if(j.error)throw Error(JSON.stringify(j.error));return j;
  }catch(e){if(n===2)throw e;await wait(1500*(n+1))}
 }
}
const claim=(e,p)=>e.claims?.[p]?.find(c=>c.mainsnak?.snaktype==='value')?.mainsnak?.datavalue?.value;
const year=v=>{const m=String(v?.time||'').match(/^([+-])(\d+)-/);if(!m)return null;const y=Number(m[2])*(m[1]==='-'?-1:1);return Number.isSafeInteger(y)?y:null};
async function main(){
 const ids=new Set();
 for(const term of [...terms,...additionalTerms]){
  const j=await get({action:'wbsearchentities',search:term,language:'en',type:'item',limit:'3'});
  for(const hit of j.search||[])if(/^Q[1-9]\d*$/.test(hit.id))ids.add(hit.id);
  await wait(100);
 }
 const events=new Map(),all=[...ids];
 for(let i=0;i<all.length;i+=40){
  const j=await get({action:'wbgetentities',ids:all.slice(i,i+40).join('|'),props:'labels|descriptions|claims',languages:'en|hu'});
  for(const [id,e] of Object.entries(j.entities||{})){
   if(e.missing)continue;
   const date=year(claim(e,'P585'))??year(claim(e,'P580'))??year(claim(e,'P571'));
   if(date===null||date>2026||date< -10000)continue;
   const label=e.labels?.en?.value||e.labels?.hu?.value;
   if(!label)continue;
   const kinds=(e.claims?.P31||[]).map(x=>x.mainsnak?.datavalue?.value?.id).filter(Boolean);
   // Exclude humans, geographic locations and other ambiguous hits.
   if(kinds.includes('Q5')||kinds.includes('Q515')||kinds.includes('Q6256'))continue;
   events.set(id,{id:'wikidata:'+id,wikidataId:id,name:label,year:date,description:e.descriptions?.en?.value||'',typeIds:kinds,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',location:null});
  }
  await wait(300);
 }
 if(!events.size)throw Error('No dated event candidates; preserve existing data');
 const records=[...events.values()].sort((a,b)=>a.year-b.year||a.wikidataId.localeCompare(b.wikidataId));
 fs.mkdirSync('data/imports',{recursive:true});
 fs.writeFileSync('data/imports/wikidata-events.json',JSON.stringify({schemaVersion:1,source:'Wikidata MediaWiki API',importedAt:new Date().toISOString(),reviewStatus:'unreviewed',note:'Candidate event catalogue; each item needs historical type and date review.',events:records},null,2)+'\n');
 console.log('Imported '+records.length+' dated event candidates');
}
main().catch(e=>{console.error(e);process.exitCode=1});

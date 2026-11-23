#!/usr/bin/env node
'use strict';
// Wikidata MediaWiki API importer: avoids expensive SPARQL scans.
// Search is discovery only; entity P31=human and birth-date claims are checked.
const fs=require('node:fs');
const api='https://www.wikidata.org/w/api.php';
const terms=['Roman emperor','Roman general','ancient Greek philosopher','ancient Egyptian pharaoh','medieval king','medieval queen','Renaissance scientist','Renaissance artist','historian','astronomer','mathematician','explorer','inventor','composer','Napoleonic general','scientist','political philosopher','medieval scholar','Chinese emperor','Mongol ruler'];
const namedPeople=["Hammurabi","Sargon of Akkad","Nebuchadnezzar II","Cyrus the Great","Darius I","Xerxes I","Pericles","Socrates","Aristotle","Herodotus","Thucydides","Hippocrates","Euclid","Archimedes","Pythagoras","Alexander the Great","Philip II of Macedon","Hannibal","Scipio Africanus","Augustus","Tiberius","Caligula","Claudius","Nero","Trajan","Hadrian","Marcus Aurelius","Constantine the Great","Theodosius I","Justinian I","Theodora","Charlemagne","Alfred the Great","William the Conqueror","Richard I of England","Saladin","Frederick II Holy Roman Emperor","Genghis Khan","Kublai Khan","Tamerlane","Mehmed II","Suleiman the Magnificent","Akbar","Ashoka","Qin Shi Huang","Emperor Wu of Han","Empress Wu Zetian","Zhu Yuanzhang","Kangxi Emperor","Tokugawa Ieyasu","Oda Nobunaga","Toyotomi Hideyoshi","Mansa Musa","Sundiata Keita","Shaka Zulu","Pachacuti","Moctezuma II","Atahualpa","Isabella I of Castile","Ferdinand II of Aragon","Elizabeth I","Mary Queen of Scots","Henry VIII","Louis XIV","Peter the Great","Catherine the Great","Maria Theresa","Joseph II Holy Roman Emperor","Frederick the Great","George Washington","Thomas Jefferson","Benjamin Franklin","Alexander Hamilton","Napoleon Bonaparte","Duke of Wellington","Simón Bolívar","José de San Martín","Abraham Lincoln","Otto von Bismarck","Giuseppe Garibaldi","Karl Marx","Friedrich Engels","Vladimir Lenin","Leon Trotsky","Joseph Stalin","Winston Churchill","Franklin D Roosevelt","Charles de Gaulle","Mahatma Gandhi","Jawaharlal Nehru","Sun Yat-sen","Mao Zedong","Nelson Mandela","Martin Luther King Jr","Marie Curie","Isaac Newton","Galileo Galilei","Johannes Kepler","Nicolaus Copernicus","René Descartes","Blaise Pascal","Ada Lovelace","Alan Turing","Nikola Tesla","Michael Faraday","James Clerk Maxwell","Louis Pasteur","Gregor Mendel","Rosalind Franklin","Florence Nightingale","Mary Wollstonecraft","Jane Austen","Mary Shelley","Virginia Woolf","Dante Alighieri","Petrarch","Geoffrey Chaucer","Miguel de Cervantes","Johann Wolfgang von Goethe","Ludwig van Beethoven","Wolfgang Amadeus Mozart","Johann Sebastian Bach","Frédéric Chopin","Pyotr Ilyich Tchaikovsky","Rembrandt","Michelangelo","Raphael","Donatello","Caravaggio","Vincent van Gogh","Pablo Picasso","Frida Kahlo","Ibn Sina","Ibn Rushd","Ibn Khaldun","Al-Khwarizmi","Al-Biruni","Zheng He","Ibn Battuta","Marco Polo","Christopher Columbus","Vasco da Gama","Ferdinand Magellan","James Cook","Roald Amundsen","Ernest Shackleton","Neil Armstrong"];
const seed=['Q1048','Q635','Q720','Q91','Q1035','Q1233','Q859','Q692','Q762','Q1426','Q7259','Q1339','Q937','Q7186','Q5582','Q5879','Q9036','Q8007','Q8462','Q4965','Q5715','Q1067','Q260','Q22670','Q9061','Q7245'];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function request(params){
 const url=api+'?'+new URLSearchParams({...params,format:'json'});
 for(let n=0;n<3;n++){
  try{
   const r=await fetch(url,{headers:{'User-Agent':'ChronoEarthHistoricalDatabase/0.3 (https://github.com/scarab0793/chronoearth)'},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Wikidata API '+r.status);
   const data=await r.json();if(data.error)throw Error(JSON.stringify(data.error));return data;
  }catch(e){if(n===2)throw e;await wait(1500*(n+1))}
 }
}
const claim=(e,p)=>e.claims?.[p]?.find(c=>c.mainsnak?.snaktype==='value')?.mainsnak?.datavalue?.value;
const years=v=>{if(!v?.time)return null;const m=v.time.match(/^([+-])(\d+)-/);if(!m)return null;const y=Number(m[2])*(m[1]==='-'?-1:1);return Number.isSafeInteger(y)?y:null};
async function main(){
 const ids=new Set(seed);
 for(const term of [...terms,...namedPeople]){
  const data=await request({action:'wbsearchentities',search:term,language:'en',type:'item',limit:'50'});
  for(const hit of data.search||[])if(/^Q[1-9]\d*$/.test(hit.id))ids.add(hit.id);
  await wait(100);
 }
 const people=new Map(),all=[...ids];
 for(let i=0;i<all.length;i+=40){
  const data=await request({action:'wbgetentities',ids:all.slice(i,i+40).join('|'),props:'labels|claims',languages:'en|hu'});
  for(const [id,e] of Object.entries(data.entities||{})){
   if(e.missing)continue;
   const instance=e.claims?.P31||[];
   if(!instance.some(c=>c.mainsnak?.datavalue?.value?.id==='Q5'))continue;
   const birth=years(claim(e,'P569')),death=years(claim(e,'P570'));
   if(!Number.isSafeInteger(birth)||birth>1900||death!==null&&(!Number.isSafeInteger(death)||death<birth))continue;
   people.set(id,{id:'wikidata:'+id,wikidataId:id,name:e.labels?.en?.value||e.labels?.hu?.value||id,birthYear:birth,deathYear:death,source:'https://www.wikidata.org/wiki/'+id,reviewStatus:'unreviewed',location:null});
  }
  console.log('Processed '+Math.min(i+40,all.length)+' of '+all.length+' candidates; '+people.size+' historical people');
  await wait(300);
 }
 if(!people.size)throw Error('No verified-human historical records; existing data unchanged');
 fs.mkdirSync('data/imports',{recursive:true});
 const previousFile='data/imports/wikidata-people.json';
 let retained=0;
 if(fs.existsSync(previousFile)){
  const previous=JSON.parse(fs.readFileSync(previousFile,'utf8'));
  for(const old of previous.people||[]){
   if(!/^Q[1-9]\d*$/.test(old.wikidataId||'')||!Number.isSafeInteger(old.birthYear)||old.reviewStatus!=='unreviewed')continue;
   if(!people.has(old.wikidataId)){people.set(old.wikidataId,old);retained++}
  }
 }
 console.log('Retained '+retained+' previously imported people records');
 const records=[...people.values()].sort((a,b)=>a.wikidataId.localeCompare(b.wikidataId,undefined,{numeric:true}));
 fs.writeFileSync('data/imports/wikidata-people.json',JSON.stringify({schemaVersion:2,source:'Wikidata MediaWiki API',importedAt:new Date().toISOString(),reviewStatus:'unreviewed',people:records},null,2)+'\n');
 console.log('Imported '+records.length+' historical people');
}
main().catch(e=>{console.error(e);process.exitCode=1});

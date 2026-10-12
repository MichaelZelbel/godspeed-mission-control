// The food table of the food tracker (Mission Control's work/plans/2026-10-12-trackers-food-design.md,
// D-321 step 5): the German Bundeslebensmittelschlüssel (BLS) 4.0 of the Max Rubner-Institut, free
// since December 2025 under CC BY 4.0. It is downloaded once at setup (`godspeed food-table install`,
// run by the installer, or once in the background when the notebook starts without it), refused
// unless its SHA-256 is the one pinned here, and kept in the workspace's machine state
// (.godspeed/food/bls-4.0/: the zip as downloaded, the few columns the tracker reads, the licence notice
// and where it came from). After that it works offline. Nothing of it is committed anywhere.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {outboundFetch} from './outbound-fetch.mjs';

// The request names the product and its website, never a person (12 October 2026: a research helper
// once sent Michael's email in a User-Agent; no code here ever does).
export const USER_AGENT='GodspeedMissionControl/2.0 (https://godspeedmissioncontrol.com)';
const CITATION='Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0, Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0';
export const BLS={
 version:'4.0',
 url:'https://www.blsdb.de/assets/uploads/BLS_4_0_2025_DE.zip',
 // Checked 12 October 2026: 14,263,306 bytes, Last-Modified 7 September 2026.
 sha256:'12b7a6ba62807ec9b301eb276f897dc85f99b2292311618dec3749a12d984c91',
 file:'BLS_4_0_2025_DE.zip',
 inner:'BLS_4_0_2025_DE/BLS_4_0_Daten_2025_DE.xlsx',
 publisher:'Max Rubner-Institut',
 licence:'CC BY 4.0',
 licenceUrl:'https://creativecommons.org/licenses/by/4.0/',
 citation:CITATION,
 // The line every place that names the table shows (the About page, the notice).
 notice:'Food values: Bundeslebensmittelschlüssel (BLS) 4.0, published by the Max Rubner-Institut under CC BY 4.0. '+CITATION+'. Packaged food: Open Food Facts (openfoodfacts.org), under the Open Database License (ODbL).',
};
export const OFF_ATTRIBUTION='Packaged food looked up by barcode or brand comes from Open Food Facts (https://openfoodfacts.org), whose database is available under the Open Database License (ODbL) and its individual contents under the Database Contents License (DbCL). This notebook keeps a local copy of the products it looked up.';
// The columns kept, in this order, per 100 g edible part (energy in kcal and kJ, the rest in grams).
export const COLUMNS=['id','de','en','kcal','kj','protein','fat','carbs','fiber','sugar','alcohol','salt'];
const CODES={kcal:'ENERCC',kj:'ENERCJ',protein:'PROT625',fat:'FAT',carbs:'CHO',fiber:'FIBT',sugar:'SUGAR',alcohol:'ALC',salt:'NACL'};
export const foodFolder=state=>path.join(state,'food');
export const blsFolder=state=>path.join(foodFolder(state),'bls-'+BLS.version);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// One entry of a zip, read from its central directory ("stored" and "deflated" only, which is all
// the MRI's zip and an xlsx use), as tools/mc-mail-age.js reads the age release.
export function unzipEntry(zip,wanted){
 let end=-1;
 for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('The food table download is not a zip file');
 const count=zip.readUInt16LE(end+10);let p=zip.readUInt32LE(end+16);
 for(let n=0;n<count;n++){
  if(zip.readUInt32LE(p)!==0x02014b50)throw Error('The food table zip is damaged');
  const method=zip.readUInt16LE(p+10),csize=zip.readUInt32LE(p+20),nameLen=zip.readUInt16LE(p+28),extraLen=zip.readUInt16LE(p+30),commentLen=zip.readUInt16LE(p+32),local=zip.readUInt32LE(p+42),name=zip.subarray(p+46,p+46+nameLen).toString('utf8');
  p+=46+nameLen+extraLen+commentLen;
  if(name!==wanted)continue;
  if(zip.readUInt32LE(local)!==0x04034b50)throw Error('The food table zip is damaged at '+name);
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28),data=zip.subarray(start,start+csize);
  if(method===0)return Buffer.from(data);
  if(method===8)return zlib.inflateRawSync(data);
  throw Error('The food table zip packs '+name+' in a way this program does not read');
 }
 return null;
}
const unescape=s=>s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi,(_,hex,dec,name)=>hex?String.fromCodePoint(parseInt(hex,16)):dec?String.fromCodePoint(Number(dec)):{amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name.toLowerCase()]);
const columnIndex=letters=>[...letters].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
// The rows of an xlsx's first sheet, each an array of its cells (shared strings resolved). Plain
// regular expressions over the XML: the sheet is one table of numbers and string indexes.
export function* xlsxRows(xlsx){
 const part=name=>{const b=unzipEntry(xlsx,name);return b?b.toString('utf8'):null;};
 const sharedXml=part('xl/sharedStrings.xml')||'',shared=[];
 for(const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g))shared.push(unescape([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t=>t[1]).join('')));
 const sheet=part('xl/worksheets/sheet1.xml');if(!sheet)throw Error('The food table has no sheet');
 const rowPattern=/<row\b[^>]*>([\s\S]*?)<\/row>/g,cellPattern=/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
 for(let m;(m=rowPattern.exec(sheet));){
  const cells=[];
  for(const c of m[1].matchAll(cellPattern)){
   const type=(c[2].match(/\bt="(\w+)"/)||[])[1],inner=c[3]||'',v=(inner.match(/<v>([\s\S]*?)<\/v>/)||[])[1];
   cells[columnIndex(c[1])]=type==='s'?shared[Number(v)]:type==='inlineStr'?unescape([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t=>t[1]).join('')):type==='str'||type==='e'?unescape(v??''):v===undefined?null:Number(v);
  }
  yield cells;
 }
}
// A value as the table gives it: a number; "-" or nothing is unknown; below the limit of detection or
// quantification ("<LOD", "<LOQ", "<LOD or <LOQ") counts as 0.
function value(v){
 if(typeof v==='number')return Number.isFinite(v)?Number(v.toFixed(6)):null;
 const s=String(v??'').trim();if(!s||s==='-')return null;
 if(s.startsWith('<'))return 0;
 const n=Number(s.replace(',','.'));return Number.isFinite(n)?Number(n.toFixed(6)):null;
}
// The BLS sheet to the columns kept: [id, German name, English name, kcal, kJ, protein, fat,
// carbohydrates, fibre, sugar, alcohol, salt]. Columns are found by their header, not their place.
export function convertBls(xlsx){
 const rows=xlsxRows(xlsx),header=rows.next().value||[];
 const find=test=>header.findIndex(h=>typeof h==='string'&&test(h));
 const at={id:find(h=>h==='BLS Code'),de:find(h=>h==='Lebensmittelbezeichnung'),en:find(h=>h==='Food name')};
 for(const [key,code] of Object.entries(CODES))at[key]=find(h=>h.startsWith(code+' ')&&h.includes('['));
 const lost=COLUMNS.filter(k=>!(at[k]>=0));if(lost.length)throw Error('The food table lacks the columns '+lost.join(', '));
 const foods=[];
 for(const cells of rows){
  const id=String(cells[at.id]??'').trim();if(!/^[A-Z][0-9A-Z]{6}$/.test(id))continue;
  foods.push([id,String(cells[at.de]??'').trim(),String(cells[at.en]??'').trim(),...COLUMNS.slice(3).map(k=>value(cells[at[k]]))]);
 }
 return {source:'BLS '+BLS.version,columns:COLUMNS,foods};
}
const noticeText=({sha256,bytes,at,foods})=>`# Food table: Bundeslebensmittelschlüssel (BLS) ${BLS.version}

Source: ${BLS.publisher}, Bundeslebensmittelschlüssel (BLS), version ${BLS.version}, downloaded from
${BLS.url} (${bytes.toLocaleString('en-US')} bytes, SHA-256 ${sha256}) on ${at.slice(0,10)}.

Licence: Creative Commons Attribution 4.0 International (CC BY 4.0), ${BLS.licenceUrl}.
Publisher: ${BLS.publisher}.

Citation: ${BLS.citation}

Changes: Godspeed Mission Control keeps, for each of the ${foods.toLocaleString('en-US')} foods, its code, German and English
name and, per 100 g edible part, energy (kcal and kJ), protein, fat, available carbohydrates, fibre,
sugar, alcohol and salt, in foods.json. A value below the limit of detection or quantification is
counted as 0, a missing value as unknown. The downloaded file is kept unchanged beside it
(${BLS.file}).

${OFF_ATTRIBUTION}
`;
// Downloads, checks and converts the table into .godspeed/food/bls-4.0/. Does nothing when it is
// already there (offline after setup). Writes nothing unless the checksum is the pinned one.
export async function installFoodTable(state,{fetcher,url=BLS.url,sha256=BLS.sha256,force=false,signal,timeoutMs=180000}={}){
 const folder=blsFolder(state),sourceFile=path.join(folder,'source.json');
 if(!force&&fs.existsSync(path.join(folder,'foods.json'))&&fs.existsSync(sourceFile)){
  try{const source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));if(source.sha256===sha256)return {installed:false,foods:source.foods,sha256,folder};}catch{}
 }
 let zip=fs.existsSync(path.join(folder,BLS.file))?fs.readFileSync(path.join(folder,BLS.file)):null;
 if(!zip||sha(zip)!==sha256){
  const response=await outboundFetch(url,{headers:{'User-Agent':USER_AGENT}},{timeoutMs,maxBytes:40*1024*1024,fetcher,signal});
  if(response.status!==200)throw Error('The food table could not be downloaded from '+url+' (HTTP '+response.status+'). Nothing was changed.');
  zip=Buffer.from(await response.arrayBuffer());
 }
 const got=sha(zip);
 if(got!==sha256)throw Error('The food table download did not match its checksum (expected '+sha256+', got '+got+'), so it was not installed. Nothing was changed.');
 const inner=unzipEntry(zip,BLS.inner);if(!inner)throw Error('The food table download does not hold '+BLS.inner+'. Nothing was changed.');
 const converted=convertBls(inner),at=new Date().toISOString();
 // Written next to the folder first and moved into place, so a reader never sees half a table.
 const incoming=folder+'.incoming-'+process.pid;fs.rmSync(incoming,{recursive:true,force:true});fs.mkdirSync(incoming,{recursive:true});
 fs.writeFileSync(path.join(incoming,BLS.file),zip);
 fs.writeFileSync(path.join(incoming,'foods.json'),JSON.stringify(converted));
 fs.writeFileSync(path.join(incoming,'NOTICE.md'),noticeText({sha256:got,bytes:zip.length,at,foods:converted.foods.length}));
 fs.writeFileSync(path.join(incoming,'source.json'),JSON.stringify({url,bytes:zip.length,sha256:got,downloaded_at:at,foods:converted.foods.length,licence:BLS.licence,citation:BLS.citation},null,2)+'\n');
 fs.rmSync(folder,{recursive:true,force:true});fs.renameSync(incoming,folder);
 cache.delete(folder);
 return {installed:true,foods:converted.foods.length,sha256:got,bytes:zip.length,folder};
}
// Whether a starting notebook should fetch the table itself: it has none, it is not switched off, and
// it is not a test (node --test marks its processes with NODE_TEST_CONTEXT).
export const foodTableWanted=(state,env=process.env)=>env.GODSPEED_FOOD_TABLE!=='off'&&!env.NODE_TEST_CONTEXT&&!fs.existsSync(path.join(blsFolder(state),'foods.json'));
// The table, read once per change of its file; null when it is not installed.
const cache=new Map();
export function foodTable(state){
 const folder=blsFolder(state),file=path.join(folder,'foods.json');
 let stat;try{stat=fs.statSync(file);}catch{return null;}
 const known=cache.get(folder);if(known&&known.mtimeMs===stat.mtimeMs&&known.size===stat.size)return known.table;
 const raw=JSON.parse(fs.readFileSync(file,'utf8')),cols=raw.columns||COLUMNS;
 const foods=raw.foods.map(row=>Object.fromEntries(cols.map((k,i)=>[k,row[i]??null])));
 const table={source:raw.source,foods,byId:new Map(foods.map(f=>[f.id,f])),words:foods.map(nameWords),heads:foods.map(f=>{const de=wordsOf(f.de);return [de[0]||'',(de[0]||'')+(de[1]||''),wordsOf(f.en)[0]||''];})};
 cache.set(folder,{mtimeMs:stat.mtimeMs,size:stat.size,table});
 return table;
}
export const foodById=(table,id)=>table?.byId.get(String(id??'').trim())||null;
export function tableStatus(state){
 const folder=blsFolder(state);let source=null;try{source=JSON.parse(fs.readFileSync(path.join(folder,'source.json'),'utf8'));}catch{}
 return {installed:!!foodTable(state),folder,source,notice:fs.existsSync(path.join(folder,'NOTICE.md'))?path.join(folder,'NOTICE.md'):null};
}

// ---- Search ------------------------------------------------------------------------------------
const fold=s=>String(s??'').toLocaleLowerCase('de').normalize('NFKC');
// A hyphenated word is one word, as German writes a compound: in "Eier-Frischteigwaren" the eggs only
// describe the pasta.
const wordsOf=s=>fold(s).split(/[^\p{L}\p{N}-]+/u).map(w=>w.replace(/-/g,'')).filter(Boolean);
// A food's words in both languages, and the German ones also joined in pairs ("Hafer Flocken" is
// what a person writes as "Haferflocken").
const nameWords=f=>{const de=wordsOf(f.de);return [...wordsOf(f.en),...de,...de.slice(1).map((w,i)=>de[i]+w)];};
// The plain German word for common English food words. The BLS names a food first in German
// ("Reis poliert, roh", "Hühnerei roh", "Milch fettarm"), while its English names often put another
// word first ("White rice raw", "Chicken egg raw"), so "rice" alone found rice flour and rice noodles
// before rice. Only the search uses this; every number still comes from the table.
const GERMAN={rice:'reis',egg:'hühnerei',eggs:'hühnerei',eier:'hühnerei',milk:'milch',bread:'brot',butter:'butter',cheese:'käse',chicken:'hähnchen',potato:'kartoffel',potatoes:'kartoffeln',apple:'apfel',banana:'banane',oat:'hafer',oats:'haferflocken',porridge:'porridge',yogurt:'joghurt',yoghurt:'joghurt',pasta:'teigwaren',noodles:'nudeln',salmon:'lachs',tuna:'thunfisch',beef:'rind',pork:'schwein',ham:'schinken',sausage:'wurst',tomato:'tomate',tomatoes:'tomaten',cucumber:'gurke',carrot:'möhre',carrots:'möhren',onion:'zwiebel',lettuce:'kopfsalat',broccoli:'brokkoli',spinach:'spinat',lentils:'linsen',beans:'bohnen',chickpeas:'kichererbsen',nuts:'nüsse',almonds:'mandeln',walnuts:'walnüsse',peanuts:'erdnuss',oil:'öl',sugar:'zucker',honey:'honig',jam:'konfitüre',coffee:'kaffee',tea:'tee',juice:'saft',orange:'orange',strawberries:'erdbeeren',blueberries:'heidelbeeren',cream:'sahne',chocolate:'schokolade',roll:'brötchen',rolls:'brötchen',water:'wasser',beer:'bier',wine:'wein',flour:'mehl',fish:'fisch',turkey:'pute',quark:'quark',muesli:'müsli',cereal:'müsli',pear:'birne',grapes:'weintrauben',peas:'erbsen',corn:'mais',mushrooms:'champignons',pepper:'paprika',zucchini:'zucchini',avocado:'avocado'};
// A word as said and its likely stems: "eggs" egg, "Eier" ei, "Brötchen" brötchen.
function variants(word){
 const out=new Set([word]);if(GERMAN[word])out.add(GERMAN[word]);
 // Two letters are left only by a German plural ("Eier" ei); "rye" is never "ry".
 for(const end of ['es','s','en','er','e','n'])if(word.endsWith(end)&&word.length-end.length>=(['en','er'].includes(end)?2:3))out.add(word.slice(0,-end.length));
 return [...out];
}
// How well one said word names a word of a food: the same word, its start, the end of a German
// compound ("Ei" in "Hühnerei", "Brot" in "Roggenbrot"), or, for longer words, any part of it.
function wordScore(said,name){
 let best=0;
 for(const v of variants(said))for(const w of name){
  // A German compound ends with what it is: "Hühnerei" is an egg, "Eierteigwaren" is pasta.
  let s=w===v?3:v.length>=2&&w.length>v.length&&w.endsWith(v)?2.5:v.length>=3&&w.startsWith(v)?2:v.length>=4&&w.includes(v)?1:0;
  // A German compound said shorter than the table writes it: "Roggenbrot" for "Roggenmischbrot".
  for(let i=4;!s&&i<=v.length-4;i++)if(w.startsWith(v.slice(0,i))&&w.endsWith(v.slice(i)))s=2;
  if(s>best)best=s;
 }
 return best;
}
const STOP=new Set('a an and with of the some half one two three four five six seven eight nine ten slice slices piece pieces pack packs bowl bowls cup cups glass glass plate g gram grams ml und mit ein eine einen einer zwei drei vier fünf halbe halber halbes scheibe scheiben stück packung schale tasse glas teller gramm von vom'.split(' '));
// The foods a phrase names, best first: each said word scored against the food's English and German
// words; shorter (plainer) names first among equals.
// The foods a phrase names, best first: each said word scored against the food's English and German
// words. The BLS writes the food itself first in German ("Reis poliert, roh", "Hühnerei roh",
// "Butter mild gesäuert"), so a word that names the first German word counts more, the first English
// word a little; a plain food ("roh", "raw") and a shorter name come first among equals. Composite
// dishes are found when they are asked for by more words.
export function searchFoods(table,query,{limit=12}={}){
 if(!table)return [];
 const said=wordsOf(query).filter(w=>!STOP.has(w)&&!/^\d+$/.test(w));if(!said.length)return [];
 const scored=[];
 table.foods.forEach((f,i)=>{
  const name=table.words[i];let total=0,hits=0;
  for(const w of said){const s=wordScore(w,name);if(!s)continue;hits++;total+=s+(wordScore(w,table.heads[i])>=2?1:0);}
  if(!hits)return;
  if(/(?<!\p{L})(?:roh|raw)(?!\p{L})/iu.test(f.de+' '+f.en))total+=0.1;
  scored.push({f,total,hits,words:wordsOf(f.en).length});
 });
 scored.sort((a,b)=>b.hits-a.hits||b.total-a.total||a.words-b.words||a.f.en.length-b.f.en.length||a.f.id.localeCompare(b.f.id));
 return scored.slice(0,limit).map(({f})=>({id:f.id,name:f.en,name_de:f.de,kcal:f.kcal,protein_g:f.protein,fat_g:f.fat,carbs_g:f.carbs}));
}

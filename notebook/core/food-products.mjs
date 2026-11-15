// Packaged food for the food tracker (D-321 step 5): Open Food Facts, looked up only when a barcode or a
// branded product is named, kept in a local cache (.godspeed/food/products.json, machine state) so a
// product is read from the network once. Their rules: a custom User-Agent, at most 15 product reads
// and 10 searches a minute; the database is ODbL. The request names this product and its website as
// the program and carries the barcode or the search words, nothing else: never a person's name, email,
// cookie or key (12 October 2026: a research helper once sent the developer's email in a User-Agent).
import fs from 'node:fs';
import path from 'node:path';
import {outboundFetch} from './outbound-fetch.mjs';
import {USER_AGENT,foodFolder} from './food-table.mjs';

export const OFF_USER_AGENT=USER_AGENT;
const BASE='https://world.openfoodfacts.org',SEARCH='https://search.openfoodfacts.org/search';
const FIELDS='code,product_name,product_name_en,product_name_de,brands,nutriments';
const LIMITS={product:15,search:10},MINUTE=60000;
let seen={product:[],search:[]};
export const resetLimits=()=>{seen={product:[],search:[]};};
function allow(kind){
 const now=Date.now();seen[kind]=seen[kind].filter(t=>now-t<MINUTE);
 if(seen[kind].length>=LIMITS[kind])throw Error('Open Food Facts allows '+LIMITS[kind]+(kind==='product'?' product lookups':' searches')+' a minute, and this minute\'s are used. Try again in a minute.');
 seen[kind].push(now);
}
const cacheFile=state=>path.join(foodFolder(state),'products.json');
function readCache(state){try{const c=JSON.parse(fs.readFileSync(cacheFile(state),'utf8'));return {products:c.products||{},searches:c.searches||{}};}catch{return {products:{},searches:{}};}}
function writeCache(state,cache){const file=cacheFile(state);fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(cache));fs.renameSync(tmp,file);}
const strip=({fetched_at,...p})=>p;
const num=v=>{const n=typeof v==='number'?v:Number(String(v??'').replace(',','.'));return v===undefined||v===null||v===''||!Number.isFinite(n)?null:Number(n.toFixed(4));};
// A product as the tracker reads a food: per 100 g. Energy in kcal, or from kJ when only that is given.
function food(p){
 const code=String(p.code||'').trim(),n=p.nutriments||{},name=String(p.product_name_en||p.product_name||p.product_name_de||'').trim()||'Product '+code;
 let kcal=num(n['energy-kcal_100g']);if(kcal===null&&num(n.energy_100g)!==null)kcal=Math.round(num(n.energy_100g)/4.184*10)/10;
 if(kcal===null)return null;
 return {id:'off:'+code,name,brand:String([].concat(p.brands||'')[0]||'').split(',')[0].trim()||null,kcal,protein:num(n.proteins_100g),fat:num(n.fat_100g),carbs:num(n.carbohydrates_100g),fiber:num(n.fiber_100g),sugar:num(n.sugars_100g),salt:num(n.salt_100g),source:'Open Food Facts '+code};
}
async function get(url,fetcher,signal){
 const response=await outboundFetch(url,{headers:{'User-Agent':OFF_USER_AGENT}},{timeoutMs:15000,maxBytes:2*1024*1024,fetcher,signal});
 if(response.status!==200)throw Error('Open Food Facts did not answer (HTTP '+response.status+'). Try again later, or name a similar food from the table.');
 return JSON.parse(await response.text());
}
export function productById(state,id){const code=String(id||'').replace(/^off:/,''),p=readCache(state).products[code];return p?strip(p):null;}
export async function lookupBarcode(state,code,{fetcher,signal}={}){
 code=String(code??'').replace(/\s+/g,'');
 if(!/^\d{8,14}$/.test(code))throw Error('A barcode is 8 to 14 digits.');
 const cache=readCache(state);if(cache.products[code])return strip(cache.products[code]);
 allow('product');
 const answer=await get(BASE+'/api/v2/product/'+code+'.json?fields='+FIELDS,fetcher,signal);
 if(answer.status!==1||!answer.product)throw Error('Open Food Facts does not know the barcode '+code+'. Name the food instead, and I will find it in the food table.');
 const f=food({...answer.product,code});
 if(!f)throw Error('Open Food Facts has no energy per 100 g for '+(answer.product.product_name||code)+', so I cannot count it. Name a similar food instead.');
 const fresh=readCache(state);fresh.products[code]={...f,fetched_at:new Date().toISOString()};writeCache(state,fresh);
 const {fetched_at,...out}=fresh.products[code];return out;
}
const key=q=>String(q??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export async function searchProducts(state,query,{fetcher,signal,limit=8}={}){
 const q=key(query);if(!q)throw Error('Say which product to look for.');
 const cache=readCache(state);
 if(cache.searches[q])return cache.searches[q].codes.map(c=>cache.products[c]).filter(Boolean).map(strip).slice(0,limit);
 allow('search');
 // Their search service (search.openfoodfacts.org); the older cgi/search.pl answered 503 under load
 // when this was built, on 12 October 2026.
 const answer=await get(SEARCH+'?q='+encodeURIComponent(String(query).trim())+'&page_size='+limit+'&fields='+FIELDS,fetcher,signal);
 const found=(answer.hits||answer.products||[]).map(food).filter(Boolean),fresh=readCache(state),at=new Date().toISOString();
 for(const f of found)fresh.products[f.id.slice(4)]={...f,fetched_at:at};
 fresh.searches[q]={codes:found.map(f=>f.id.slice(4)),at};writeCache(state,fresh);
 return found.slice(0,limit);
}
// Products looked up before, by a word of their name or brand; read only, no network.
export function cachedProducts(state,query){
 const words=key(query).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3);if(!words.length)return [];
 return Object.values(readCache(state).products).filter(p=>words.some(w=>key(p.name+' '+(p.brand||'')).includes(w))).map(strip);
}

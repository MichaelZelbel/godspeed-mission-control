import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {lookupBarcode,searchProducts,productById,cachedProducts,resetLimits,OFF_USER_AGENT} from '../core/food-products.mjs';

// Packaged food through Open Food Facts (D-321 step 5): looked up when a barcode or a branded product is
// named, cached locally, at most 15 product reads and 10 searches a minute, and the request names the
// product and its website as the program, never a person (12 October 2026: a research helper once put
// the developer's email in a User-Agent; no code here may ever do that).
const state=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-off-')),'.godspeed');
const PRODUCT={code:'4008400401621',product_name:'Nutella',brands:'Ferrero',nutriments:{'energy-kcal_100g':539,'energy_100g':2252,proteins_100g:6.3,fat_100g:30.9,carbohydrates_100g:57.5,fiber_100g:0,sugars_100g:56.3,salt_100g:0.107}};
function network(answer=url=>/\/api\/v2\/product\//.test(url)?{status:1,product:{...PRODUCT,code:url.match(/product\/(\d+)/)[1]}}:{hits:[PRODUCT,{code:'4001686301265',product_name:'Haribo Goldbären',brands:['Haribo'],nutriments:{'energy-kcal_100g':343,proteins_100g:6.9,fat_100g:0.5,carbohydrates_100g:77}}]}){
 const calls=[];return {calls,fetcher:async(url,init)=>{calls.push({url:String(url),init});return new Response(JSON.stringify(answer(String(url))),{status:200,headers:{'content-type':'application/json'}});}};
}
test.beforeEach(()=>resetLimits());

test('a barcode answers the product per 100 g, and the second lookup comes from the cache',async()=>{
 const dir=state(),{calls,fetcher}=network();
 const p=await lookupBarcode(dir,'4008400401621',{fetcher});
 assert.deepEqual(p,{id:'off:4008400401621',name:'Nutella',brand:'Ferrero',kcal:539,protein:6.3,fat:30.9,carbs:57.5,fiber:0,sugar:56.3,salt:0.107,source:'Open Food Facts 4008400401621'});
 assert.deepEqual(await lookupBarcode(dir,'4008400401621',{fetcher}),p);
 assert.equal(calls.length,1,'one request for two lookups');
 assert.deepEqual(productById(dir,'off:4008400401621'),p,'and later, offline, by its id');
 assert.ok(fs.existsSync(path.join(dir,'food','products.json')));
});

test('the request names the product and its website, and carries nothing about the person',async()=>{
 const {calls,fetcher}=network();
 await lookupBarcode(state(),'4008400401621',{fetcher});
 const {url,init}=calls[0];
 assert.equal(OFF_USER_AGENT,'GodspeedMissionControl/2.0 (https://godspeedmissioncontrol.com)');
 assert.equal(init.headers['User-Agent'],OFF_USER_AGENT);
 assert.doesNotMatch(JSON.stringify(init.headers)+url,/@/,'no email anywhere');
 assert.deepEqual(Object.keys(init.headers),['User-Agent'],'no other header: no cookie, no key');
 assert.match(url,/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/4008400401621\.json\?fields=/);
 assert.doesNotMatch(url,/user|name=|email|owner/i);
});

test('a search caches its products, and the cache answers a search offline',async()=>{
 const dir=state(),{calls,fetcher}=network();
 const found=await searchProducts(dir,'Goldbären',{fetcher});
 assert.deepEqual(found.map(p=>p.id),['off:4008400401621','off:4001686301265']);
 assert.match(calls[0].url,/^https:\/\/search\.openfoodfacts\.org\/search\?q=Goldb%C3%A4ren&/);
 assert.equal((await searchProducts(dir,'goldbären',{fetcher})).length,2);assert.equal(calls.length,1,'the same search is answered from the cache');
 assert.deepEqual(cachedProducts(dir,'Haribo').map(p=>p.id),['off:4001686301265']);
});

test('the 16th product read in a minute is refused without a request',async()=>{
 const dir=state(),{calls,fetcher}=network();
 for(let i=0;i<15;i++)await lookupBarcode(dir,String(4000000000000+i),{fetcher});
 await assert.rejects(lookupBarcode(dir,'4000000000099',{fetcher}),/a minute/);
 assert.equal(calls.length,15);
 for(let i=0;i<10;i++)await searchProducts(dir,'brand '+i,{fetcher});
 await assert.rejects(searchProducts(dir,'brand 99',{fetcher}),/a minute/);
});

test('an unknown barcode, a product without energy and a wrong code are refused plainly',async()=>{
 const dir=state();
 await assert.rejects(lookupBarcode(dir,'4000000000001',{fetcher:network(()=>({status:0,status_verbose:'product not found'})).fetcher}),/does not know the barcode 4000000000001/);
 await assert.rejects(lookupBarcode(dir,'4000000000002',{fetcher:network(()=>({status:1,product:{code:'4000000000002',product_name:'Mystery',nutriments:{}}})).fetcher}),/no energy per 100 g/);
 await assert.rejects(lookupBarcode(dir,'12ab',{fetcher:network().fetcher}),/barcode/);
 assert.equal(productById(dir,'off:4000000000002'),null,'nothing cached for a refused product');
});

test('energy given only in kJ is converted',async()=>{
 const p=await lookupBarcode(state(),'4000000000003',{fetcher:network(()=>({status:1,product:{code:'4000000000003',product_name:'Kj only',nutriments:{energy_100g:418.4,proteins_100g:1,fat_100g:0,carbohydrates_100g:24}}})).fetcher});
 assert.equal(p.kcal,100);
});

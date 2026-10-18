import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {BLS,installFoodTable,foodTable,searchFoods,foodById,blsFolder,convertBls,unzipEntry} from '../core/food-table.mjs';

// The food table (D-321 step 5): the German Bundeslebensmittelschlüssel 4.0, downloaded once at setup,
// checked against its pinned checksum, converted to the few columns the food tracker reads, and offline
// after that. The fixture is cut from the real download: its own header (418 columns) and 38 real rows.
const FIXTURE=new URL('./fixtures/bls-4.0/BLS_4_0_2025_DE.zip',import.meta.url);
const fixture=()=>fs.readFileSync(FIXTURE);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const state=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-food-table-')),'.godspeed');
// A stand-in network that serves the fixture zip and counts the requests it was asked.
function network(bytes=fixture()){const calls=[];const fetcher=async(url,init)=>{calls.push({url:String(url),headers:init.headers});return new Response(bytes,{status:200,headers:{'content-type':'application/zip'}});};return {calls,fetcher};}

test('the pinned source is the BLS 4.0 download, with its licence and citation',()=>{
 assert.equal(BLS.url,'https://www.blsdb.de/assets/uploads/BLS_4_0_2025_DE.zip');
 assert.equal(BLS.sha256,'12b7a6ba62807ec9b301eb276f897dc85f99b2292311618dec3749a12d984c91');
 assert.equal(BLS.licence,'CC BY 4.0');
 assert.equal(BLS.citation,'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0, Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0');
 assert.doesNotMatch(BLS.citation+BLS.notice,/[–—]/,'no long dashes');
});

test('install downloads once, checks the checksum, converts, and writes the notice beside the table',async()=>{
 const dir=state(),{calls,fetcher}=network();
 const done=await installFoodTable(dir,{fetcher,sha256:sha(fixture())});
 assert.equal(done.installed,true);assert.equal(done.foods,38);
 assert.equal(calls.length,1);assert.equal(calls[0].url,BLS.url);
 assert.equal(calls[0].headers['User-Agent'],'GodspeedMissionControl/2.0 (https://godspeedmissioncontrol.com)');
 assert.doesNotMatch(JSON.stringify(calls[0]),/@/,'no person and no email in the request');
 const folder=blsFolder(dir);
 for(const file of ['BLS_4_0_2025_DE.zip','foods.json','NOTICE.md','source.json'])assert.ok(fs.existsSync(path.join(folder,file)),file);
 const notice=fs.readFileSync(path.join(folder,'NOTICE.md'),'utf8');
 assert.match(notice,/CC BY 4\.0/);assert.match(notice,/Max Rubner-Institut/);assert.ok(notice.includes(BLS.citation));
 assert.match(notice,/Open Food Facts/);assert.match(notice,/Open Database License/);
 assert.doesNotMatch(notice,/[–—]/);
 const source=JSON.parse(fs.readFileSync(path.join(folder,'source.json'),'utf8'));
 assert.equal(source.sha256,sha(fixture()));assert.equal(source.url,BLS.url);assert.equal(source.bytes,fixture().length);
 // Offline after that: a second install asks the network nothing.
 const again=await installFoodTable(dir,{fetcher,sha256:sha(fixture())});
 assert.equal(again.installed,false);assert.equal(calls.length,1);
});

test('a download with another checksum is refused and writes nothing',async()=>{
 const dir=state(),{fetcher}=network();
 await assert.rejects(installFoodTable(dir,{fetcher}),/checksum/);
 assert.equal(fs.existsSync(blsFolder(dir)),false);
 assert.equal(foodTable(dir),null);
});

test('values per 100 g come out exactly, for a plain food and a dish; below detection is 0, missing is unknown',async()=>{
 const dir=state();await installFoodTable(dir,{fetcher:network().fetcher,sha256:sha(fixture())});
 const table=foodTable(dir);
 assert.equal(table.foods.length,38);
 assert.deepEqual(foodById(table,'H861000'),{id:'H861000',de:'Tofu',en:'Tofu',kcal:115,kj:482,protein:15.51,fat:5.63,carbs:0,fiber:1.3,sugar:0,alcohol:0,salt:0.032});
 const stew=foodById(table,'X461813');
 assert.deepEqual([stew.en,stew.kcal,stew.protein,stew.fat,stew.carbs],['Lentil stew with vegetables',127,7.49,2.3,15.8]);
 assert.equal(foodById(table,'F110400').fat,0,'"<LOD" counts as 0');
 assert.equal(foodById(table,'P355000').fiber,null,'"-" is unknown');
 assert.equal(foodById(table,'C133000').fiber,10.983,'the sheet\'s 10.983000000000001 is read as 10.983');
 assert.equal(foodById(table,'nope'),null);
});

test('search finds the foods a person names, in English and German',async()=>{
 const dir=state();await installFoodTable(dir,{fetcher:network().fetcher,sha256:sha(fixture())});
 const table=foodTable(dir),ids=q=>searchFoods(table,q).map(f=>f.id);
 assert.equal(ids('tofu')[0],'H861000');
 assert.ok(ids('rice').includes('C352000'));
 assert.ok(ids('eggs').includes('E111100'));
 assert.ok(ids('rye bread').slice(0,3).includes('B271000'));
 assert.ok(ids('Eier').includes('E111100'),'German plural finds Hühnerei');
 assert.ok(ids('Roggenbrot').some(id=>['B271000','B121000'].includes(id)));
 assert.deepEqual(ids('zzzz'),[]);
 const hit=searchFoods(table,'tofu')[0];
 assert.deepEqual(Object.keys(hit).sort(),['carbs_g','fat_g','id','kcal','name','name_de','protein_g'].sort());
});

test('the converter reads the real download when it is on this computer',{skip:!process.env.GODSPEED_BLS_ZIP&&'set GODSPEED_BLS_ZIP to the downloaded BLS_4_0_2025_DE.zip'},()=>{
 const zip=fs.readFileSync(process.env.GODSPEED_BLS_ZIP);
 assert.equal(sha(zip),BLS.sha256);
 const converted=convertBls(unzipEntry(zip,BLS.inner));
 assert.equal(converted.foods.length,7140);
 const tofu=converted.foods.find(f=>f[0]==='H861000');
 assert.deepEqual(tofu,['H861000','Tofu','Tofu',115,482,15.51,5.63,0,1.3,0,0,0.032]);
 assert.ok(converted.foods.every(f=>typeof f[3]==='number'),'every food has its energy');
});

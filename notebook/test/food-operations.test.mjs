import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {trackers,entries} from '../core/trackers.mjs';
import {resetLimits} from '../core/food-products.mjs';
import {withTable} from './food-fixture.mjs';

// The food tracker's operations (D-321 step 5), on the shared tracker base: one path for the notebook's
// chat, MCP and the bot. A frozen clock (GODSPEED_NOW), the table cut from the real BLS file, no model.
// talks: the coaching areas that have a talk; a new mission control has none (D-321).
async function fixture(now='2026-10-12T10:00:00Z',{talks=[]}={}){
 process.env.GODSPEED_NOW=now;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-food-ops-')),store=new Store(root),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});await withTable(root);
 for(const area of talks){fs.mkdirSync(path.join(root,'coach',area),{recursive:true});fs.writeFileSync(path.join(root,'coach',area,'area.md'),'AREA: '+area+'\nTITLE: '+area+'\nRHYTHM: weekly sunday\nTIME: 19:00\nSTARTS: 2026-09-01\nSTATUS: on\n\n## Preparation\n\nx\n');}
 return {root,store,query,domains,op:input=>domains.invoke('personal-operation',input)};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});
const at=iso=>{process.env.GODSPEED_NOW=iso;};
const food=store=>trackers(store).find(c=>c.tracker.specialist==='food');
const TOFU={food:'H861000',item:'tofu',grams:200,assumed:true},HALF_PACK={food:'C352000',item:'rice',count:0.5,unit:'pack'};
const EGGS={food:'E111100',item:'eggs',count:2,unit:'egg',grams:120,assumed:true},RYE={food:'B271000',item:'rye bread',count:1,unit:'slice',grams:50,assumed:true};
const SETUP='Start a food tracker? It works out calories and protein from a food table and can keep a daily target for you. The numbers are estimates from the table, and you can change every entry in your notebook. If you have or had an eating disorder, tell me, and I will show totals only when you ask and never set a target.';

test('"track food, tofu with half a pack of rice": the setup question asks about the pack once and creates nothing; "250 g, and yes" tracks it',async()=>{
 const f=await fixture();
 const held=await f.op({type:'food',action:'track',items:[TOFU,HALF_PACK]});
 assert.equal(held.reply,SETUP+' How big was the pack of rice?');
 assert.equal(food(f.store),undefined,'nothing created');
 assert.equal((await f.op({type:'tracker-list'})).pending[0].question,held.reply,'the open question is listed as the base lists them');
 const made=await f.op({type:'tracker-create',proposal_id:held.proposal_id,answers:[{grams:250}]});
 // Tofu 200 g: 115 x 2 = 230 kcal, 15.51 x 2 = 31.02 g protein. Rice 125 g: 351 x 1.25 = 438.75 kcal, 7.931 x 1.25 = 9.91 g.
 assert.equal(made.reply,'Tracked: tofu 200 g (assumed), rice 125 g: 669 kcal, 41 g protein. Say "set my food target" when you want a daily target.');
 const c=food(f.store);
 // This mission control has no health talk, so no talk reads it (D-321).
 assert.deepEqual({name:c.name,cadence:c.tracker.cadence,talk:c.tracker.talk,specialist:c.tracker.specialist},{name:'Food',cadence:'any',talk:null,specialist:'food'});
 assert.deepEqual(entries(f.store,c).map(r=>r.data),[
  {when:'2026-10-12 12:00',meal:'none',item:'tofu',food:'Tofu',grams:200,kcal:230,protein_g:31.02,carbs_g:0,fat_g:11.26,assumed:true,source:'BLS 4.0 H861000'},
  {when:'2026-10-12 12:00',meal:'none',item:'rice',food:'White rice raw',grams:125,count:0.5,unit:'pack',kcal:438.75,protein_g:9.91,carbs_g:96.38,fat_g:0.78,assumed:false,source:'BLS 4.0 C352000'}]);
 // Her pack of rice is remembered: half a pack asks nothing now.
 at('2026-10-12T16:00:00Z');
 const again=await f.op({type:'food',action:'track',items:[HALF_PACK],on:'2026-10-11'});
 assert.equal(again.reply,'Tracked for 11 October: rice 125 g: 439 kcal, 10 g protein.');
});

test('the base\'s own way in ("track food" to tracker-hold) asks the same question; a bare yes asks about the amount again',async()=>{
 const f=await fixture();
 const empty=await f.op({type:'tracker-hold',name:'food'});
 assert.equal(empty.reply,SETUP);
 const held=await f.op({type:'food',action:'track',items:[TOFU,HALF_PACK]});
 const made=await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 assert.equal(made.reply,'Your food tracker is ready. How big was the pack of rice?');
 assert.equal(entries(f.store,food(f.store)).length,0);
 const answered=await f.op({type:'food',action:'answer',grams:250});
 assert.equal(answered.reply,'Tracked: tofu 200 g (assumed), rice 125 g: 669 kcal, 41 g protein.');
 await assert.rejects(f.op({type:'food',action:'answer',question:made.question_id,grams:250}),/expired/,'an answered question is not answered twice');
});

test('with a target: lunch, the usual lunch, a correction, a removal, and "what did I eat today?"',async()=>{
 const f=await fixture();
 const held=await f.op({type:'food',action:'track',items:[TOFU,HALF_PACK]});await f.op({type:'tracker-create',proposal_id:held.proposal_id,answers:[{grams:250}]});
 const set=await f.op({type:'food',action:'target',sex:'female',age:34,height_cm:168,weight_kg:70,activity:'light',goal:'lose'});
 assert.equal(set.reply,'Your daily target: 1,451 kcal, 105 g protein, 41 g fat and 165 g carbohydrates. Worked out from 70 kg, 168 cm, 34 years and lightly active, minus 500 kcal to lose weight. It adapts once a week to what you eat and weigh, by at most 150 kcal.');
 // Eggs 120 g: 162 kcal, 15.81 g; rye bread 50 g: 109 kcal, 3.69 g. Today 668.75 + 271 = 939.75 of 1,451; protein 40.93 + 19.5 of 105.
 let r=await f.op({type:'food',action:'track',meal:'lunch',items:[EGGS,RYE]});
 assert.equal(r.reply,'Tracked: eggs 120 g (assumed), rye bread 50 g (assumed): 271 kcal, 20 g protein. 511 kcal left today, 45 g protein to go.');
 r=await f.op({type:'food',action:'remember',name:'usual lunch'});
 assert.equal(r.reply,'Saved as your usual lunch: eggs 120 g (assumed), rye bread 50 g (assumed). From now on just say "track usual lunch".');
 at('2026-10-12T17:00:00Z');
 r=await f.op({type:'food',action:'track',preset:'usual lunch'});
 assert.equal(r.reply,'Tracked: eggs 120 g, rye bread 50 g: 271 kcal, 20 g protein. 240 kcal left today, 25 g protein to go.');
 const c=food(f.store),last=entries(f.store,c).at(-2);assert.deepEqual([last.data.meal,last.data.item,last.data.assumed],['lunch','eggs',false]);
 // "The eggs were three": 3 x 60 g = 180 g, 243 kcal, 23.72 g protein.
 r=await f.op({type:'food',action:'correct',item:'eggs',count:3});
 assert.equal(r.reply,'Changed: eggs on 12 October, now 180 g: 243 kcal, 24 g protein. 159 kcal left today, 17 g protein to go.');
 r=await f.op({type:'food',action:'correct',item:'rye bread',remove:true});
 assert.equal(r.reply,'Removed: rye bread of 12 October.');
 r=await f.op({type:'food',action:'today'});
 assert.equal(r.reply,'Today: tofu 200 g, rice 125 g, eggs 120 g, rye bread 50 g, eggs 180 g. Together 1,183 kcal, 84 g protein, 118 g carbohydrates and 40 g fat. Your target is 1,451 kcal and 105 g protein. 268 kcal left today, 21 g protein to go.');
 // The base's correction reaches the same operation.
 r=await f.op({type:'tracker-correct',tracker:c.id,remove:true});
 assert.match(r.reply,/^Removed: eggs of 12 October\.$/);
});

test('an unclear amount with a tracker asks once and remembers the answer',async()=>{
 const f=await fixture();
 const held=await f.op({type:'food',action:'track',items:[TOFU]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 const muesli={food:'C512300',item:'muesli',count:1,unit:'bowl'};
 const q=await f.op({type:'food',action:'track',meal:'breakfast',items:[muesli]});
 assert.equal(q.reply,"How big was the bowl of muesli? I've kept the meal until you tell me.");
 assert.equal((await f.op({type:'food',action:'status'})).questions[0].id,q.question_id);
 const a=await f.op({type:'food',action:'answer',grams:80});
 assert.match(a.reply,/^Tracked: muesli 80 g: 262 kcal, 7 g protein\.$/);
 const next=await f.op({type:'food',action:'track',items:[{...muesli,count:2}]});
 assert.match(next.reply,/^Tracked: muesli 160 g: 523 kcal/,'two bowls are 160 g, asked nothing');
});

test('stop showing calories; an eating disorder means totals only on request and no target; the floors hold',async()=>{
 const f=await fixture();
 const held=await f.op({type:'food',action:'track',items:[TOFU]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 let r=await f.op({type:'food',action:'settings',numbers:false});
 assert.match(r.reply,/^Done: no more calories or other numbers in my food replies\./);
 r=await f.op({type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:100}]});
 assert.equal(r.reply,'Tracked: tofu.');
 assert.equal((await f.op({type:'food',action:'today'})).reply,'Today: tofu, tofu.');
 assert.match((await f.op({type:'food',action:'today',totals:true})).reply,/^Today: tofu 200 g, tofu 100 g\. Together 345 kcal/,'totals when she asks for them');
 for(const [p,re] of [[{age:18},/under 19/],[{pregnant:true},/pregnancy/],[{breastfeeding:true},/pregnancy and breastfeeding/]]){
  r=await f.op({type:'food',action:'target',sex:'female',age:30,height_cm:165,weight_kg:60,activity:'light',goal:'keep',pregnant:false,breastfeeding:false,...p});
  assert.match(r.reply,re);assert.equal(food(f.store).tracker.food.target,null);
 }
 // A man of 70, 160 cm, 50 kg, sitting, losing: 500 + 1,000 - 350 + 5 = 1,155; x 1.2 = 1,386; - 500 = 886.
 r=await f.op({type:'food',action:'target',age:70,pregnant:false,breastfeeding:false,sex:'male',height_cm:160,weight_kg:50,activity:'sedentary',goal:'lose'});
 assert.match(r.reply,/^Your daily target: 1,500 kcal.* The formula gave 886 kcal, and I never set less than 1,500 kcal for men\./);
 r=await f.op({type:'food',action:'settings',eating_disorder:true});
 assert.equal(r.reply,'Understood. I will not set a target, and I will show totals only when you ask for them.');
 const c=food(f.store);assert.equal(c.tracker.food.target,null);assert.equal(c.tracker.talk,null);
 r=await f.op({type:'food',action:'target',sex:'female',age:30,height_cm:165,weight_kg:60,activity:'light',goal:'lose'});
 assert.equal(r.reply,'Understood. I will not set a target, and I will show totals only when you ask for them.');
});

test('the target asks once for what it does not know, with her weight from her health data',async()=>{
 const f=await fixture();
 const held=await f.op({type:'food',action:'track',items:[TOFU]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 f.store.save('health_observations',{metric:'weight_kg',value:70,unit:'kg',observed_on:'2026-10-10',observed_at:'2026-10-10T06:00:00Z'});
 let r=await f.op({type:'food',action:'target'});
 assert.match(r.reply,/^To set your daily target I need to know whether the formula should count you as female or male, your age, your height in cm, how active you are .* and whether you want to lose, keep or gain weight\. I have your weight from your health data: 70 kg\./);
 r=await f.op({type:'food',action:'target',sex:'female',age:34,height_cm:168,activity:'light',goal:'lose'});
 assert.match(r.reply,/^Your daily target: 1,451 kcal, 105 g protein/);
});

test('German in, German out: the setup question, the answer and the day',async()=>{
 const f=await fixture();
 const held=await f.op({type:'food',action:'track',language:'de',meal:'breakfast',items:[{food:'C133000',item:'Haferflocken',grams:60},{food:'M111200',item:'Milch',count:1,unit:'Glas'}]});
 assert.match(held.reply,/^Einen Ernährungs-Tracker starten\? .* Wie viele Gramm Milch sind es pro Glas\?$/);
 const made=await f.op({type:'tracker-create',proposal_id:held.proposal_id,answers:[{grams:200}]});
 // Oats 60 g: 348 x 0.6 = 208.8 kcal, 7.93 g; milk 200 g: 44 x 2 = 88 kcal, 6.98 g.
 assert.equal(made.reply,'Erfasst: Haferflocken 60 g, Milch 200 g: 297 kcal, 15 g Eiweiß. Sag "setz mein Ernährungsziel", wenn du ein Tagesziel möchtest.');
 assert.equal(food(f.store).name,'Essen');
 assert.match((await f.op({type:'food',action:'today'})).reply,/^Heute: Haferflocken 60 g, Milch 200 g\. Zusammen 297 kcal, 15 g Eiweiß/);
});

test('a barcode through a stand-in network, then the product is tracked like a food',async()=>{
 const f=await fixture();resetLimits();
 const held=await f.op({type:'food',action:'track',items:[TOFU]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 const calls=[];f.domains.foodFetcher=async(url,init)=>{calls.push({url:String(url),ua:init.headers['User-Agent']});return new Response(JSON.stringify({status:1,product:{code:'4008400401621',product_name:'Nutella',brands:'Ferrero',nutriments:{'energy-kcal_100g':539,proteins_100g:6.3,fat_100g:30.9,carbohydrates_100g:57.5}}}));};
 const found=await f.op({type:'food',action:'barcode',code:'4008400401621'});
 assert.equal(found.id,'off:4008400401621');assert.equal(calls[0].ua,'GodspeedMissionControl/2.0 (https://godspeedmissioncontrol.com)');
 const r=await f.op({type:'food',action:'track',items:[{food:'off:4008400401621',item:'Nutella',grams:20}]});
 assert.equal(r.reply,'Tracked: Nutella 20 g: 108 kcal, 1 g protein.');
 assert.equal(entries(f.store,food(f.store)).at(-1).data.source,'Open Food Facts 4008400401621');
 const s=await f.op({type:'food',action:'search',queries:['nutella','rye bread']});
 assert.equal(s.results[0].products[0].id,'off:4008400401621');assert.equal(s.results[0].before[0].id,'off:4008400401621');
 assert.ok(s.results[1].foods.some(x=>x.id==='B271000'));
});

test('a tracker-list for the weekly talk carries the days and the target\'s change in one line',async()=>{
 const f=await fixture('2026-10-01T10:00:00Z',{talks:['health']});
 const held=await f.op({type:'food',action:'track',items:[TOFU]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 assert.equal(food(f.store).tracker.talk,'health','with a health talk, the food tracker is its own by default');
 await f.op({type:'food',action:'target',sex:'female',age:34,height_cm:168,weight_kg:70,activity:'light',goal:'lose'});
 for(const d of ['2026-10-02','2026-10-03','2026-10-05','2026-10-06']){at(d+'T10:00:00Z');await f.op({type:'food',action:'track',items:[{food:'C352000',item:'rice',grams:300}]});}
 f.store.save('health_observations',{metric:'weight_kg',value:70,observed_on:'2026-09-24',observed_at:'2026-09-24T06:00:00Z'});
 f.store.save('health_observations',{metric:'weight_kg',value:69,observed_on:'2026-10-07',observed_at:'2026-10-07T06:00:00Z'});
 at('2026-10-08T10:00:00Z');
 const list=await f.op({type:'tracker-list',talk:'health',days:7});
 const t=list.trackers.find(x=>x.specialist==='food');
 assert.ok(t.food.change.startsWith('Your food target moved from 1,451 to '),t.food.change);
 assert.equal(t.food.days.length,4);
});

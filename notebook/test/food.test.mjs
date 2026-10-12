import test from 'node:test';import assert from 'node:assert/strict';
import {nutrients,resolveItems,portionsFrom,unitKey,targetFor,currentTarget,slope,setupQuestion,trackReply,questionText,targetQuestion,targetReply,noTargetReply,todayReply,adaptLine,foodSchema,FOOD_WORDS,mealOf,ageOn,fmt} from '../core/food.mjs';

// The food tracker's rules (D-321 step 5): the model reads the sentence, code does every number.
const TOFU={id:'H861000',de:'Tofu',en:'Tofu',kcal:115,protein:15.51,fat:5.63,carbs:0};
const RICE={id:'C352000',de:'Reis poliert, roh',en:'White rice raw',kcal:351,protein:7.931,fat:0.62,carbs:77.1};
const EGG={id:'E111100',de:'Hühnerei roh',en:'Chicken egg raw',kcal:135,protein:13.175,fat:9,carbs:0.34};
const lookup=id=>({H861000:TOFU,C352000:RICE,E111100:EGG})[id]||(()=>{throw Error('No food "'+id+'" in the food table')})();

test('grams arithmetic comes from the table per 100 g',()=>{
 assert.deepEqual(nutrients(TOFU,200),{kcal:230,protein_g:31.02,carbs_g:0,fat_g:11.26});
 assert.deepEqual(nutrients(RICE,125),{kcal:438.75,protein_g:9.91,carbs_g:96.38,fat_g:0.78});
 assert.deepEqual(nutrients({...TOFU,protein:null},100),{kcal:115,protein_g:0,carbs_g:0,fat_g:5.63},'an unknown value counts as 0');
});

test('amounts: said grams, a usual portion, an assumed typical weight, and an unclear amount',()=>{
 const none=()=>null;
 let r=resolveItems([{food:'H861000',item:'tofu',grams:200,assumed:true},{food:'C352000',item:'rice',count:0.5,unit:'pack'}],{lookup,portionOf:none});
 assert.deepEqual(r.resolved.map(i=>[i.item,i.grams,i.assumed]),[['tofu',200,true]]);
 assert.deepEqual(r.unclear,[{index:1,item:'rice',count:0.5,unit:'pack',food:'C352000'}]);
 // Her pack of rice is 250 g: half a pack is 125 g, not assumed.
 r=resolveItems([{food:'C352000',item:'rice',count:0.5,unit:'packs'}],{lookup,portionOf:(food,unit)=>food==='C352000'&&unit==='pack'?250:null});
 assert.deepEqual(r.resolved.map(i=>[i.grams,i.assumed,i.unit]),[[125,false,'pack']]);
 // Her usual portion wins over the model's guess; grams she said win over both.
 r=resolveItems([{food:'H861000',item:'tofu',grams:150,assumed:true},{food:'H861000',item:'tofu',grams:90}],{lookup,portionOf:()=>200});
 assert.deepEqual(r.resolved.map(i=>[i.grams,i.assumed]),[[200,false],[90,false]]);
 assert.throws(()=>resolveItems([{food:'XX',item:'x',grams:1}],{lookup,portionOf:none}),/food table/);
 assert.throws(()=>resolveItems([{food:'H861000',item:'tofu',grams:0}],{lookup,portionOf:none}),/grams/);
 assert.equal(unitKey('Slices'),'slice');assert.equal(unitKey('Scheiben'),'scheibe');assert.equal(unitKey('Packungen'),'packung');assert.equal(unitKey('glasses'),'glass');
});

test('her usual portion is read from her rows: the newest amount she gave, per piece or per container',()=>{
 const rows=[
  {created_at:'1',data:{source:'BLS 4.0 C352000',grams:100,count:0.5,unit:'pack',assumed:false}},
  {created_at:'2',data:{source:'BLS 4.0 C352000',grams:125,count:0.5,unit:'pack',assumed:false}},
  {created_at:'3',data:{source:'BLS 4.0 E111100',grams:120,count:2,unit:'egg',assumed:true}},
  {created_at:'4',data:{source:'BLS 4.0 H861000',grams:180,assumed:false}},
 ];
 const p=portionsFrom(rows);
 assert.equal(p('C352000','pack'),250);assert.equal(p('E111100','egg'),null,'an assumed amount is not her portion');assert.equal(p('H861000',''),180);
});

test('a worked target, checked by hand',()=>{
 // Female, 34, 168 cm, 70 kg, lightly active, wants to lose weight:
 // BMR = 10 x 70 + 6.25 x 168 - 5 x 34 - 161 = 700 + 1,050 - 170 - 161 = 1,419
 // x 1.375 = 1,951.125; - 500 = 1,451.125, so 1,451 kcal. Protein 1.5 x 70 = 105 g.
 // Fat at least 25%: 1,451 x 0.25 / 9 = 40.3, rounded up to 41 g (369 kcal).
 // Carbohydrates the rest: (1,451 - 420 - 369) / 4 = 165.5, rounded down to 165 g.
 const t=targetFor({sex:'female',age:34,height_cm:168,weight_kg:70,activity:'light',goal:'lose'});
 assert.deepEqual(t,{kcal:1451,protein_g:105,fat_g:41,carbs_g:165,bmr:1419,tdee:1951.13,delta:-500,floor:null,formula_kcal:1451});
 // A man, 40, 180 cm, 80 kg, moderately active, keeping: 800 + 1,125 - 200 + 5 = 1,730; x 1.55 = 2,681.5.
 const m=targetFor({sex:'male',age:40,height_cm:180,weight_kg:80,activity:'moderate',goal:'keep'});
 // Protein 1.2 x 80 = 96 g; fat ceil(2,682 x 0.25 / 9) = ceil(74.5) = 75 g; carbohydrates floor((2,682 - 384 - 675) / 4) = 405 g.
 assert.deepEqual([m.kcal,m.protein_g,m.fat_g,m.carbs_g],[2682,96,75,405]);
});

test('every floor holds: 1,200 kcal for women, 1,500 for men, no target under 19, pregnant, breastfeeding or with an eating disorder',()=>{
 // 45 kg, 150 cm, 60 years, sitting, losing: 450 + 937.5 - 300 - 161 = 926.5; x 1.2 = 1,111.8; - 500 = 611.8.
 const w=targetFor({sex:'female',age:60,height_cm:150,weight_kg:45,activity:'sedentary',goal:'lose'});
 assert.equal(w.kcal,1200);assert.equal(w.floor,1200);assert.equal(w.formula_kcal,612);
 const m=targetFor({sex:'male',age:70,height_cm:160,weight_kg:50,activity:'sedentary',goal:'lose'});
 assert.equal(m.kcal,1500);assert.equal(m.floor,1500);
 for(const [p,why] of [[{age:18},'under19'],[{pregnant:true},'pregnant'],[{breastfeeding:true},'breastfeeding'],[{eating_disorder:true},'eating_disorder']])
  assert.deepEqual(targetFor({sex:'female',age:30,height_cm:165,weight_kg:60,activity:'light',goal:'keep',...p}),{none:why});
 assert.deepEqual(targetFor({sex:'female',age:30}).missing,['height_cm','weight_kg','activity','goal']);
 assert.equal(ageOn({age:34,age_on:'2026-10-12'},'2027-10-12'),35);
});

test('the weekly adaptation moves at most 150 kcal, and not at all with too few days or one weight',()=>{
 const card={profile:{sex:'female',goal:'lose'},target:{set_on:'2026-10-01',kcal:1451,protein_g:105,fat_g:41,carbs_g:165}};
 const day=(d,kcal)=>({data:{when:d+' 12:00',kcal}});
 // 5 of the 7 days from 1 to 7 October tracked at 1,500 kcal; weight 70.0 on 24 Sep to 69.0 on 7 Oct.
 const rows=['2026-10-01','2026-10-02','2026-10-03','2026-10-05','2026-10-06'].map(d=>day(d,1500));
 const weights=[{day:'2026-09-24',kg:70},{day:'2026-10-07',kg:69}];
 // slope -1/13 kg a day; expenditure 1,500 + 7,700/13 = 2,092.3; aim 1,592.3: up 141, under 150.
 let t=currentTarget(card,rows,weights,'2026-10-08');
 assert.equal(t.kcal,1592);assert.equal(t.changes.length,1);
 assert.match(adaptLine('en',t.changes[0]),/^Your food target moved from 1,451 to 1,592 kcal on 8 October: in the week before you tracked 5 of 7 days at 1,500 kcal on average, and your weight trend fell 0\.5 kg a week, so you used about 2,092 kcal a day\.$/);
 // A faster loss asks for more than 150: capped at 150.
 t=currentTarget(card,rows,[{day:'2026-09-24',kg:72},{day:'2026-10-07',kg:69}],'2026-10-08');
 assert.equal(t.kcal,1601);
 // On 7 October the week is not over: nothing moves.
 assert.equal(currentTarget(card,rows,weights,'2026-10-07').kcal,1451);
 // 3 of 7 days: no change. One weight: no change.
 assert.equal(currentTarget(card,rows.slice(0,3),weights,'2026-10-08').kcal,1451);
 assert.equal(currentTarget(card,rows,[weights[1]],'2026-10-08').kcal,1451);
 // Down too: never under the floor.
 const low={...card,target:{...card.target,kcal:1250}};
 assert.equal(currentTarget(low,rows.map(r=>day(r.data.when.slice(0,10),900)),[{day:'2026-09-24',kg:69},{day:'2026-10-07',kg:70}],'2026-10-08').kcal,1200);
 assert.equal(slope([{day:'2026-10-01',kg:70},{day:'2026-10-02',kg:71},{day:'2026-10-03',kg:72}]),1);
});

test('the setup question says the numbers are estimates and that an eating disorder means no target',()=>{
 assert.equal(setupQuestion('en',{questions:'How big was the pack of rice?'}),'Start a food tracker? It works out calories and protein from a food table and can keep a daily target for you. The numbers are estimates from the table, and you can change every entry in your notebook. If you have or had an eating disorder, tell me, and I will show totals only when you ask and never set a target. How big was the pack of rice?');
 assert.match(setupQuestion('en',{kept:true}),/ I've kept this meal\.$/);
 assert.match(setupQuestion('de',{kept:true}),/^Einen Ernährungs-Tracker starten\? .*Essstörung.* Ich habe mir diese Mahlzeit gemerkt\.$/);
 assert.equal(questionText('en',[{item:'rice',unit:'pack',count:0.5}]),'How big was the pack of rice?');
 assert.equal(questionText('en',[{item:'tofu'}]),'How much tofu was it, in grams?');
 assert.equal(questionText('de',[{item:'Reis',unit:'Packung',count:0.5}]),'Wie viele Gramm Reis sind es pro Packung?');
 for(const text of [setupQuestion('en',{kept:true}),setupQuestion('de',{kept:true})])assert.doesNotMatch(text,/[–—]/);
});

test('replies: items, totals, what is left, assumed amounts, numbers off, German',()=>{
 const items=[{item:'eggs',grams:120,assumed:true,kcal:162,protein_g:15.81},{item:'rye bread',grams:50,assumed:true,kcal:109,protein_g:3.6}];
 assert.equal(trackReply('en',{items,numbers:true}),'Tracked: eggs 120 g (assumed), rye bread 50 g (assumed): 271 kcal, 19 g protein.');
 assert.equal(trackReply('en',{items,numbers:true,left:{kcal:1180,protein_g:86}}),'Tracked: eggs 120 g (assumed), rye bread 50 g (assumed): 271 kcal, 19 g protein. 1,180 kcal left today, 86 g protein to go.');
 assert.equal(trackReply('en',{items,numbers:true,left:{kcal:-120,protein_g:-3}}),'Tracked: eggs 120 g (assumed), rye bread 50 g (assumed): 271 kcal, 19 g protein. 120 kcal over today\'s target, protein target reached.');
 assert.equal(trackReply('en',{items,numbers:false,left:{kcal:1180,protein_g:86}}),'Tracked: eggs, rye bread.');
 assert.equal(trackReply('de',{items:[{item:'Eier',grams:120,assumed:true,kcal:162,protein_g:15.81}],numbers:true,left:{kcal:1180,protein_g:86}}),'Erfasst: Eier 120 g (geschätzt): 162 kcal, 16 g Eiweiß. Für heute bleiben 1.180 kcal, und 86 g Eiweiß fehlen noch.');
 assert.equal(todayReply('en',{items,numbers:true,totals:{kcal:271,protein_g:19.5,carbs_g:21.3,fat_g:11.3}}),'Today: eggs 120 g, rye bread 50 g. Together 271 kcal, 20 g protein, 21 g carbohydrates and 11 g fat.');
 assert.equal(todayReply('en',{items:[],numbers:true}),'Nothing tracked today yet.');
 assert.equal(todayReply('en',{items,numbers:false,totals:{kcal:271}}),'Today: eggs, rye bread.');
 assert.match(targetQuestion('en',{missing:['sex','age','height_cm','activity','goal'],weight:{kg:70}}),/^To set your daily target I need to know whether the formula should count you as female or male, your age, your height in cm, how active you are \(mostly sitting, lightly active, moderately active, very active or extremely active\) and whether you want to lose, keep or gain weight\. I have your weight from your health data: 70 kg\./);
 assert.equal(targetReply('en',{kcal:1451,protein_g:105,fat_g:41,carbs_g:165,delta:-500,floor:null},{weight_kg:70,height_cm:168,age:34,activity:'light'}),'Your daily target: 1,451 kcal, 105 g protein, 41 g fat and 165 g carbohydrates. Worked out from 70 kg, 168 cm, 34 years and lightly active, minus 500 kcal to lose weight. It adapts once a week to what you eat and weigh, by at most 150 kcal.');
 assert.match(noTargetReply('en','under19'),/under 19/);
 assert.equal(fmt('de',1451),'1.451');assert.equal(fmt('en',1451),'1,451');
});

test('the words: food, meals, and the columns',()=>{
 for(const s of ['food','lunch','Frühstück','my usual breakfast','Abendessen','snack'])assert.ok(FOOD_WORDS.test(s),s);
 for(const s of ['belly','period','walk to work'])assert.ok(!FOOD_WORDS.test(s),s);
 assert.equal(mealOf('track lunch, two eggs'),'lunch');assert.equal(mealOf('track Frühstück, Haferflocken'),'breakfast');assert.equal(mealOf('track food, tofu'),'none');
 assert.deepEqual(foodSchema().map(f=>f.key),['when','meal','item','food','grams','count','unit','kcal','protein_g','carbs_g','fat_g','assumed','source','note']);
});

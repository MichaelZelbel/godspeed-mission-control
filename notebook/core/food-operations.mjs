// The food tracker's operation (D-321 step 5): `food {action,...}`, one path for the notebook's chat, MCP
// and the Telegram bot, on the shared tracker base. The rules and every reply are in food.mjs, the
// table in food-table.mjs, packaged food in food-products.mjs; this file reads and writes. Nothing
// here sends anything to anyone, and no job runs: the weekly adaptation is worked out when read.
import path from 'node:path';
import {trackers,entries,proposalState,dayOf,whenFor,norm,HOLD_MS} from './trackers.mjs';
import {now as clockNow,localParts} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {readTable} from '../../third-party/addons/godspeed-coach/lib/auto.mjs';
import {loadSettings as coachSettings} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';
import {foodTable,foodById,searchFoods} from './food-table.mjs';
import {lookupBarcode,searchProducts,productById,cachedProducts} from './food-products.mjs';
import {MEALS,MEAL_SAID,lang,foodSchema,foodCard,resolveItems,portionsFrom,rowOf,totalsOf,nutrients,foodIdOf,sourceOf,unitKey,targetFor,currentTarget,weightsFrom,
 setupQuestion,questionText,trackReply,leftWords,targetHint,readyReply,edReply,todayReply,targetQuestion,targetReply,noTargetReply,adaptLine,dateWords,fmt,ACTIVITY,GOALS} from './food.mjs';

export const FOOD_ACTIONS=['status','search','track','answer','remember','correct','today','target','settings','talk','barcode','product'];
const NAMES=['Food','Essen','Ernährung','Meals','Mahlzeiten'];
const tz=store=>store.get('settings','installation')?.timezone||'UTC';
const stateOf=store=>store.state||path.join(store.root,'.godspeed');
// The hash the caller read, for query.execute's own check (as tracker-operations.mjs).
const expectedOf=(input,table,id)=>{const v=input.expected?.[table+'/'+id]??input.expected?.[id];return typeof v==='string'?{[id]:v}:{};};
const talkOf=value=>{if(value===undefined||value===null||value===''||value===false)return null;if(typeof value!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(value))throw Error('Name the coaching talk by its area, such as health, or none');return value;};
export const foodTracker=store=>trackers(store).find(c=>c.tracker.specialist==='food')||null;
export const TABLE_MISSING='The food table is not on this computer yet. It downloads by itself once, when the notebook starts with internet access, and works offline after that. Until then I can only track packaged food by its barcode.';
// A food by its id: the BLS code from a search, or "off:<barcode>" for a product looked up before.
export function foodLookup(store){
 const state=stateOf(store);let table;
 return id=>{
  if(String(id).startsWith('off:')){const p=productById(state,id);if(!p)throw Error('The product '+id.slice(4)+' was not looked up yet: look up its barcode first.');return {...p,en:p.name,de:p.name};}
  table??=foodTable(state);if(!table)throw Error(TABLE_MISSING);
  const f=foodById(table,id);if(!f)throw Error('No food "'+id+'" in the food table: search for it first and use the id the search gives.');return f;
 };
}
// A meal held for its one question is a food_questions record ({kind:"ask"}); her answer is another
// ({kind:"answer",question_id}). Both are only ever written once, so over MCP neither needs a hash; what
// became of a question is read from what was written after it (as the base's tracker proposals).
export function questionState(store,q,now=clockNow()){
 if(!q||q.removed_at||q.kind!=='ask')return 'missing';
 const all=store.list('food_questions');
 if(all.some(a=>a.kind==='answer'&&a.question_id===q.id))return 'answered';
 if(all.some(o=>o.kind==='ask'&&o.id!==q.id&&String(o.created_at)>String(q.created_at)))return 'dropped';
 if(!(now-Date.parse(q.created_at)<=HOLD_MS))return 'expired';
 return 'pending';
}
const pendingAsks=(store,now)=>store.list('food_questions').filter(q=>q.kind==='ask'&&questionState(store,q,now)==='pending');
const keptLine=l=>l==='de'?' Ich behalte die Mahlzeit, bis du es mir sagst.':" I've kept the meal until you tell me.";
// Her weights, for the target and its weekly adaptation: health observations and the coach's daily table.
function weightsOf(store,zone){
 let table={};try{const s=coachSettings(store.root);if(s.daily_table)table=readTable(path.isAbsolute(s.daily_table)?s.daily_table:path.join(store.root,s.daily_table));}catch{}
 return weightsFrom(store.list('health_observations'),table,at=>at?localParts(new Date(at),zone).date:null);
}
const latestWeight=(weights,today)=>{const w=weights.filter(x=>x.day<=today).at(-1);if(!w)return null;const age=(Date.parse(today)-Date.parse(w.day))/86400000;return age<=30?w:null;};
// The last meal: the rows of the newest row's time and meal that one operation wrote with it (written
// within seconds of it; a meal tracked later at the same minute is another meal).
function lastMeal(rows){
 const newest=[...rows].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).at(-1);if(!newest)return [];
 return rows.filter(r=>r.data?.when===newest.data?.when&&r.data?.meal===newest.data?.meal&&Math.abs(Date.parse(r.created_at)-Date.parse(newest.created_at))<=10000);
}
const presetKey=name=>{const n=norm(name).replace(/(?<!\p{L})(?:my|usual|the|übliche[snrm]?|mein[e]?|wie immer|as always)(?!\p{L})/giu,' ').replace(/\s+/g,' ').trim();for(const m of ['breakfast','lunch','dinner','snack'])if(n===m||norm(MEAL_SAID.de[m])===n)return m;return n;};
const presetSaid=(l,key)=>MEAL_SAID[l][key]||key;

export function foodOperation(domains,input){
 const {store,query}=domains,now=clockNow(),zone=tz(store),today=dayOf(now,zone),action=input.action||'track';
 if(!FOOD_ACTIONS.includes(action))throw Error('A food action is one of: '+FOOD_ACTIONS.join(', '));
 const c=foodTracker(store),card=foodCard(c?.tracker),l=lang(input.language||c?.tracker.language),lookup=foodLookup(store);
 const rows=()=>c?entries(store,c):[];
 const none=l==='de'?'Du hast noch keinen Ernährungs-Tracker. Sag "track" und was du gegessen hast, dann frage ich, ob ich einen anlegen soll.':'You have no food tracker yet. Say "track" and what you ate, and I will ask whether to start one.';
 // Returns the tracker as saved, with its new hash, so a caller can make its next change with it.
 const setCard=(food={},extra={})=>{query.execute({table:'collections',operation:'update',values:{tracker:{...c.tracker,...extra,food:{...(c.tracker.food||{}),...food}}},filters:[['eq','id',c.id]],expected:expectedOf(input,'collections',c.id)});return store.get('collections',c.id);};
 const weights=()=>weightsOf(store,zone);
 const target=all=>card.target?currentTarget(card,all,weights(),today):null;
 const leftFor=(all,day)=>{if(day!==today||!card.numbers)return null;const t=target(all);if(!t)return null;const done=totalsOf(all.filter(r=>String(r.data?.when).slice(0,10)===today));return {kcal:t.kcal-done.kcal,protein_g:t.protein_g-done.protein_g};};
 // A meal's rows keep the order she named them in: each is one millisecond after the one before.
 const insertRows=(tracker,items,when,meal)=>{const base=Date.now();return items.map((it,i)=>query.execute({table:'collection_items',operation:'insert',values:{collection_id:tracker.id,data:rowOf(it,{when,meal}),created_at:new Date(base+i).toISOString()}}).data[0]);};

 if(action==='search'){
  // Read only: the table's foods for each phrase, the foods she tracked before under those words, and
  // products looked up before. The model chooses among them; code does the numbers.
  const table=foodTable(stateOf(store)),queries=[].concat(input.queries??input.query??[]).map(String).filter(q=>q.trim()).slice(0,10);
  if(!queries.length)throw Error('Say what to look for');
  const mine=rows();
  return {table:table?'BLS 4.0':null,...(table?{}:{note:TABLE_MISSING}),results:queries.map(q=>{
   const words=norm(q).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3);
   const before=[...new Map(mine.filter(r=>words.some(w=>norm(r.data?.item).includes(w)||norm(r.data?.food).includes(w))).reverse().map(r=>[foodIdOf(r.data?.source),{id:foodIdOf(r.data?.source),name:r.data?.food,item:r.data?.item}])).values()].filter(x=>x.id).slice(0,5);
   return {query:q,before,foods:searchFoods(table,q,{limit:Math.min(20,Number(input.limit)||12)}),products:cachedProducts(stateOf(store),q).slice(0,5)};
  })};
 }
 if(action==='barcode')return lookupBarcode(stateOf(store),input.code,{fetcher:domains.foodFetcher}).then(product=>({product,id:product.id}));
 if(action==='product')return searchProducts(stateOf(store),input.query,{fetcher:domains.foodFetcher}).then(products=>({products}));

 if(action==='status'){
  // What the chat and the bot need to act: the tracker with its hash, today's rows and the last meal
  // with theirs, the target as it stands, presets, open questions, whether the table is here. Read only.
  const proposals=store.list('tracker_proposals').filter(p=>p.specialist==='food'&&proposalState(store,p,now)==='pending').map(p=>({id:p.id,question:setupQuestion(lang(p.language),{questions:questionText(lang(p.language),p.unclear||[]),kept:!!p.meal?.items?.length})}));
  const table=!!foodTable(stateOf(store)),weight=latestWeight(weights(),today);
  if(!c)return {tracker:null,proposals,table,weight};
  const all=rows(),t=target(all),todays=all.filter(r=>String(r.data?.when).slice(0,10)===today),brief=r=>({id:r.id,hash:r._hash,when:r.data?.when,meal:r.data?.meal,item:r.data?.item,food:r.data?.food,grams:r.data?.grams,count:r.data?.count,unit:r.data?.unit,assumed:r.data?.assumed===true});
  return {tracker:{id:c.id,hash:c._hash,name:c.name,language:c.tracker.language||'en',talk:c.tracker.talk||null,numbers:card.numbers,eating_disorder:card.eating_disorder,pregnant:card.pregnant,breastfeeding:card.breastfeeding},
   target:t?{kcal:t.kcal,protein_g:t.protein_g,fat_g:t.fat_g,carbs_g:t.carbs_g,set_on:card.target.set_on,change:t.changes.at(-1)?adaptLine(l,t.changes.at(-1)):null}:null,profile:card.profile,
   today:{rows:todays.map(brief),totals:totalsOf(todays)},last_meal:lastMeal(all).map(brief),
   presets:Object.entries(card.presets).map(([name,p])=>({name,items:p.items.map(i=>({item:i.item,grams:i.grams}))})),
   questions:pendingAsks(store,now).map(q=>({id:q.id,question:questionText(lang(q.language),q.unclear)})),proposals,table,weight};
 }

 if(action==='track'){
  const when=whenFor({on:input.on,at:input.at,cadence:'any'},now,zone),meal=MEALS.includes(input.meal)?input.meal:'none';
  let items=input.items;
  if(input.preset){
   if(!c)return {language:l,reply:none};
   const key=presetKey(input.preset),preset=card.presets[key];
   if(!preset)throw Error(l==='de'?'Es gibt kein gespeichertes "'+presetSaid(l,key)+'". Sag nach einer Mahlzeit "merk dir das als mein übliches '+presetSaid(l,key)+'".':'There is no saved "usual '+presetSaid(l,key)+'" yet. After a meal, say "remember this as my usual '+presetSaid(l,key)+'".');
   // A preset's amounts are hers: she saw them when she saved it.
   items=preset.items.map(i=>({food:i.food,item:i.item,grams:i.grams,...(i.count?{count:i.count}:{}),...(i.unit?{unit:i.unit}:{})}));
  }
  if(items!==undefined&&!Array.isArray(items))throw Error('Give the items as a list');
  items=items||[];
  const mealFor=input.preset&&meal==='none'&&MEALS.includes(presetKey(input.preset))?presetKey(input.preset):meal;
  if(!c){
   // No tracker yet: the meal is held and the setup question asked once, with the question about an
   // unclear amount (the base's hold). Nothing is created.
   const {unclear}=items.length?resolveItems(items,{lookup,portionOf:()=>null}):{unclear:[]};
   const replaces=store.list('tracker_proposals').filter(o=>o.specialist==='food'&&proposalState(store,o,now)==='pending').map(o=>o.id);
   const p=store.save('tracker_proposals',{name:l==='de'?'Essen':'Food',cadence:'any',field_schema:foodSchema(),talk:'health',specialist:'food',language:l,meal:items.length?{when,meal:mealFor,items}:null,unclear,replaces,created_at:now.toISOString()});
   return {proposal_id:p.id,language:l,reply:setupQuestion(l,{questions:questionText(l,unclear),kept:items.length>0})};
  }
  if(!items.length)throw Error(l==='de'?'Sag, was du gegessen hast.':'Say what you ate.');
  const all=rows(),{resolved,unclear}=resolveItems(items,{lookup,portionOf:portionsFrom(all)});
  if(unclear.length){
   const q=store.save('food_questions',{kind:'ask',tracker:c.id,meal:{when,meal:mealFor,items},unclear,language:l,created_at:now.toISOString()});
   return {question_id:q.id,language:l,reply:questionText(l,unclear)+keptLine(l)};
  }
  const made=insertRows(c,resolved,when,mealFor);
  return {collection_id:c.id,entry_ids:made.map(r=>r.id),language:l,reply:trackReply(l,{items:resolved,numbers:card.numbers,left:leftFor([...all,...made],when.slice(0,10)),day:when.slice(0,10),today})};
 }

 if(action==='answer'){
  if(!c)return {language:l,reply:none};
  const q=input.question?store.get('food_questions',String(input.question)):pendingAsks(store,now).at(-1);
  if(!q||questionState(store,q,now)!=='pending')throw Error(l==='de'?'Diese Frage ist abgelaufen. Sag die Mahlzeit noch einmal, dann frage ich neu.':'That question has expired. Say the meal again and I will ask once more.');
  const ql=lang(input.language||q.language),answers=[].concat(input.answers??(input.grams!==undefined?[{grams:input.grams}]:[]));
  if(answers.length<q.unclear.length)throw Error(ql==='de'?'Sag die Gramm für jede Frage.':'Say the grams for each question.');
  const items=q.meal.items.map((it,i)=>{const n=q.unclear.findIndex(u=>u.index===i);if(n<0)return it;const g=Number(answers[n]?.grams);if(!(g>0&&g<=5000))throw Error('An amount is a number of grams above 0, at most 5000');const u=q.unclear[n];return {...it,grams:u.unit?Math.round((u.count||1)*g*100)/100:g,assumed:false};});
  const all=rows(),{resolved}=resolveItems(items,{lookup,portionOf:portionsFrom(all)});
  store.save('food_questions',{kind:'answer',question_id:q.id,created_at:now.toISOString()});
  const made=insertRows(c,resolved,q.meal.when,q.meal.meal);
  return {collection_id:c.id,entry_ids:made.map(r=>r.id),language:ql,reply:trackReply(ql,{items:resolved,numbers:card.numbers,left:leftFor([...all,...made],q.meal.when.slice(0,10)),day:q.meal.when.slice(0,10),today})};
 }
 if(!c)return {language:l,reply:none};

 if(action==='today'){
  const day=input.on?whenFor({on:input.on,cadence:'daily'},now,zone):today,all=rows(),mine=all.filter(r=>String(r.data?.when).slice(0,10)===day).map(r=>({...r.data,id:r.id}));
  const numbers=card.numbers||input.totals===true,t=day===today?target(all):null;
  return {language:l,totals:numbers?totalsOf(mine):undefined,reply:todayReply(l,{items:mine,numbers,totals:totalsOf(mine),target:t&&card.numbers?t:null,left:t&&card.numbers?leftFor(all,day):null,day,today})};
 }
 if(action==='remember'){
  const key=presetKey(input.name||'');if(!key)throw Error(l==='de'?'Sag, unter welchem Namen ich die Mahlzeit merken soll.':'Say what to call it, like "my usual lunch".');
  const meal=lastMeal(rows());if(!meal.length)throw Error(l==='de'?'Es gibt noch keine Mahlzeit zum Merken.':'There is no meal to remember yet.');
  const items=meal.map(r=>({food:foodIdOf(r.data.source),item:r.data.item,grams:r.data.grams,...(r.data.count?{count:r.data.count}:{}),...(r.data.unit?{unit:r.data.unit}:{}),assumed:r.data.assumed===true}));
  const updated=setCard({presets:{...card.presets,[key]:{items:items.map(({assumed,...i})=>i),saved_at:now.toISOString()}}});
  const said=presetSaid(l,key),shown=items.map(i=>i.item+' '+fmt(l,i.grams)+' g'+(i.assumed?(l==='de'?' (geschätzt)':' (assumed)'):'')).join(', ');
  return {language:l,preset:key,tracker_hash:updated._hash,reply:l==='de'?'Gemerkt als dein übliches '+said+': '+shown+'. Ab jetzt sag einfach "track '+said+' wie immer".':'Saved as your usual '+said+': '+shown+'. From now on just say "track usual '+said+'".'};
 }
 if(action==='correct'){
  const all=rows(),words=norm(input.item||'').split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3);
  const stem=w=>w.replace(/(?:es|s|en|er|e|n)$/u,'');
  const matches=r=>words.some(w=>[r.data?.item,r.data?.food].some(x=>norm(x).split(/[^\p{L}\p{N}]+/u).some(y=>y&&(y===w||stem(y)===stem(w)||y.startsWith(stem(w))&&stem(w).length>=3))));
  const byNewest=[...all].sort((a,b)=>String(a.data?.when).localeCompare(String(b.data?.when))||String(a.created_at).localeCompare(String(b.created_at)));
  const row=input.entry_id?all.find(r=>r.id===input.entry_id):words.length?byNewest.filter(matches).at(-1):byNewest.at(-1);
  if(!row)throw Error(input.entry_id?'That entry is not in your food tracker':l==='de'?'Ich finde "'+input.item+'" nicht unter deinen Einträgen.':'I cannot find "'+input.item+'" among your entries.');
  const day=String(row.data.when).slice(0,10),expected=expectedOf(input,'collection_items',row.id);
  if(input.remove===true){
   query.execute({table:'collection_items',operation:'delete',filters:[['eq','id',row.id]],expected});
   return {collection_id:c.id,entry_id:row.id,removed:true,language:l,reply:l==='de'?'Entfernt: '+row.data.item+' vom '+dateWords(l,day)+'.':'Removed: '+row.data.item+' of '+dateWords(l,day)+'.'};
  }
  const oldGrams=Number(row.data.grams);let grams=oldGrams,count=row.data.count,assumed=row.data.assumed===true;
  if(input.grams!==undefined&&input.grams!==null&&input.grams!==''){grams=Number(input.grams);assumed=false;}
  else if(input.count!==undefined&&input.count!==null){const n=Number(input.count);if(!(n>0&&n<=50))throw Error('A count is a number above 0, at most 50');const per=Number(row.data.count)>0?oldGrams/Number(row.data.count):null;if(!per)throw Error(l==='de'?'Sag mir das Gewicht in Gramm.':'Say the weight in grams.');grams=Math.round(n*per*100)/100;count=n;}
  if(!(grams>0&&grams<=5000))throw Error('An amount is a number of grams above 0, at most 5000');
  let food=null;try{food=lookup(input.food||foodIdOf(row.data.source));}catch(error){if(input.food)throw error;}
  // A product whose cached values are gone keeps its own numbers, scaled to the new amount.
  const values=food?nutrients(food,grams):Object.fromEntries(['kcal','protein_g','carbs_g','fat_g'].map(k=>[k,Math.round((Number(row.data[k])||0)*grams/oldGrams*100)/100]));
  const data={...row.data,grams,...(count?{count}:{}),assumed,...values,...(food&&input.food?{food:food.en,source:sourceOf(food)}:{})};
  const entry=query.execute({table:'collection_items',operation:'update',values:{data},filters:[['eq','id',row.id]],expected}).data[0];
  const after=rows(),left=leftFor(after,day);
  const said=card.numbers?(l==='de'?', jetzt '+fmt(l,grams)+' g: '+fmt(l,values.kcal)+' kcal, '+fmt(l,values.protein_g)+' g Eiweiß.':', now '+fmt(l,grams)+' g: '+fmt(l,values.kcal)+' kcal, '+fmt(l,values.protein_g)+' g protein.'):'.';
  return {collection_id:c.id,entry_id:entry.id,removed:false,language:l,reply:(l==='de'?'Geändert: '+row.data.item+' vom '+dateWords(l,day):'Changed: '+row.data.item+' on '+dateWords(l,day))+said+leftWords(l,left)};
 }
 if(action==='target'){
  if(input.off===true){setCard({target:null});return {language:l,reply:l==='de'?'Erledigt: kein Tagesziel mehr. Ich erfasse weiter, was du isst.':'Done: no daily target any more. I keep tracking what you eat.'};}
  const profile={...card.profile};
  if(input.sex!==undefined){if(!['female','male'].includes(input.sex))throw Error('The formula counts female or male');profile.sex=input.sex;}
  if(input.age!==undefined){const a=Number(input.age);if(!Number.isInteger(a)||a<1||a>120)throw Error('Age is a whole number of years');profile.age=a;profile.age_on=today;}
  if(input.height_cm!==undefined){const h=Number(input.height_cm);if(!(h>=100&&h<=250))throw Error('Height is in cm, from 100 to 250');profile.height_cm=h;}
  if(input.weight_kg!==undefined){const w=Number(input.weight_kg);if(!(w>=30&&w<=300))throw Error('Weight is in kg, from 30 to 300');profile.weight_kg=w;profile.weight_from='said';}
  if(input.activity!==undefined){if(!ACTIVITY[input.activity])throw Error('Activity is one of: '+Object.keys(ACTIVITY).join(', '));profile.activity=input.activity;}
  if(input.goal!==undefined){if(!(input.goal in GOALS))throw Error('The goal is lose, keep or gain');profile.goal=input.goal;}
  const flags=Object.fromEntries(['pregnant','breastfeeding','eating_disorder'].filter(k=>typeof input[k]==='boolean').map(k=>[k,input[k]]));
  const health=latestWeight(weights(),today);
  // Her weight from her health data when she did not say one (the design: "taken from her health data when present").
  if(health&&profile.weight_from!=='said'){profile.weight_kg=health.kg;profile.weight_from='health';}
  const state={...card,...flags},t=targetFor({...profile,pregnant:state.pregnant,breastfeeding:state.breastfeeding,eating_disorder:state.eating_disorder},today);
  if(t.none){const updated=setCard({profile,...flags,target:null,...(t.none==='eating_disorder'?{numbers:false}:{})},t.none==='eating_disorder'?{talk:null}:{});return {language:l,target:null,why:t.none,tracker_hash:updated._hash,reply:noTargetReply(l,t.none)};}
  if(t.missing){const updated=setCard({profile,...flags});return {language:l,target:null,missing:t.missing,tracker_hash:updated._hash,reply:targetQuestion(l,{missing:t.missing,weight:t.missing.includes('weight_kg')?null:profile.weight_from==='health'?{kg:profile.weight_kg}:null})};}
  const updated=setCard({profile,...flags,target:{set_on:today,kcal:t.kcal,protein_g:t.protein_g,fat_g:t.fat_g,carbs_g:t.carbs_g,formula_kcal:t.formula_kcal,floor:t.floor}});
  return {language:l,target:{kcal:t.kcal,protein_g:t.protein_g,fat_g:t.fat_g,carbs_g:t.carbs_g},tracker_hash:updated._hash,reply:targetReply(l,t,{...profile,age:Math.round(profile.age)})};
 }
 if(action==='settings'){
  const change={};for(const k of ['numbers','eating_disorder','pregnant','breastfeeding'])if(typeof input[k]==='boolean')change[k]=input[k];
  if(!Object.keys(change).length)throw Error('Say what to change: the numbers in replies, or whether you are pregnant, breastfeeding or have or had an eating disorder');
  if(change.eating_disorder===true){const updated=setCard({...change,numbers:false,target:null},{talk:null});return {language:l,tracker_hash:updated._hash,reply:edReply(l)};}
  if((change.pregnant||change.breastfeeding)){const updated=setCard({...change,target:null});return {language:l,tracker_hash:updated._hash,reply:noTargetReply(l,'pregnant')};}
  const updated=setCard(change);
  const reply=change.numbers===false?(l==='de'?'Erledigt: keine Kalorien und andere Zahlen mehr in meinen Antworten zum Essen. Frag "wie viele Kalorien heute?", wenn du die Summen willst.':'Done: no more calories or other numbers in my food replies. Ask "how many calories today?" when you want the totals.')
   :change.numbers===true?(card.eating_disorder?edReply(l):(l==='de'?'Erledigt: Meine Antworten zum Essen zeigen wieder Kalorien und Eiweiß.':'Done: my food replies show calories and protein again.'))
   :(l==='de'?'Erledigt.':'Done.');
  return {language:l,tracker_hash:updated._hash,reply};
 }
 if(action==='talk'){
  const talk=talkOf(input.talk),updated=setCard({},{talk});
  return {language:l,talk,tracker_hash:updated._hash,reply:talk?(l==='de'?'Erledigt: Dein Gespräch "'+talk+'" darf jetzt deinen Ernährungs-Tracker lesen.':'Done: your '+talk.replaceAll('-',' ')+' talk may now read your food tracker.'):(l==='de'?'Erledigt: Kein Gespräch liest deinen Ernährungs-Tracker.':'Done: no talk reads your food tracker.')};
 }
 throw Error('Unsupported food action: '+action);
}

// The yes to the setup question (tracker-create with a food question). With the amounts she gave in the
// same message ("250 g, and yes"), the held meal is tracked at once; without them it is asked again.
export function foodCreate(domains,p,input={}){
 const {store,query}=domains,now=clockNow(),zone=tz(store),today=dayOf(now,zone),l=lang(input.language||p.language);
 if(foodTracker(store))throw Error(l==='de'?'Du hast schon einen Ernährungs-Tracker.':'You already have a food tracker.');
 const ed=input.eating_disorder===true,name=p.name||(l==='de'?'Essen':'Food');
 const collection=query.execute({table:'collections',operation:'insert',values:{name,icon:'🍽️',description:l==='de'?'Ernährungs-Tracker':'Food tracker',visibility:'personal',field_schema:foodSchema(),tracker:{names:[...new Set([name,...NAMES])],cadence:'any',talk:ed?null:p.talk??'health',specialist:'food',language:l,proposal_id:p.id,food:{numbers:!ed,eating_disorder:ed}}}}).data[0];
 const tail=ed?' '+edReply(l):targetHint(l);
 if(!p.meal?.items?.length)return {collection_id:collection.id,language:l,reply:ed?edReply(l):readyReply(l)};
 const unclear=p.unclear||[],answers=[].concat(input.answers??(input.grams!==undefined?[{grams:input.grams}]:[]));
 const lookup=foodLookup(store);
 if(unclear.length&&answers.length<unclear.length){
  const q=store.save('food_questions',{kind:'ask',tracker:collection.id,meal:p.meal,unclear,language:l,created_at:now.toISOString()});
  return {collection_id:collection.id,question_id:q.id,language:l,reply:(l==='de'?'Dein Ernährungs-Tracker ist bereit. ':'Your food tracker is ready. ')+questionText(l,unclear)};
 }
 const items=p.meal.items.map((it,i)=>{const n=unclear.findIndex(u=>u.index===i);if(n<0)return it;const g=Number(answers[n]?.grams);if(!(g>0&&g<=5000))throw Error('An amount is a number of grams above 0, at most 5000');const u=unclear[n];return {...it,grams:u.unit?Math.round((u.count||1)*g*100)/100:g,assumed:false};});
 const {resolved}=resolveItems(items,{lookup,portionOf:()=>null});
 const base=Date.now(),made=resolved.map((it,i)=>query.execute({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:rowOf(it,{when:p.meal.when,meal:p.meal.meal}),created_at:new Date(base+i).toISOString()}}).data[0]);
 const day=p.meal.when.slice(0,10);
 return {collection_id:collection.id,entry_ids:made.map(r=>r.id),language:l,reply:trackReply(l,{items:resolved,numbers:!ed,day,today})+tail};
}
// What tracker-list gives the weekly talk about the food tracker: the days' totals and the target's
// last change, in one line (decision 6 of the design).
export function foodSummary(domains,c,{from,today}){
 const {store}=domains,zone=tz(store),card=foodCard(c.tracker),all=entries(store,c),days={};
 for(const r of all){const d=String(r.data?.when).slice(0,10);if(from&&d<from)continue;(days[d]||=[]).push(r);}
 const t=card.target?currentTarget(card,all,weightsOf(store,zone),today):null,l=lang(c.tracker.language);
 return {numbers:card.numbers,days:Object.entries(days).sort().map(([day,rs])=>({day,...(card.numbers?totalsOf(rs):{}),items:rs.length})),target:t&&card.numbers?{kcal:t.kcal,protein_g:t.protein_g}:null,change:t?.changes.at(-1)&&card.numbers?adaptLine(l,t.changes.at(-1)):null};
}

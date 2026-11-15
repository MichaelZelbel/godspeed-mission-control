import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {chatContext} from '../core/chat-context.mjs';
import {trackers,entries} from '../core/trackers.mjs';
import {resetLimits} from '../core/food-products.mjs';
import {withTable} from './food-fixture.mjs';

// The food tracker in the notebook's own chat (D-321 step 5), with a stand-in model: the model is given
// the table's candidates with their ids, the checks are the notebook's own, and the answer is the
// server's line, every number from code.
async function fixture(now='2026-10-12T10:00:00Z'){
 process.env.GODSPEED_NOW=now;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-food-chat-')),store=new Store(root),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});await withTable(root);
 return {root,store,query,domains,op:input=>domains.invoke('personal-operation',input)};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});
let n=0;
function say(domains,message,ops,{reply='Okay!',language='en'}={}){
 const calls=[];domains.provider=async input=>{calls.push(input.kind);if(input.kind==='reply-language')return {lines:input.input.lines};return {reply,language,operations:ops.map(o=>({source_quote:message,...o}))};};
 return domains.invoke('conversation-chat',{message,conversation_id:'c1',request_id:'r'+(++n)}).then(r=>({...r,calls}));
}
const food=store=>trackers(store).find(c=>c.tracker.specialist==='food');
const refused=async(domains,message,ops)=>{await assert.rejects(say(domains,message,ops),/explicit request|you said|you named|one you|yourself|Say |barcode up by itself/);};

test('setup, the answer with yes, the target, lunch and the day answer with the server\'s lines',async()=>{
 const f=await fixture();
 const context=chatContext(f.query,{message:'track food, tofu with half a pack of rice',conversation_id:'c1'});
 const tofu=context.personal.food.candidates.find(c=>c.query==='tofu');
 assert.equal(tofu.foods[0].id,'H861000','the model is given the table\'s tofu with its id');
 assert.ok(context.personal.food.candidates.find(c=>c.query==='rice').foods.some(x=>x.id==='C352000'));
 let r=await say(f.domains,'track food, tofu with half a pack of rice',[{type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:200,assumed:true},{food:'C352000',item:'rice',count:0.5,unit:'pack'}]}],{reply:'Tracked, about 640 kcal!'});
 assert.match(r.reply,/^Start a food tracker\? .* How big was the pack of rice\?$/);
 assert.equal(food(f.store),undefined);
 const id=chatContext(f.query,{message:'250 g, and yes',conversation_id:'c1'}).personal.food.proposals[0].id;
 r=await say(f.domains,'250 g, and yes',[{type:'tracker-create',proposal_id:id,answers:[{grams:250}]}]);
 assert.equal(r.reply,'Tracked: tofu 200 g (assumed), rice 125 g: 669 kcal, 41 g protein. Say "set my food target" when you want a daily target.');
 r=await say(f.domains,'set my food target: I am a woman, 34, 168 cm, 70 kg, lightly active, and I want to lose weight',[{type:'food',action:'target',sex:'female',age:34,height_cm:168,weight_kg:70,activity:'light',goal:'lose'}]);
 assert.match(r.reply,/^Your daily target: 1,451 kcal, 105 g protein, 41 g fat and 165 g carbohydrates\./);
 const lunch=chatContext(f.query,{message:'track lunch, two eggs and a slice of rye bread',conversation_id:'c1'}).personal.food.candidates;
 assert.ok(lunch.find(c=>c.query==='eggs').foods.some(x=>x.id==='E111100'));assert.ok(lunch.find(c=>c.query==='rye bread').foods.some(x=>x.id==='B271000'));
 r=await say(f.domains,'track lunch, two eggs and a slice of rye bread',[{type:'food',action:'track',meal:'lunch',items:[{food:'E111100',item:'eggs',count:2,unit:'egg',grams:120,assumed:true},{food:'B271000',item:'rye bread',count:1,unit:'slice',grams:50,assumed:true}]}],{reply:'Yum, 300 kcal.'});
 assert.equal(r.reply,'Tracked: eggs 120 g (assumed), rye bread 50 g (assumed): 271 kcal, 20 g protein. 511 kcal left today, 45 g protein to go.');
 r=await say(f.domains,'what did I eat today?',[{type:'food',action:'today'}],{reply:'Lots of things!'});
 assert.match(r.reply,/^Today: tofu 200 g, rice 125 g, eggs 120 g, rye bread 50 g\. Together 940 kcal/);
});

test('German in, German out, without a second call',async()=>{
 const f=await fixture();
 const held=await say(f.domains,'track Frühstück, 60 g Haferflocken',[{type:'food',action:'track',meal:'breakfast',items:[{food:'C133000',item:'Haferflocken',grams:60}]}],{language:'de'});
 assert.match(held.reply,/^Einen Ernährungs-Tracker starten\? .* Ich habe mir diese Mahlzeit gemerkt\.$/);
 const id=chatContext(f.query,{message:'ja',conversation_id:'c1'}).personal.food.proposals[0].id;
 const r=await say(f.domains,'ja',[{type:'tracker-create',proposal_id:id}],{language:'de'});
 assert.equal(r.reply,'Erfasst: Haferflocken 60 g: 209 kcal, 8 g Eiweiß. Sag "setz mein Ernährungsziel", wenn du ein Tagesziel möchtest.');
 assert.ok(!r.calls.includes('reply-language'),'written in German by code, no rewrite');
});

test('refusals: a food she did not name, grams she did not say, an age she did not give, a quoted or refused "track"',async()=>{
 const f=await fixture();
 const held=await f.op({type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:200}]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 await refused(f.domains,'track lunch, two eggs',[{type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:200,assumed:true}]}]);
 await refused(f.domains,'track lunch, tofu',[{type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:250}]}]);
 await refused(f.domains,'set my food target, I am a woman',[{type:'food',action:'target',sex:'female',age:34}]);
 await refused(f.domains,'if I said track food, tofu, what would happen?',[{type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:200,assumed:true}]}]);
 await refused(f.domains,"don't track my lunch",[{type:'food',action:'track',meal:'lunch',items:[{food:'H861000',item:'tofu',grams:200,assumed:true}]}]);
 await refused(f.domains,'show me my lunch',[{type:'food',action:'settings',numbers:false}]);
 await refused(f.domains,'track food 4008400401621',[{type:'food',action:'barcode',code:'4008400401621'}]);
 assert.equal(entries(f.store,food(f.store)).length,1,'nothing was written');
});

test('stop showing calories, and a barcode in the message is looked up before the model answers',async()=>{
 const f=await fixture();resetLimits();
 const held=await f.op({type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:200}]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});
 let r=await say(f.domains,'stop showing calories',[{type:'food',action:'settings',numbers:false}]);
 assert.match(r.reply,/^Done: no more calories or other numbers in my food replies\./);
 const calls=[];f.domains.foodFetcher=async(url,init)=>{calls.push({url:String(url),ua:init.headers['User-Agent']});return new Response(JSON.stringify({status:1,product:{code:'4008400401621',product_name:'Nutella',brands:'Ferrero',nutriments:{'energy-kcal_100g':539,proteins_100g:6.3,fat_100g:30.9,carbohydrates_100g:57.5}}}));};
 let seen=null;f.domains.provider=async input=>{if(input.kind!=='conversation-chat')return {lines:[]};seen=input.context.personal.food;return {reply:'ok',language:'en',operations:[{type:'food',action:'track',source_quote:'track 20 g of 4008400401621',items:[{food:'off:4008400401621',item:'Nutella',grams:20}]}]};};
 r=await f.domains.invoke('conversation-chat',{message:'track 20 g of 4008400401621',conversation_id:'c1',request_id:'bar'});
 assert.equal(calls.length,1);assert.equal(calls[0].ua,'GodspeedMissionControl/2.0 (https://godspeedmissioncontrol.com)');
 assert.ok(seen.candidates.some(c=>c.products.some(p=>p.id==='off:4008400401621')),'the model was given the product');
 assert.equal(r.reply,'Tracked: Nutella.','numbers stay off');
});

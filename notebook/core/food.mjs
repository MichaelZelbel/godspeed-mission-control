// The food tracker (Mission Control's work/plans/2026-10-12-trackers-food-design.md, D-321 step 5): a
// specialist on the shared tracker base. Its rows are items (when, meal, item, food, grams, count, unit,
// kcal, protein_g, carbs_g, fat_g, assumed, source); this file does every number: the values of an
// amount from the table's values per 100 g, her usual portions, the day's totals, the daily target
// (Mifflin-St Jeor, the safety floors) and its weekly adaptation, and writes every reply in English and
// German. The model only turns her sentence into items and grams; a number in a reply is never its.
import {addDays,daysBetween} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {schemaFor} from './trackers.mjs';

export const MEALS=['breakfast','lunch','dinner','snack','none'];
const MEAL_RE={breakfast:/(?<!\p{L})(?:breakfast|frühstück\p{L}*)(?!\p{L})/iu,lunch:/(?<!\p{L})(?:lunch|mittag\p{L}*)(?!\p{L})/iu,dinner:/(?<!\p{L})(?:dinner|supper|abendessen|abendbrot)(?!\p{L})/iu,snack:/(?<!\p{L})(?:snacks?|zwischenmahlzeit\p{L}*)(?!\p{L})/iu};
export const mealOf=text=>Object.keys(MEAL_RE).find(m=>MEAL_RE[m].test(String(text||'')))||'none';
// The words that hand a "track" to this tracker: food, a meal, what she ate, in both languages.
export const FOOD_WORDS=/(?<!\p{L})(?:food|foods|meal|meals|breakfast|lunch|dinner|supper|snacks?|ate|eaten|eat|essen|mahlzeit\p{L}*|frühstück\p{L}*|mittagessen|abendessen|abendbrot|zwischenmahlzeit\p{L}*|gegessen|ernährung\p{L}*)(?!\p{L})/iu;
export const ACTIVITY={sedentary:1.2,light:1.375,moderate:1.55,very:1.725,extra:1.9};
export const GOALS={lose:-500,keep:0,gain:300};
export const FLOOR={female:1200,male:1500};
export const KCAL_PER_KG=7700,STEP=150;
export const lang=x=>String(x||'').toLowerCase().startsWith('de')?'de':'en';
const r2=n=>Math.round(n*100)/100;
export function foodSchema(){
 return schemaFor({cadence:'any',fields:[
  {key:'meal',label:'Meal',type:'select',options:[...MEALS]},
  {key:'item',label:'Item',type:'text'},
  {key:'food',label:'Food',type:'text'},
  {key:'grams',label:'Grams',type:'number',unit:'g'},
  {key:'count',label:'Count',type:'number'},
  {key:'unit',label:'Unit',type:'text'},
  {key:'kcal',label:'kcal',type:'number',unit:'kcal'},
  {key:'protein_g',label:'Protein',type:'number',unit:'g'},
  {key:'carbs_g',label:'Carbohydrates',type:'number',unit:'g'},
  {key:'fat_g',label:'Fat',type:'number',unit:'g'},
  {key:'assumed',label:'Amount assumed',type:'boolean'},
  {key:'source',label:'Source',type:'text'}]});
}
// What the tracker card holds beyond the base's card: her settings, presets, profile and target.
export function foodCard(card){
 const f=card?.food&&typeof card.food==='object'?card.food:{};
 return {numbers:f.numbers!==false&&f.eating_disorder!==true,eating_disorder:f.eating_disorder===true,pregnant:f.pregnant===true,breastfeeding:f.breastfeeding===true,
  presets:f.presets&&typeof f.presets==='object'?f.presets:{},profile:f.profile&&typeof f.profile==='object'?f.profile:{},target:f.target&&typeof f.target==='object'&&Number.isFinite(f.target.kcal)?f.target:null};
}
// ---- Amounts and values ---------------------------------------------------------------------------
// An amount's values from the food's values per 100 g; an unknown value counts as 0.
export function nutrients(food,grams){
 const per=k=>Number.isFinite(food?.[k])?food[k]:0;
 return {kcal:r2(per('kcal')*grams/100),protein_g:r2(per('protein')*grams/100),carbs_g:r2(per('carbs')*grams/100),fat_g:r2(per('fat')*grams/100)};
}
// A container or a piece as one word: "packs" pack, "Scheiben" scheibe, "Packungen" packung.
export function unitKey(unit){
 const u=String(unit??'').normalize('NFKC').toLocaleLowerCase().trim();if(!u)return '';
 if(/(?:ches|shes|sses|xes)$/.test(u))return u.slice(0,-2);
 if(/ungen$/.test(u))return u.slice(0,-2);
 if(/[^s]s$/.test(u)&&u.length>3)return u.slice(0,-1);
 if(/[^e]en$/.test(u)&&u.length>4)return u.slice(0,-1);
 return u;
}
export const foodIdOf=source=>{const s=String(source||'').trim(),off=s.match(/^Open Food Facts (\d{8,14})$/);if(off)return 'off:'+off[1];const bls=s.match(/([A-Z][0-9A-Z]{6})$/);return bls?bls[1]:null;};
export const sourceOf=food=>String(food.id).startsWith('off:')?'Open Food Facts '+food.id.slice(4):'BLS 4.0 '+food.id;
// Her usual portions, read from her rows: the newest row of a food and unit whose amount she gave
// (never an assumed one), its grams per piece or container. A correction changes it; nothing keeps a copy.
export function portionsFrom(rows){
 const map=new Map();
 for(const r of [...rows].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))){
  const d=r.data||{},id=foodIdOf(d.source);if(!id||d.assumed===true||!(Number(d.grams)>0))continue;
  const count=Number(d.count)>0?Number(d.count):1;map.set(id+'|'+unitKey(d.unit),r2(Number(d.grams)/count));
 }
 return (food,unit)=>map.get(food+'|'+unitKey(unit))??null;
}
const positive=(v,what,max)=>{const n=Number(v);if(!Number.isFinite(n)||n<=0||n>max)throw Error(what);return n;};
// The model's items to amounts code can count. Grams she said are used; else her usual portion of that
// food and unit; else the typical weight the model marked assumed; else the item is asked about once.
export function resolveItems(items,{lookup,portionOf}){
 if(!Array.isArray(items))throw Error('Say what you ate');
 const resolved=[],unclear=[];
 items.forEach((it,index)=>{
  const food=lookup(String(it?.food??'').trim());
  const item=String(it.item||'').trim()||food.en,unit=it.unit?unitKey(it.unit):'',count=it.count===undefined||it.count===null||it.count===''?null:positive(it.count,'A count is a number above 0, at most 50',50);
  const given=it.grams!==undefined&&it.grams!==null&&it.grams!=='';
  const grams=given?positive(it.grams,'An amount is a number of grams above 0, at most 5000',5000):null;
  const usual=portionOf(food.id,unit);
  let amount=null,assumed=false;
  if(given&&it.assumed!==true)amount=grams;
  else if(usual)amount=r2((count||1)*usual);
  else if(given){amount=grams;assumed=true;}
  if(amount===null){unclear.push({index,item,count,unit:it.unit?String(it.unit).trim():'',food:food.id});return;}
  resolved.push({index,food,item,grams:amount,count,unit,assumed,...nutrients(food,amount)});
 });
 return {resolved,unclear};
}
export const rowOf=(it,{when,meal})=>({when,meal,item:it.item,food:it.food.en,grams:r2(it.grams),...(it.count?{count:it.count}:{}),...(it.unit?{unit:it.unit}:{}),kcal:it.kcal,protein_g:it.protein_g,carbs_g:it.carbs_g,fat_g:it.fat_g,assumed:it.assumed===true,source:sourceOf(it.food)});
export function totalsOf(rows){
 const t={kcal:0,protein_g:0,carbs_g:0,fat_g:0};
 for(const r of rows){const d=r.data||r;for(const k of Object.keys(t))t[k]+=Number(d[k])||0;}
 for(const k of Object.keys(t))t[k]=r2(t[k]);return t;
}
// ---- The target -----------------------------------------------------------------------------------
// Her age today, from the age she gave and the day she gave it: one more on each anniversary of that day.
const fullYears=(from,to)=>{const [a,b]=[from,to].map(d=>String(d).split('-').map(Number));let y=b[0]-a[0];if(b[1]<a[1]||b[1]===a[1]&&b[2]<a[2])y--;return Math.max(0,y);};
export const ageOn=(p,today)=>Number.isFinite(p.age)?p.age+(p.age_on&&today?fullYears(p.age_on,today):0):null;
const NEEDED=['sex','age','height_cm','weight_kg','activity','goal'];
// Mifflin-St Jeor x activity, -500 to lose, +300 to gain; protein 1.5 g/kg losing, 1.2 otherwise; fat at
// least 25% of the energy, carbohydrates the rest. The floors and the cases with no target, in code.
export function targetFor(p,today){
 if(p.eating_disorder)return {none:'eating_disorder'};
 if(p.pregnant)return {none:'pregnant'};
 if(p.breastfeeding)return {none:'breastfeeding'};
 const age=ageOn(p,today);
 if(Number.isFinite(age)&&age<19)return {none:'under19'};
 const missing=NEEDED.filter(k=>k==='age'?!Number.isFinite(age):k==='sex'?!['female','male'].includes(p.sex):k==='activity'?!ACTIVITY[p.activity]:k==='goal'?!(p.goal in GOALS):!(Number(p[k])>0));
 if(missing.length)return {missing};
 const bmr=10*p.weight_kg+6.25*p.height_cm-5*age+(p.sex==='male'?5:-161),tdee=bmr*ACTIVITY[p.activity],formula=Math.round(tdee+GOALS[p.goal]),floor=FLOOR[p.sex];
 const kcal=Math.max(formula,floor),protein_g=Math.round((p.goal==='lose'?1.5:1.2)*p.weight_kg);
 return {kcal,...macros(kcal,protein_g),bmr:r2(bmr),tdee:r2(tdee),delta:GOALS[p.goal],floor:formula<floor?floor:null,formula_kcal:formula};
}
function macros(kcal,protein_g){const fat_g=Math.ceil(kcal*0.25/9);return {protein_g,fat_g,carbs_g:Math.max(0,Math.floor((kcal-protein_g*4-fat_g*9)/4))};}
// The least-squares slope of weights, in kg a day; null without two days.
export function slope(weights){
 const pts=weights.filter(w=>Number.isFinite(w.kg)).map(w=>({x:daysBetween(weights[0].day,w.day),y:w.kg}));
 if(pts.length<2)return null;const mx=pts.reduce((s,p)=>s+p.x,0)/pts.length,my=pts.reduce((s,p)=>s+p.y,0)/pts.length,sxx=pts.reduce((s,p)=>s+(p.x-mx)**2,0);
 return sxx?pts.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/sxx:null;
}
// The target as it stands today: the one she set, moved once for every full week since (decision 6 of
// the design). Worked out whenever it is read, never written by a job, so nothing can message her.
export function currentTarget(food,rows,weights,today){
 const t=food.target;if(!t)return null;
 const p=food.profile||{},floor=FLOOR[p.sex]||FLOOR.female,delta=GOALS[p.goal]??0,changes=[];let kcal=t.kcal;
 for(let k=1;addDays(t.set_on,7*k)<=today;k++){
  const from=addDays(t.set_on,7*(k-1)),to=addDays(t.set_on,7*k-1),on=addDays(t.set_on,7*k);
  const byDay=new Map();for(const r of rows){const d=String(r.data?.when||'').slice(0,10);if(d>=from&&d<=to)byDay.set(d,(byDay.get(d)||0)+(Number(r.data?.kcal)||0));}
  const days=[...byDay.values()].filter(v=>v>0);
  const ws=weights.filter(w=>w.day>=addDays(to,-13)&&w.day<=to).sort((a,b)=>a.day.localeCompare(b.day)),s=ws.length>=2?slope(ws):null;
  if(days.length<4||s===null)continue;
  const intake=days.reduce((a,b)=>a+b,0)/days.length,used=intake-s*KCAL_PER_KG,aim=used+delta;
  const next=Math.max(floor,Math.round(kcal+Math.max(-STEP,Math.min(STEP,aim-kcal))));
  if(next!==kcal)changes.push({on,from:kcal,to:next,days:days.length,intake:Math.round(intake),kg_week:r2(s*7),used:Math.round(used)});
  kcal=next;
 }
 return {kcal,...macros(kcal,t.protein_g),changes};
}
// Her weights, from the notebook's health observations and the coach's daily table: [{day, kg}].
export function weightsFrom(observations,table,zoneDay){
 const out=new Map();
 for(const o of observations||[]){
  if(!/^(?:weight|weight_kg|body[_ -]?weight|body[_ -]?mass|bodymass|gewicht|current-weight)$/i.test(String(o.metric||'')))continue;
  let kg=Number(o.value);if(!Number.isFinite(kg))continue;if(/^lbs?$/i.test(String(o.unit||'')))kg=kg*0.45359237;
  const day=o.observed_on||zoneDay(o.observed_at);if(day&&kg>20&&kg<400)out.set(day,r2(kg));
 }
 for(const [day,row] of Object.entries(table||{})){const kg=Number(row.weight_kg);if(/^\d{4}-\d\d-\d\d$/.test(day)&&kg>20&&kg<400&&!out.has(day))out.set(day,kg);}
 return [...out].map(([day,kg])=>({day,kg})).sort((a,b)=>a.day.localeCompare(b.day));
}
// ---- Words ----------------------------------------------------------------------------------------
const MONTHS={en:['January','February','March','April','May','June','July','August','September','October','November','December'],de:['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']};
export const dateWords=(l,day)=>{const [,m,d]=String(day).split('-').map(Number);return l==='de'?d+'. '+MONTHS.de[m-1]:d+' '+MONTHS.en[m-1];};
export const fmt=(l,n)=>Math.round(Number(n)||0).toLocaleString(l==='de'?'de-DE':'en-US');
const grams=(l,n)=>{const v=Math.round(Number(n)*10)/10;return (Number.isInteger(v)?String(v):String(v).replace('.',l==='de'?',':'.'))+' g';};
const list=(l,items)=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+(l==='de'?' und ':' and ')+items.at(-1);
const W={
 en:{tracked:'Tracked',assumed:'assumed',protein:'protein',carbs:'carbohydrates',fat:'fat'},
 de:{tracked:'Erfasst',assumed:'geschätzt',protein:'Eiweiß',carbs:'Kohlenhydrate',fat:'Fett'},
};
export const MEAL_SAID={en:{breakfast:'breakfast',lunch:'lunch',dinner:'dinner',snack:'snack'},de:{breakfast:'Frühstück',lunch:'Mittagessen',dinner:'Abendessen',snack:'Snack'}};
export function setupQuestion(l,{questions='',kept=false}={}){
 const head=l==='de'
  ?'Einen Ernährungs-Tracker starten? Er rechnet Kalorien und Eiweiß aus einer Lebensmitteltabelle aus und kann dir ein Tagesziel geben. Die Zahlen sind Schätzungen aus der Tabelle, und du kannst jeden Eintrag in deinem Notizbuch ändern. Wenn du eine Essstörung hast oder hattest, sag es mir, dann zeige ich Summen nur, wenn du fragst, und setze nie ein Ziel.'
  :'Start a food tracker? It works out calories and protein from a food table and can keep a daily target for you. The numbers are estimates from the table, and you can change every entry in your notebook. If you have or had an eating disorder, tell me, and I will show totals only when you ask and never set a target.';
 return head+(questions?' '+questions:kept?(l==='de'?' Ich habe mir diese Mahlzeit gemerkt.':" I've kept this meal."):'');
}
// The one question about each unclear amount: the container's size, or the grams.
export function questionText(l,unclear){
 return unclear.map(u=>u.unit?(l==='de'?'Wie viele Gramm '+u.item+' sind es pro '+u.unit+'?':'How big was the '+u.unit+' of '+u.item+'?'):(l==='de'?'Wie viele Gramm '+u.item+' waren es?':'How much '+u.item+' was it, in grams?')).join(' ');
}
const itemWords=(l,items,numbers)=>items.map(i=>numbers?i.item+' '+grams(l,i.grams)+(i.assumed?' ('+W[l].assumed+')':''):i.item).join(', ');
// What is left of today's target: "1,180 kcal left today, 86 g protein to go."
export function leftWords(l,left){
 if(!left)return '';
 const kcal=left.kcal>=0?(l==='de'?'Für heute bleiben '+fmt(l,left.kcal)+' kcal':fmt(l,left.kcal)+' kcal left today'):(l==='de'?'Heute '+fmt(l,-left.kcal)+' kcal über deinem Ziel':fmt(l,-left.kcal)+" kcal over today's target");
 const protein=left.protein_g>0.5?(l==='de'?', und '+fmt(l,left.protein_g)+' g Eiweiß fehlen noch':', '+fmt(l,left.protein_g)+' g protein to go'):(l==='de'?', dein Eiweißziel ist erreicht':', protein target reached');
 return ' '+kcal+protein+'.';
}
export function trackReply(l,{items,numbers=true,left=null,day=null,today=null}){
 const head=W[l].tracked+(day&&today&&day!==today?(l==='de'?' für den ':' for ')+dateWords(l,day):'')+': ';
 if(!numbers)return head+itemWords(l,items,false)+'.';
 const t=totalsOf(items);
 return head+itemWords(l,items,true)+': '+fmt(l,t.kcal)+' kcal, '+fmt(l,t.protein_g)+' g '+W[l].protein+'.'+leftWords(l,left);
}
export const targetHint=l=>l==='de'?' Sag "setz mein Ernährungsziel", wenn du ein Tagesziel möchtest.':' Say "set my food target" when you want a daily target.';
export const readyReply=l=>l==='de'?'Dein Ernährungs-Tracker ist bereit. Sag "track" und was du gegessen hast, etwa "track Mittagessen, zwei Eier und eine Scheibe Roggenbrot".':'Your food tracker is ready. Say "track" and what you ate, like "track lunch, two eggs and a slice of rye bread".';
export const edReply=l=>l==='de'?'Verstanden. Ich setze kein Ziel und zeige Summen nur, wenn du danach fragst.':'Understood. I will not set a target, and I will show totals only when you ask for them.';
export function todayReply(l,{items,numbers=true,totals=null,target=null,left=null,day=null,today=null}){
 const when=day&&today&&day!==today?(l==='de'?'Am '+dateWords(l,day):'On '+dateWords(l,day)):(l==='de'?'Heute':'Today');
 if(!items.length)return day&&today&&day!==today?(l==='de'?'Am '+dateWords(l,day)+' ist nichts erfasst.':'Nothing tracked on '+dateWords(l,day)+'.'):(l==='de'?'Heute ist noch nichts erfasst.':'Nothing tracked today yet.');
 if(!numbers||!totals)return when+': '+items.map(i=>i.item).join(', ')+'.';
 let out=when+': '+items.map(i=>i.item+' '+grams(l,i.grams)).join(', ')+'. '+(l==='de'?'Zusammen ':'Together ')+fmt(l,totals.kcal)+' kcal, '+list(l,[fmt(l,totals.protein_g)+' g '+W[l].protein,fmt(l,totals.carbs_g)+' g '+W[l].carbs,fmt(l,totals.fat_g)+' g '+W[l].fat])+'.';
 if(target)out+=l==='de'?' Dein Ziel sind '+fmt(l,target.kcal)+' kcal und '+fmt(l,target.protein_g)+' g Eiweiß.'+leftWords(l,left):' Your target is '+fmt(l,target.kcal)+' kcal and '+fmt(l,target.protein_g)+' g protein.'+leftWords(l,left);
 return out;
}
const ASK={
 en:{sex:'whether the formula should count you as female or male',age:'your age',height_cm:'your height in cm',weight_kg:'your weight in kg',activity:'how active you are (mostly sitting, lightly active, moderately active, very active or extremely active)',goal:'whether you want to lose, keep or gain weight'},
 de:{sex:'ob die Formel dich als Frau oder als Mann rechnen soll',age:'dein Alter',height_cm:'deine Größe in cm',weight_kg:'dein Gewicht in kg',activity:'wie aktiv du bist (meist sitzend, leicht aktiv, mäßig aktiv, sehr aktiv oder extrem aktiv)',goal:'ob du abnehmen, dein Gewicht halten oder zunehmen willst'},
};
export function targetQuestion(l,{missing,weight=null}){
 let out=l==='de'?'Für dein Tagesziel brauche ich noch: '+list(l,missing.map(k=>ASK.de[k]))+'.':'To set your daily target I need to know '+list(l,missing.map(k=>ASK.en[k]))+'.';
 if(weight)out+=l==='de'?' Dein Gewicht habe ich aus deinen Gesundheitsdaten: '+String(weight.kg).replace('.',',')+' kg.':' I have your weight from your health data: '+weight.kg+' kg.';
 return out+(l==='de'?' Wenn du schwanger bist oder stillst oder eine Essstörung hast oder hattest, sag mir das stattdessen: Dann gibt es nur Summen und kein Ziel.':' If you are pregnant or breastfeeding, or have or had an eating disorder, tell me instead: then I keep totals only and set no target.');
}
const ACTIVITY_SAID={en:{sedentary:'mostly sitting',light:'lightly active',moderate:'moderately active',very:'very active',extra:'extremely active'},de:{sedentary:'meist sitzend',light:'leicht aktiv',moderate:'mäßig aktiv',very:'sehr aktiv',extra:'extrem aktiv'}};
export function targetReply(l,t,p){
 const goal=t.delta<0?(l==='de'?', minus '+fmt(l,-t.delta)+' kcal zum Abnehmen':', minus '+fmt(l,-t.delta)+' kcal to lose weight'):t.delta>0?(l==='de'?', plus '+fmt(l,t.delta)+' kcal zum Zunehmen':', plus '+fmt(l,t.delta)+' kcal to gain weight'):(l==='de'?', zum Halten deines Gewichts':', to keep your weight');
 const from=[String(p.weight_kg).replace('.',l==='de'?',':'.')+' kg',p.height_cm+' cm',p.age+(l==='de'?' Jahren':' years'),ACTIVITY_SAID[l][p.activity]];
 let out=l==='de'
  ?'Dein Tagesziel: '+fmt(l,t.kcal)+' kcal, '+fmt(l,t.protein_g)+' g Eiweiß, '+fmt(l,t.fat_g)+' g Fett und '+fmt(l,t.carbs_g)+' g Kohlenhydrate. Berechnet aus '+list(l,from)+goal+'.'
  :'Your daily target: '+fmt(l,t.kcal)+' kcal, '+fmt(l,t.protein_g)+' g protein, '+fmt(l,t.fat_g)+' g fat and '+fmt(l,t.carbs_g)+' g carbohydrates. Worked out from '+list(l,from)+goal+'.';
 if(t.floor)out+=l==='de'?' Die Formel ergab '+fmt(l,t.formula_kcal)+' kcal; ich setze nie weniger als '+fmt(l,t.floor)+' kcal '+(t.floor===FLOOR.male?'für Männer':'für Frauen')+'.':' The formula gave '+fmt(l,t.formula_kcal)+' kcal, and I never set less than '+fmt(l,t.floor)+' kcal for '+(t.floor===FLOOR.male?'men':'women')+'.';
 return out+(l==='de'?' Es passt sich einmal pro Woche an das an, was du isst und wiegst, um höchstens 150 kcal.':' It adapts once a week to what you eat and weigh, by at most 150 kcal.');
}
export function noTargetReply(l,why){
 if(why==='under19')return l==='de'?'Unter 19 Jahren setze ich kein Ernährungsziel. Ich erfasse weiter, was du isst, mit den Summen.':"I don't set a food target for anyone under 19. I keep tracking what you eat, with the totals.";
 if(why==='pregnant'||why==='breastfeeding')return l==='de'?'In der Schwangerschaft und Stillzeit setze ich kein Ziel und zeige nur Summen. Wie viel du jetzt essen solltest, fragst du am besten deine Ärztin, deinen Arzt oder deine Hebamme.':'During pregnancy and breastfeeding I set no target and keep totals only. How much to eat now is a question for your doctor or midwife.';
 return edReply(l);
}
export function adaptLine(l,c){
 const fell=c.kg_week<0,amount=Math.abs(c.kg_week).toFixed(1);
 return l==='de'
  ?'Dein Ernährungsziel ging am '+dateWords(l,c.on)+' von '+fmt(l,c.from)+' auf '+fmt(l,c.to)+' kcal: In der Woche davor hast du an '+c.days+' von 7 Tagen erfasst, im Schnitt '+fmt(l,c.intake)+' kcal, und dein Gewichtstrend '+(fell?'fiel':'stieg')+' um '+amount.replace('.',',')+' kg pro Woche, also hast du etwa '+fmt(l,c.used)+' kcal am Tag verbraucht.'
  :'Your food target moved from '+fmt(l,c.from)+' to '+fmt(l,c.to)+' kcal on '+dateWords(l,c.on)+': in the week before you tracked '+c.days+' of 7 days at '+fmt(l,c.intake)+' kcal on average, and your weight trend '+(fell?'fell':'rose')+' '+amount+' kg a week, so you used about '+fmt(l,c.used)+' kcal a day.';
}

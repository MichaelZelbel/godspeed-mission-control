// The cycle tracker (Mission Control's work/plans/2026-10-12-trackers-cycle-design.md, D-321 step 4):
// a specialist on the shared tracker base. Its rows are days (when, flow, pain, pain_where, symptoms,
// ended, note); this file works out from them when a period started, how long it lasted, and the
// forecast of the next one, and writes every reply in English and German. Code, never the model,
// does the arithmetic. It never computes a fertile window, an ovulation day or "safe days", and
// never gives advice about conceiving or avoiding pregnancy or a diagnosis: asked, it declines.
import {addDays,daysBetween} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {schemaFor} from './trackers.mjs';

// "unspecified" is a period day whose amount she did not say ("track period"): Apple Health keeps the
// same value for the same reason. Without it the row would invent an amount or not count at all.
export const FLOWS=['spotting','light','medium','heavy','none','unspecified'];
export const PERIOD_FLOWS=new Set(['unspecified','light','medium','heavy']);
export const PAIN_WHERE=['belly','back','head'];
// The familiar symptoms of the design, each with the words that name it in English and German (a
// symptom is saved only when she named it) and its German word for a reply.
export const SYMPTOMS=[
 {key:'cramps',de:'Krämpfe',words:['cramp','krampf','krämpf','regelschmerz','periodenschmerz','unterleibsschmerz']},
 {key:'headache',de:'Kopfschmerzen',words:['headache','kopfschmerz','kopfweh','migräne','migraine']},
 {key:'bloating',de:'Blähbauch',words:['bloat','bläh','aufgebläht','völlegefühl']},
 {key:'breast tenderness',de:'Brustspannen',words:['breast','brust']},
 {key:'acne',de:'Pickel',words:['acne','akne','pickel','pimple','spots','unreine haut']},
 {key:'low mood',de:'gedrückte Stimmung',words:['mood','sad','down','stimmung','traurig','niedergeschlagen','deprimiert']},
 {key:'irritable',de:'gereizt',words:['irritab','cranky','gereizt','reizbar','launisch']},
 {key:'low energy',de:'wenig Energie',words:['energy','tired','exhausted','fatigue','energie','müde','erschöpft','schlapp','kraftlos']},
 {key:'poor sleep',de:'schlecht geschlafen',words:['sleep','slept','insomnia','schlaf','geschlafen']},
 {key:'cravings',de:'Heißhunger',words:['craving','heißhunger','heisshunger','gelüst']},
 {key:'digestion',de:'Verdauung',words:['digest','diarrh','constipat','verdauung','durchfall','verstopf']},
 {key:'discharge',de:'Ausfluss',words:['discharge','ausfluss']},
];
export const FLOW_WORDS={spotting:['spotting','schmier'],light:['light','leicht','schwach','wenig'],medium:['medium','mittel','normal','moderate'],heavy:['heavy','stark','viel','strong'],none:['none','over','ended','stopped','vorbei','aufgehört','zu ende']};
export const WHERE_WORDS={belly:['belly','stomach','tummy','abdomen','lower','bauch','unterleib'],back:['back','rücken','kreuz'],head:['head','kopf']};
// The words that hand a message to this tracker: the period and the cycle, in both languages.
export const CYCLE_WORDS=/(?<!\p{L})(?:periods?|menstruat\p{L}*|menses|cycle|spotting|cramps?|pms|periode|regel|regelblutung|regelschmerzen|zyklus|krämpfe|krampf|schmierblutung|meine tage)(?!\p{L})/iu;
// A word that says she has her period today ("track period", "meine Tage", "Blutung").
export const PERIOD_WORDS=/(?<!\p{L})(?:periods?|menstruat\p{L}*|menses|bleed\p{L}*|periode|regel|regelblutung|blutung|blute\p{L}*|meine tage)(?!\p{L})/iu;
export const OVER_WORDS=/(?<!\p{L})(?:over|ended|finished|stopped|done|vorbei|zu ende|aufgehört|fertig|beendet|vorüber)(?!\p{L})/iu;
// The questions it never answers (decision 4): a fertile window, ovulation, safe days, conceiving or
// avoiding pregnancy, contraception advice, a diagnosis. Marking a cycle as affected by starting or
// stopping the pill or contraception is not such a question.
const FORBIDDEN=/(?<!\p{L})(?:fertil\p{L}*|fruchtbar\p{L}*|ovulat\p{L}*|eisprung|safe days?|sichere tage|safe to have (?:unprotected )?sex|conceiv\p{L}*|conception|get(?:ting)? pregnant|chance of pregnancy|avoid(?:ing)? pregnancy|schwanger (?:werden|zu werden|wird)|kinderwunsch|verhüten|diagnos\p{L}*|endometriosis|endometriose|pcos)(?!\p{L})|(?<!\p{L})(?:contracept\p{L}*|birth control|verhütung)(?!\p{L})/iu;
const MARKING=/(?<!\p{L})(?:start(?:ed|ing)?|stop(?:ped|ping)?|began|begun|quit|came off|abgesetzt|angefangen|begonnen|aufgehört|gewechselt|absetzen|anfangen)(?!\p{L})/iu;
export function asksForbidden(message){
 const text=String(message||'');if(!FORBIDDEN.test(text))return false;
 // Only contraception named, with starting or stopping it: that marks a cycle, it asks nothing.
 const only=text.replace(/(?<!\p{L})(?:hormonal |hormonelle |hormoneller )?(?:contracept\p{L}*|birth control|verhütung)(?!\p{L})/giu,'');
 return FORBIDDEN.test(only)||!MARKING.test(text);
}
export const isOutlier=n=>n<21||n>45;
const MARK_WHY=['outlier','pregnancy','breastfeeding','contraception'];
export const lang=x=>String(x||'').toLowerCase().startsWith('de')?'de':'en';
export function cycleSchema(){
 return schemaFor({cadence:'daily',fields:[
  {key:'flow',label:'Flow',type:'select',options:[...FLOWS]},
  {key:'pain',label:'Pain (0 to 3)',type:'number'},
  {key:'pain_where',label:'Where it hurts',type:'multiselect',options:[...PAIN_WHERE]},
  {key:'symptoms',label:'Symptoms',type:'multiselect',options:SYMPTOMS.map(s=>s.key)},
  {key:'ended',label:'Period over',type:'boolean'}]});
}
export function cycleCard(card){
 const c=card?.cycle&&typeof card.cycle==='object'?card.cycle:{};
 return {heads_up:c.heads_up===true,left_out:(Array.isArray(c.left_out)?c.left_out:[]).filter(m=>m&&/^\d{4}-\d\d-\d\d$/.test(m.start)&&MARK_WHY.includes(m.why)),counted:(Array.isArray(c.counted)?c.counted:[]).filter(d=>/^\d{4}-\d\d-\d\d$/.test(d))};
}
const dayOfRow=r=>String(r.data?.when||'').slice(0,10);
export const isPeriodDay=r=>PERIOD_FLOWS.has(r.data?.flow);
// The periods in the rows (decision 2): a period day with at least 5 days without one before it
// starts a period; spotting alone never does. A period ends at its "over" row (that day when it has
// flow, else the day before), or at its last period day when later ones follow or nobody said over.
export function periods(rows){
 const days=[...rows].filter(r=>/^\d{4}-\d\d-\d\d$/.test(dayOfRow(r))).sort((a,b)=>dayOfRow(a).localeCompare(dayOfRow(b))||String(a.created_at).localeCompare(String(b.created_at)));
 const out=[];let current=null;
 for(const r of days){
  const day=dayOfRow(r);
  if(isPeriodDay(r)){if(!current||daysBetween(current.last,day)-1>=5)out.push(current={start:day,last:day,over:null});else if(day>current.last)current.last=day;}
  // An over row belongs to the period before it, within a week of its last day.
  if(r.data?.ended===true&&current&&!current.over&&day>=current.start&&daysBetween(current.last,day)<=7)current.over={day,flow:isPeriodDay(r)};
 }
 return out.map(p=>{const overEnd=p.over?(p.over.flow?p.over.day:addDays(p.over.day,-1)):null,end=overEnd&&overEnd>p.last?overEnd:p.last;return {start:p.start,last:p.last,end,length:daysBetween(p.start,end)+1,over:p.over?.day||null};});
}
// What the rows and the card say together: the periods, the cycles between their starts with what
// counts, and the open cycle (the one since the last start).
export function cycleState(rows,card,today){
 const marks=cycleCard(card),ps=periods(rows),starts=ps.map(p=>p.start);
 const cycles=ps.slice(0,-1).map((p,i)=>{
  const length=daysBetween(p.start,ps[i+1].start),mark=marks.left_out.find(m=>m.start===p.start);
  const status=mark?'left_out':isOutlier(length)&&!marks.counted.includes(p.start)?'pending':'counted';
  return {start:p.start,next:ps[i+1].start,length,status,why:mark?.why||(status==='pending'?'outlier':null)};
 });
 const last=ps.at(-1),open=last?{start:last.start,why:marks.left_out.find(m=>m.start===last.start)?.why||null}:null;
 return {periods:ps,starts,cycles,open,card:{...marks,language:lang(card?.language)},today};
}
// The forecast (decision 3): the median of the last six counted cycles as most likely, the window
// from the shortest to the longest, counted from the last start. No forecast before two complete
// cycles count; none while the open cycle is marked as affected.
export function forecast(state,today=state.today){
 const {cycles,starts,open}=state;
 if(open?.why&&open.why!=='outlier')return {kind:'paused',why:open.why};
 const counted=cycles.filter(c=>c.status==='counted'),used=counted.slice(-6),pending=cycles.filter(c=>c.status==='pending');
 if(used.length<2)return {kind:'too-early',starts:starts.length,complete:cycles.length,used:used.map(c=>c.length),pending};
 const lengths=used.map(c=>c.length),sorted=[...lengths].sort((a,b)=>a-b),half=sorted.length/2;
 const median=sorted.length%2?sorted[Math.floor(half)]:Math.round((sorted[half-1]+sorted[half])/2),last=starts.at(-1);
 const to=addDays(last,sorted.at(-1));
 return {kind:'window',from:addDays(last,sorted[0]),to,likely:addDays(last,median),lengths,unreliable:sorted.at(-1)-sorted[0]>9,pending,late:today>to?daysBetween(last,today)+1:null};
}

// ---- Words -----------------------------------------------------------------------------------
const MONTHS={en:['January','February','March','April','May','June','July','August','September','October','November','December'],de:['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']};
const dateWords=(l,day)=>{const [,m,d]=day.split('-').map(Number);return l==='de'?d+'. '+MONTHS.de[m-1]:d+' '+MONTHS.en[m-1];};
const list=(l,items)=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+(l==='de'?' und ':' and ')+items.at(-1);
const between=(l,from,to)=>{
 const [a,b]=[from,to].map(d=>d.split('-').map(Number));
 if(l==='de')return a[1]===b[1]?'zwischen dem '+a[2]+'. und '+dateWords(l,to):'zwischen dem '+dateWords(l,from)+' und dem '+dateWords(l,to);
 return a[1]===b[1]?'between '+a[2]+' and '+dateWords(l,to):'between '+dateWords(l,from)+' and '+dateWords(l,to);
};
export const FIXED_LINE={en:'Not for contraception or for trying to conceive, and not a diagnosis.',de:'Nicht zur Verhütung oder für den Kinderwunsch, und keine Diagnose.'};
const WHY={en:{pregnancy:'pregnancy',breastfeeding:'breastfeeding',contraception:'starting or stopping hormonal contraception',outlier:'its unusual length'},de:{pregnancy:'eine Schwangerschaft',breastfeeding:'das Stillen',contraception:'Beginn oder Ende hormoneller Verhütung',outlier:'seine ungewöhnliche Länge'}};
const FLOW_SAID={en:{spotting:'spotting',light:'light',medium:'medium',heavy:'heavy'},de:{spotting:'Schmierblutung',light:'leicht',medium:'mittel',heavy:'stark'}};
const WHERE_SAID={en:{belly:'belly',back:'back',head:'head'},de:{belly:'Bauch',back:'Rücken',head:'Kopf'}};
const symptomSaid=(l,key)=>l==='de'?SYMPTOMS.find(s=>s.key===key)?.de||key:key;
const days=(l,n)=>n+(l==='de'?(n===1?' Tag':' Tage'):(n===1?' day':' days'));

// The setup question, the design's words exactly (decision 5); "track cramps" before any tracker
// keeps the cramps, not a day 1. kept: {day, period:boolean, symptoms:[...]}.
export function setupQuestion(l,kept,today){
 const when=kept?.day&&kept.day!==today?dateWords(l,kept.day):null,sym=(kept?.symptoms||[]).map(s=>symptomSaid(l,s));
 if(l==='de'){
  const k=!kept?'':kept.period?' Ich habe mir '+(when?'den '+when:'heute')+' als Tag 1 notiert.':sym.length?' Ich habe mir '+(when?'vom '+when+' ':'von heute ')+list(l,sym)+' notiert.':'';
  return 'Einen Zyklus-Tracker starten? Er hält die Tage deiner Periode fest und auf Wunsch ein paar Beschwerden, und er sagt deine nächste Periode voraus, sobald er zwei Zyklen gesehen hat. Er ist nicht zur Verhütung und nicht für den Kinderwunsch gedacht, und er stellt keine Diagnose. Deine Einträge bleiben in deinem eigenen Notizbuch; was du schreibst und was ich antworte, läuft wie jede Nachricht über Telegram und deinen KI-Dienst.'+k;
 }
 const k=!kept?'':kept.period?" I've kept "+(when||'today')+' as day 1.':sym.length?" I've kept "+(when?'the '+list(l,sym)+' of '+when:"today's "+list(l,sym))+'.':'';
 return "Start a cycle tracker? It keeps the days of your period and a few symptoms if you like, and forecasts your next period once it has seen two cycles. It is not for contraception or for trying to conceive, and it is not a diagnosis. Your entries stay in your own notebook; what you type and what I answer pass through Telegram and your AI service, like every message."+k;
}
export function createdReply(l,said){
 return l==='de'?'Erfasst: '+said+'. Ab jetzt sag einfach "track Periode", "track Periode vorbei" oder ein Symptom, etwa "track Krämpfe".':'Tracked: '+said+'. From now on just say "track period", "track period over", or a symptom, like "track cramps".';
}
// One day in a few words: "period day 2, heavy, cramps 2 of 3".
export function dayWords(l,{periodDay,data}){
 const parts=[],syms=[...(data.symptoms||[])],flow=data.flow;
 if(periodDay&&PERIOD_FLOWS.has(flow))parts.push((l==='de'?'Periode Tag ':'period day ')+periodDay);
 if(FLOW_SAID[l][flow])parts.push(FLOW_SAID[l][flow]);
 if(data.pain!==undefined&&data.pain!==null&&data.pain!==''){
  const label=syms.includes('cramps')?symptomSaid(l,'cramps'):l==='de'?'Schmerzen':'pain',where=(data.pain_where||[]).map(w=>WHERE_SAID[l][w]||w);
  if(syms.includes('cramps'))syms.splice(syms.indexOf('cramps'),1);
  parts.push(label+' '+data.pain+(l==='de'?' von 3':' of 3')+(where.length?' ('+where.join(', ')+')':''));
 }
 parts.push(...syms.map(s=>symptomSaid(l,s)));
 if(!parts.length)parts.push(data.note?(l==='de'?'deine Notiz':'your note'):(l==='de'?'der Tag':'the day'));
 return parts.join(', ');
}
// The answer to a tracked day. lastCycle: the cycle this day's new start completed.
export function dayReply(l,{day,today,periodDay,data,lastCycle}){
 const head=(l==='de'?'Erfasst':'Tracked')+(day!==today?(l==='de'?' für den ':' for ')+dateWords(l,day):'')+': ';
 let out=head+dayWords(l,{periodDay,data})+'.';
 if(lastCycle){
  out+=l==='de'?' Dein letzter Zyklus war '+days(l,lastCycle)+' lang':' Your last cycle was '+days(l,lastCycle);
  if(isOutlier(lastCycle))out+=(l==='de'?', '+(lastCycle<21?'kürzer als 21':'länger als 45')+'. Soll ich ihn bei der Vorhersage weglassen?':', '+(lastCycle<21?'shorter than 21':'longer than 45')+'. Leave this one out of the forecast?');
  else out+='.';
 }
 return out;
}
export const overReply=(l,length)=>l==='de'?'Erfasst: Deine Periode hat '+days(l,length)+' gedauert.':'Tracked: your period lasted '+days(l,length)+'.';
// Every reply of the forecast action ends with the fixed line (decision 4), "too early" included.
export function forecastReply(l,f,today){
 let text;
 if(f.kind==='paused')text=l==='de'?'Keine Vorhersage für diesen Zyklus: Du hast ihn als beeinflusst durch '+WHY.de[f.why]+' markiert.':'No forecast for this cycle: you marked it as affected by '+WHY.en[f.why]+'.';
 else if(f.kind==='too-early'){
  if(f.starts===0)text=l==='de'?'Dafür ist es noch zu früh: Ich habe noch keinen Periodenbeginn gesehen. Sobald ich zwei ganze Zyklen gesehen habe, kann ich deine nächste Periode vorhersagen.':'Too early to say: I have not seen a period start yet. Once I have seen two whole cycles I can forecast your next period.';
  else if(f.starts===1)text=l==='de'?'Dafür ist es noch zu früh: Ich habe bisher einen Beginn gesehen. Nach zwei weiteren kann ich eine erste Vorhersage geben.':'Too early to say: I have seen one start so far. After two more I can give a first forecast.';
  else if(f.complete===1&&f.used.length===1)text=l==='de'?'Dafür ist es noch zu früh: Ich habe bisher einen ganzen Zyklus gesehen ('+days(l,f.used[0])+'). Nach deiner nächsten Periode kann ich eine erste Vorhersage geben.':'Too early to say: I have seen one whole cycle so far ('+days(l,f.used[0])+'). After your next period I can give a first forecast.';
  else text=l==='de'?'Dafür ist es noch zu früh: '+(f.used.length?'Bisher zählt nur einer deiner Zyklen ('+days(l,f.used[0])+')':'Bisher zählt keiner deiner Zyklen')+', die anderen bleiben draußen. Nach deiner nächsten Periode kann ich eine erste Vorhersage geben.':'Too early to say: '+(f.used.length?'only one of your cycles counts so far ('+days(l,f.used[0])+')':'none of your cycles counts so far')+', because the others are left out. After your next period I can give a first forecast.';
 }else{
  const one=f.from===f.to;
  text=l==='de'?(one?'Wahrscheinlich um den '+dateWords(l,f.likely)+'.':'Wahrscheinlich '+between(l,f.from,f.to)+', am ehesten um den '+dateWords(l,f.likely)+'.')+' Deine letzten Zyklen waren '+list(l,f.lengths.map(String))+' Tage lang.'
   :(one?'Likely around '+dateWords(l,f.likely)+'.':'Likely '+between(l,f.from,f.to)+', most likely around '+dateWords(l,f.likely)+'.')+' Your last cycles were '+list(l,f.lengths.map(String))+' days.';
  if(f.unreliable)text+=l==='de'?' Deine letzten Zyklen weichen um mehr als 9 Tage voneinander ab, darum ist diese Vorhersage für dich unzuverlässig.':' Your recent cycles differ by more than 9 days, so this forecast is unreliable for you.';
  if(f.late)text+=l==='de'?' Dieses Fenster ist vorbei: Heute ist Tag '+f.late+' dieses Zyklus.':' That window has passed: today is day '+f.late+' of this cycle.';
 }
 for(const c of f.pending||[])text+=l==='de'?' Ein Zyklus von '+c.length+' Tagen bleibt draußen, bis du sagst, dass er zählen soll.':' A '+c.length+'-day cycle is left out until you say to count it.';
 return text+' '+FIXED_LINE[l];
}
// The one line of her own morning brief (decision 10), on the day two days before the window.
export function headsUpLine(state,today=state.today){
 if(!state.card.heads_up)return null;
 const f=forecast(state,today);if(f.kind!=='window'||addDays(f.from,-2)!==today)return null;
 const l=state.card.language;
 return l==='de'?'Vorwarnung: Deine Periode kann in zwei Tagen beginnen, wahrscheinlich '+between(l,f.from,f.to)+'.':'Heads-up: your period may start in two days, likely '+between(l,f.from,f.to)+'.';
}
export const declineReply=l=>l==='de'?'Dabei kann ich nicht helfen: Dieser Tracker sagt nur voraus, wann deine nächste Periode beginnen kann, und er ist nicht zur Verhütung, nicht für den Kinderwunsch und nicht für eine Diagnose gedacht. Bitte frag deine Ärztin oder deinen Arzt, oder nutze eine dafür zertifizierte App.':"I can't help with that: this tracker only forecasts when your next period may start, and it is not for contraception, for trying to conceive or for a diagnosis. Please ask your doctor, or use a certified app made for that.";
export const whyWords=(l,why)=>WHY[l][why]||why;
export {dateWords,days};

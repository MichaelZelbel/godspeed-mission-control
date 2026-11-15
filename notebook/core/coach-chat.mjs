import {canStartTalk,findArea,listAreas} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {brief,continuingTalkDay} from '../../third-party/addons/godspeed-coach/lib/brief.mjs';
import {prepForBrief,prepMissing} from '../../third-party/addons/godspeed-coach/lib/prep.mjs';
import {readTalk,setOpening,setShown} from '../../third-party/addons/godspeed-coach/lib/talks.mjs';
import {localParts,now} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {loadSettings} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';

export function resolvedCoachArea(reply,root){
  let value;try{value=JSON.parse(String(reply).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('The assistant could not determine whether this starts a coaching talk. Try again.');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'area'))throw Error('The assistant could not determine whether this starts a coaching talk. Try again.');
  if(value.area===null)return null;
  if(typeof value.area!=='string')throw Error('The assistant could not determine whether this starts a coaching talk. Try again.');
  const area=findArea(root,value.area);if(!area)throw Error('The assistant could not determine whether this starts a coaching talk. Try again.');
  return area;
}

export const hasCoachAreas=root=>listAreas(root).some(canStartTalk);

export function coachTalkStart(store,area){
  const settings=loadSettings(store.root),today=localParts(now(),settings.timezone).date,continuing=continuingTalkDay(area,today),prepared=continuing?null:prepForBrief(area,today),missing=continuing||prepared?null:prepMissing(area,today);
  return {area:area.slug,day:continuing||today,brief:brief(store.root,settings,area,today,{inChat:true}),opening:prepared?.opening||null,sentence:missing?`The preparation for this talk is not ready: ${missing}.`:null,continuing:Boolean(continuing)};
}

export function coachTalkRecordProblem(store,start,reply,{requireShown=true}={}){
  const area=findArea(store.root,start.area),talk=area&&readTalk(area,start.day),opening=String(talk?.sections['The opening']||'').trim(),answer=String(reply||'').trim();
  if(!talk)return `The ${start.area} talk record for ${start.day} was not created.`;
  if(talk.state!=='opened')return `The ${start.area} talk record for ${start.day} is not open.`;
  if(!opening)return `The ${start.area} talk record for ${start.day} has no opening.`;
  if(requireShown&&!talk.shown)return `The ${start.area} talk record for ${start.day} was not marked shown in this chat.`;
  if(start.opening&&opening!==start.opening.trim())return `The ${start.area} talk record did not use its prepared opening.`;
  if(start.sentence&&!opening.includes(start.sentence))return `The ${start.area} talk record does not say why its preparation was not ready.`;
  if(start.opening&&answer!==start.opening.trim())return `The reply did not use the ${start.area} talk's prepared opening.`;
  if(start.sentence&&!answer.includes(start.sentence))return `The reply did not include the ${start.area} talk's required preparation sentence.`;
  return null;
}

export function markCoachTalkShown(store,start){
  if(start.continuing)return;
  setShown(findArea(store.root,start.area),start.day,now().toISOString().replace(/\.\d+Z$/,'Z'));
}

// The opening a talk's record holds, when the record itself passes the guard: what the person reads
// when the assistant's replies did not use it (issue #489). Null when the record is wrong or missing,
// or the talk continues an earlier one (its record holds that day's opening, not today's).
export function coachTalkRecordOpening(store,start){
  if(start.continuing)return null;
  const area=findArea(store.root,start.area),talk=area&&readTalk(area,start.day),opening=String(talk?.sections['The opening']||'').trim();
  return opening&&!coachTalkRecordProblem(store,start,opening,{requireShown:false})?opening:null;
}

// The question an unprepared talk asks when the notebook writes its opening itself (issue #495),
// in the area's style: review asks what changed, compass asks about direction.
const usualQuestion=area=>area.style==='review'?`What has changed since our last ${area.title} talk?`:`What would you like to try next in ${area.title}?`;

// A talk record the assistant opened with the wrong opening (not the prepared one, none at all, or
// without the "preparation is not ready" sentence) is corrected to what the talk was prepared to
// say: the prepared opening, or the not-ready sentence plus the usual question. Returns that opening,
// which is what the person reads, with no further AI call (issue #495). Null when the record is
// right, missing or no longer open, the talk continues an earlier one, or nothing was prepared to say.
export function coachTalkCorrectedOpening(store,start){
  if(start.continuing)return null;
  const area=findArea(store.root,start.area),talk=area&&readTalk(area,start.day);
  if(!talk||talk.state!=='opened')return null;
  if(!coachTalkRecordProblem(store,start,String(talk.sections['The opening']||'').trim(),{requireShown:false}))return null;
  const opening=start.opening?start.opening.trim():start.sentence?`${start.sentence} ${usualQuestion(area)}`:null;
  if(!opening)return null;
  setOpening(area,start.day,opening);
  return coachTalkRecordProblem(store,start,opening,{requireShown:false})?null:opening;
}

// What the assistant is told when its reply to a talk start failed the guard (issue #489).
export const coachTalkRetryMessage=(message,problem)=>`${String(message||'')}\n\nYour previous reply to this was refused and the person did not see it: ${problem} The talk record already exists; do not open it again. Answer again now, as the brief says: your final answer is the talk's opening as it stands in the record.`;

// A talk that opened with no prepared opening holds, as its opening, the reply the person was
// actually shown: the assistant may write one opening into the record and answer with other words
// (issue #530). A prepared talk's reply is its record's opening already, and a continued talk's
// record holds an earlier day's opening, so neither is touched.
export function coachTalkRecordShownOpening(store,start,reply){
  if(!start||start.continuing||start.opening)return;
  const area=findArea(store.root,start.area),talk=area&&readTalk(area,start.day),shown=String(reply||'').trim();
  if(!talk||!shown||String(talk.sections['The opening']||'').trim()===shown)return;
  setOpening(area,start.day,shown);
}

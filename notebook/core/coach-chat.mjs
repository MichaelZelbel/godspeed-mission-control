import {canStartTalk,findArea,listAreas} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {brief,continuingTalkDay} from '../../third-party/addons/godspeed-coach/lib/brief.mjs';
import {prepForBrief,prepMissing} from '../../third-party/addons/godspeed-coach/lib/prep.mjs';
import {readTalk,setShown} from '../../third-party/addons/godspeed-coach/lib/talks.mjs';
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

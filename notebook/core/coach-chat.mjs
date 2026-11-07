import {findArea,listAreas} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {brief} from '../../third-party/addons/godspeed-coach/lib/brief.mjs';
import {prepForBrief,prepMissing} from '../../third-party/addons/godspeed-coach/lib/prep.mjs';
import {readTalk} from '../../third-party/addons/godspeed-coach/lib/talks.mjs';
import {localParts,now} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {loadSettings} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';

export function resolvedCoachArea(reply,root){
  let value;try{value=JSON.parse(String(reply).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{return null;}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='area')||value.area===null)return null;
  if(typeof value.area!=='string')return null;
  return findArea(root,value.area);
}

export const hasCoachAreas=root=>listAreas(root).length>0;

export function coachTalkStart(store,area){
  const settings=loadSettings(store.root),day=localParts(now(),settings.timezone).date,prepared=prepForBrief(area,day),missing=prepared?null:prepMissing(area,day);
  return {area:area.slug,day,brief:brief(store.root,settings,area,day,{inChat:true}),opening:prepared?.opening||null,sentence:missing?`The preparation for this talk is not ready: ${missing}.`:null};
}

export function coachTalkRecordProblem(store,start,reply){
  const area=findArea(store.root,start.area),talk=area&&readTalk(area,start.day),opening=String(talk?.sections['The opening']||'').trim(),answer=String(reply||'').trim();
  if(!talk)return `The ${start.area} talk record for ${start.day} was not created.`;
  if(talk.state!=='opened')return `The ${start.area} talk record for ${start.day} is not open.`;
  if(!talk.shown)return `The ${start.area} talk record for ${start.day} was not marked shown in this chat.`;
  if(!opening)return `The ${start.area} talk record for ${start.day} has no opening.`;
  if(start.opening&&opening!==start.opening.trim())return `The ${start.area} talk record did not use its prepared opening.`;
  if(start.sentence&&!opening.includes(start.sentence))return `The ${start.area} talk record does not say why its preparation was not ready.`;
  if(start.opening&&answer!==start.opening.trim())return `The reply did not use the ${start.area} talk's prepared opening.`;
  if(start.sentence&&!answer.includes(start.sentence))return `The reply did not include the ${start.area} talk's required preparation sentence.`;
  return null;
}

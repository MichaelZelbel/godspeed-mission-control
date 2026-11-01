// What a morning briefing does with a sentence that breaks the user's writing rules: it loses that
// sentence, never the whole briefing (issue #117). No check here is new; these are the briefing's
// own code checks (an em dash, the voice rules of profile/voice.md) asked about one piece of text.
import {checkVoice} from './voice-check.mjs';

const EM_DASH='—';
const sentencesOf=line=>line.split(/(?<=[.!?])\s+/).filter(s=>s.trim());

// Why a piece of text is refused: [{rule,value}]. `alone` is a line checked by itself, as a line
// Godspeed requires word for word is when it is made: it is always the first line of what is
// checked, so a banned opener says nothing about where the writer will put it, and is not asked.
export function ruleRefusals(text,voice,{alone=false}={}){
 const out=[];
 if(String(text).includes(EM_DASH))out.push({rule:'WRITING-STYLE',value:'em dash'});
 if(voice){
  const checked=checkVoice(String(text),voice);
  if(checked.configured)for(const hit of checked.hits)if(!hit.advisory&&!(alone&&hit.rule==='BANNED-OPENER'))out.push({rule:hit.rule,value:hit.value});
 }
 return out;
}
export const describeRefusal=r=>r.rule==='WRITING-STYLE'?'the plain writing style (no em dash)':r.rule+': '+r.value;

// The draft without the sentences that carry a refusal. `protectedLines` are the lines Godspeed
// requires word for word (already checked when they were made); they stay as they are.
// Returns {text, cut:[{sentence,refusals}]}; blank lines are kept once, lines left empty go.
function cutOnce(draft,voice,protectedLines){
 const keep=new Set(protectedLines.map(l=>l.trim()).filter(Boolean)),cut=[];
 const firstReal=draft.split(/\r?\n/).findIndex(l=>l.trim());
 const kept=draft.split(/\r?\n/).map((line,index)=>{
  if(!line.trim()||keep.has(line.trim()))return line.trim()?line:'';
  const parts=sentencesOf(line),left=[];
  for(const [i,sentence] of parts.entries()){
   let refusals=ruleRefusals(sentence,voice,{alone:true});
   // A banned opener refuses the first sentence of the first line, wherever it is checked from.
   if(!refusals.length&&index===firstReal&&i===0&&voice){refusals=ruleRefusals(sentence,voice).filter(r=>r.rule==='BANNED-OPENER');}
   if(refusals.length)cut.push({sentence,refusals});else left.push(sentence);
  }
  return left.join(' ');
 });
 const lines=[];
 for(const line of kept){if(!line.trim()&&(!lines.length||!lines.at(-1).trim()))continue;lines.push(line);}
 while(lines.length&&!lines.at(-1).trim())lines.pop();
 return {text:lines.join('\n'),cut};
}

// A banned opener refuses whatever sentence is first once the others are gone, so a pass that cuts
// can make a later sentence the opener: passes go on until one cuts nothing.
export function cutRefused(draft,voice,protectedLines){
 let text=draft;const cut=[];
 for(let round=0;round<50;round++){
  const pass=cutOnce(text,voice,protectedLines);
  cut.push(...pass.cut);text=pass.text;
  if(!pass.cut.length)break;
 }
 return {text,cut};
}

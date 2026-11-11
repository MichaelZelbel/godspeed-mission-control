// What a morning briefing does with a sentence that breaks the user's writing rules: it loses that
// sentence, never the whole briefing (issue #117). No check here is new; these are the briefing's
// own code checks (an em dash, the voice rules of profile/voice.md) asked about one piece of text.
import {checkVoice} from './voice-check.mjs';

const EM_DASH='—';
const sentencesOf=line=>line.split(/(?<=[.!?])\s+/).filter(s=>s.trim());

// Why a piece of text is refused: [{rule,value}]. A line Godspeed requires word for word is asked
// everything when it is made, a banned opener too: the writer may put it first. `skipOpener` is for
// one sentence of a draft, where only the first sentence of the briefing can be an opener.
export function ruleRefusals(text,voice,{skipOpener=false}={}){
 const out=[];
 if(String(text).includes(EM_DASH))out.push({rule:'WRITING-STYLE',value:'em dash'});
 if(voice){
  const checked=checkVoice(String(text),voice);
  if(checked.configured)for(const hit of checked.hits)if(!hit.advisory&&!(skipOpener&&hit.rule==='BANNED-OPENER'))out.push({rule:hit.rule,value:hit.value});
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
   let refusals=ruleRefusals(sentence,voice,{skipOpener:true});
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

// The items of a draft (#387): blocks between blank lines, and inside a block one item per
// numbered line with the lines that follow it. [{start,end}] line indices, end exclusive.
const NUMBERED_LINE=/^\s*\d+[.)]\s+\S/,ITEM_MARKER=/^\s*\d+[.)]/;
export function draftItems(text){
 const lines=text.split(/\r?\n/),items=[];let open=null;
 for(const [i,line] of lines.entries()){
  if(!line.trim()){open=null;continue;}
  if(!open||NUMBERED_LINE.test(line)){open={start:i,end:i+1};items.push(open);}else open.end=i+1;
 }
 return items;
}

export const FINDING_PROBLEMS=['wording','core-unsupported'];
// A check's findings name sentences copied exactly from the draft: [{sentence,problem,reason}].
export const validFindings=(findings,text)=>Array.isArray(findings)&&findings.length>0&&findings.every(f=>f&&typeof f.sentence==='string'&&f.sentence.trim()&&String(text).includes(f.sentence)&&FINDING_PROBLEMS.includes(f.problem));

const LINK=/https?:\/\/\S+/g;
// A rewritten sentence is used only when it is one plain line that keeps to the rules and brings
// no link the flagged sentence did not have.
function usableRewrite(replacement,sentence,voice){
 if(typeof replacement!=='string')return false;
 const text=replacement.trim(),known=new Set(sentence.match(LINK)||[]);
 return !!text&&!/[\r\n]/.test(text)&&text!==sentence.trim()&&!text.includes(EM_DASH)&&!ruleRefusals(text,voice,{skipOpener:true}).length&&(text.match(LINK)||[]).every(link=>known.has(link));
}

// Repairs only the flagged sentences (#387): a wording finding rewrites that sentence, or drops it
// when no usable rewrite comes back; only a core-unsupported finding takes its whole item.
// Items keep their numbers, on the item's first remaining line, so an exact supplied numbered list stays exact. A finding inside a line
// Godspeed requires word for word throws: the caller then falls back as before.
// rewrite(sentence,itemText,reason) resolves to the new sentence or ''.
export async function applyFindings(text,findings,{protectedLines=[],voice=null,rewrite}){
 const lines=text.split(/\r?\n/),keep=new Set(protectedLines.map(l=>l.trim()).filter(Boolean)),items=draftItems(text),changes=[];
 const cut=new Set();
 const itemOf=i=>items.find(item=>item.start<=i&&i<item.end);
 const itemText=item=>lines.slice(item.start,item.end).join('\n');
 for(const finding of [...findings].sort((a,b)=>(b.problem==='core-unsupported')-(a.problem==='core-unsupported'))){
  const at=lines.findIndex((line,i)=>!cut.has(i)&&line.includes(finding.sentence));
  if(at<0){if(lines.some((line,i)=>cut.has(i)&&line.includes(finding.sentence)))continue;throw Error('A flagged sentence is not on one line of the draft');}
  if(keep.has(lines[at].trim()))throw Error('A flagged sentence is in a line Godspeed requires word for word');
  const item=itemOf(at),first=lines[item.start].trim(),reason=String(finding.reason||'');
  if(finding.problem==='core-unsupported'){
   if(lines.slice(item.start,item.end).some(l=>keep.has(l.trim())))throw Error('A flagged item holds a line Godspeed requires word for word');
   for(let i=item.start;i<item.end;i++)cut.add(i);
   changes.push({action:'cut-item',item:first,sentence:finding.sentence,reason});continue;
  }
  const replacement=String(await rewrite(finding.sentence,itemText(item),reason)||'').trim();
  if(usableRewrite(replacement,finding.sentence,voice)){
   lines[at]=lines[at].replace(finding.sentence,()=>replacement);
   changes.push({action:'rewrite',item:first,sentence:finding.sentence,replacement,reason});continue;
  }
  lines[at]=lines[at].replace(finding.sentence,'').replace(/\s{2,}/g,' ').trimEnd();
  if(!lines[at].trim())cut.add(at);
  const emptied=lines.slice(item.start,item.end).every((l,i)=>!(i===0?l.replace(ITEM_MARKER,''):l).trim());
  changes.push({action:'drop-sentence',item:first,sentence:finding.sentence,reason,...(emptied?{item_emptied:true}:{})});
  if(emptied)for(let i=item.start;i<item.end;i++)cut.add(i);
 }
 for(const item of items){
  if(cut.has(item.start)||lines[item.start].replace(ITEM_MARKER,'').trim())continue;
  const next=lines.findIndex((l,i)=>i>item.start&&i<item.end&&!cut.has(i)&&l.trim());
  if(next<0)continue;
  lines[item.start]=lines[item.start].trimEnd()+' '+lines[next].trim();cut.add(next);
 }
 const out=[];
 for(const [i,line] of lines.entries()){if(cut.has(i)||line.trim()===''&&(!out.length||!out.at(-1).trim()))continue;if(line.trim()||out.length)out.push(line.trim()?line:'');}
 while(out.length&&!out.at(-1).trim())out.pop();
 return {text:out.join('\n'),changes};
}

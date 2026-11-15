export function checkVoice(text,profile,{longForm=false}={}){
 const block=profile.match(/```voice-rules\s*\n([\s\S]*?)```/)?.[1],rules=[],hits=[];
 if(!block)return {configured:false,passed:false,hits:[],reason:'No voice-rules block is configured in profile/voice.md'};
 for(const line of block.split(/\r?\n/)){
  const rule=line.match(/^(BANNED-CHAR|BANNED-PHRASE|BANNED-WORD|BANNED-OPENER|MAX-SENTENCE-WORDS):\s*(.*)$/);if(rule)rules.push({kind:rule[1],value:rule[1]==='BANNED-CHAR'?Array.from(rule[2].trim())[0]:rule[2].trim()});
 }
 if(!rules.length)return {configured:false,passed:false,hits:[],reason:'The configured voice-rules block contains no recognized rules'};
 let fenced=false;const prose=text.split(/\r?\n/).map((line,index)=>{if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;return {line:index+1,text:''};}return {line:index+1,text:fenced?'':line.replace(/`[^`]*`/g,'').replace(/https?:\/\/\S+/g,'')};});
 const first=prose.find(row=>row.text.trim())?.text.trim().toLowerCase()||'',escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const row of prose)for(const rule of rules){
  let match=false,advisory=false;
  if(rule.kind==='BANNED-CHAR')match=row.text.includes(rule.value);
  else if(rule.kind==='BANNED-PHRASE')match=row.text.toLowerCase().includes(rule.value.toLowerCase());
  else if(rule.kind==='BANNED-WORD')match=new RegExp('(?:^|[^\\p{L}\\p{N}_])'+escape(rule.value)+'(?:$|[^\\p{L}\\p{N}_])','iu').test(row.text);
  else if(rule.kind==='BANNED-OPENER')match=row.text.trim().toLowerCase()===first&&first.startsWith(rule.value.toLowerCase());
  else if(rule.kind==='MAX-SENTENCE-WORDS'){match=row.text.split(/(?<=[.!?])\s+/).some(s=>s.trim().split(/\s+/).filter(Boolean).length>Number(rule.value));advisory=longForm;}
  if(match)hits.push({line:row.line,rule:rule.kind,value:rule.value,advisory});
 }
 return {configured:true,passed:!hits.some(hit=>!hit.advisory),hits};
}

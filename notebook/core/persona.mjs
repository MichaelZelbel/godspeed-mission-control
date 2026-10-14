// THE PERSONA PARAGRAPH OF AGENTS.md: the one place an assistant's name and character are stated,
// between two markers (starter-godspeed/AGENTS.md, tools/test-persona-present.sh). The Identity page
// shows and changes only this paragraph of the manual (identity-shelf.mjs), and Hermes' own identity
// file is written from it (assistant-soul.mjs).
const lf=text=>String(text??'').replace(/\r\n?/g,'\n');
const noMarkers=()=>{const error=new Error('This manual has no marked "who it is" paragraph.');error.code='NO_MARKERS';throw error;};
export const PERSONA_BEGIN=/<!--\s*persona:begin[\s\S]*?-->/,PERSONA_END=/<!--\s*persona:end\s*-->/;
export const PERSONA_BEGIN_LINE='<!-- persona:begin - the only place this AI\'s name and character are stated. To rename it, tell it; it edits this paragraph. -->';
export const PERSONA_END_LINE='<!-- persona:end -->';
export const PLACEHOLDER='You are my personal AI.';

// The paragraph's place in `text`: where its inside starts and ends, the blank space around it,
// and the paragraph itself (core). Null without both markers.
export function personaParts(text){
  const b=PERSONA_BEGIN.exec(text);if(!b)return null;
  const from=b.index+b[0].length,e=PERSONA_END.exec(text.slice(from));if(!e)return null;
  const inner=text.slice(from,from+e.index),lead=inner.match(/^\s*/)[0],core=inner.slice(lead.length).replace(/\s+$/,''),trail=inner.slice(lead.length+core.length);
  return {start:from,end:from+e.index,lead,core,trail};
}
export function personaOf(text){const p=text===null||text===undefined?null:personaParts(text);return p?lf(p.core):null;}
export function withPersona(text,persona){
  const p=personaParts(text);if(!p)noMarkers();
  const eol=text.includes('\r\n')?'\r\n':'\n';
  return text.slice(0,p.start)+p.lead+lf(persona).trim().replace(/\n/g,eol)+p.trail+text.slice(p.end);
}
// Where the markers would go in a manual without them: around the first paragraph after its
// title when that paragraph says who the assistant is ("You are ..."), else around a new one.
export function markedManual(text){
  if(personaParts(text))return {text,persona:personaOf(text),wrapped:true};
  const eol=text.includes('\r\n')?'\r\n':'\n',lines=text.split(/\r?\n/);
  let at=0;while(at<lines.length&&!lines[at].trim())at++;
  const titled=at<lines.length&&/^#\s/.test(lines[at]);const after=titled?at+1:at;
  let p=after;while(p<lines.length&&!lines[p].trim())p++;
  let end=p;while(end<lines.length&&lines[end].trim())end++;
  const paragraph=lines.slice(p,end);
  if(paragraph.length&&/^you are\b/i.test(paragraph[0].trim())&&!paragraph.some(l=>l.includes('<!--'))){
    const next=[...lines.slice(0,p),PERSONA_BEGIN_LINE,...paragraph,PERSONA_END_LINE,...lines.slice(end)].join(eol);
    return {text:next,persona:paragraph.join('\n'),wrapped:true};
  }
  const next=[...lines.slice(0,after),'',PERSONA_BEGIN_LINE,PLACEHOLDER,PERSONA_END_LINE,...lines.slice(after)].join(eol);
  return {text:next,persona:PLACEHOLDER,wrapped:false};
}
// The manual without its markers (an undo of marking it): a paragraph the marking added goes too.
export function unmarkedManual(text){
  const p=personaParts(text);if(!p)return text;
  const b=PERSONA_BEGIN.exec(text),e=PERSONA_END.exec(text.slice(p.end)),eol=text.includes('\r\n')?'\r\n':'\n';
  const before=text.slice(0,b.index),after=text.slice(p.end+e.index+e[0].length);
  if(lf(p.core)===PLACEHOLDER)return before.replace(new RegExp('(?:'+eol+')?$'),'')+after.replace(new RegExp('^'+eol),'');
  return before+lf(p.core).replace(/\n/g,eol)+after;
}

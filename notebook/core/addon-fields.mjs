import fs from 'node:fs';
import path from 'node:path';

// A BOUND FIELD OF AN ADD-ON'S PAGE (#1182). A `text` or `list` part is bound to one section of one
// note: the lines under a heading, up to the next heading of the same or a higher level. The
// notebook, never the add-on's request, says which note; it must be a note record under notebook/.
// A write goes through the records path (writer lock, history, changes log, sync pick-up) and
// replaces only that section of the note as it is now, so edits elsewhere in the note are kept. A
// section that changed since the page loaded it is never overwritten: nothing is written, both texts
// are kept (the newer one in the answer, the person's in the stale-write pile).
const headingLine=/^(#{1,6})\s+(.*?)\s*#*\s*$/;

function sectionRange(lines,title){
  const start=lines.findIndex(l=>{const m=headingLine.exec(l);return m&&m[2]===title;});
  if(start<0)return null;
  const level=headingLine.exec(lines[start])[1].length;
  let end=lines.length;
  for(let i=start+1;i<lines.length;i++){const m=headingLine.exec(lines[i]);if(m&&m[1].length<=level){end=i;break;}}
  return {start,end};
}

export function readSection(content,title){
  const lines=String(content??'').split('\n'),range=sectionRange(lines,title);
  return range?lines.slice(range.start+1,range.end).join('\n').trim():'';
}

export function writeSection(content,title,text){
  const lines=String(content??'').split('\n'),range=sectionRange(lines,title),body=text.trim()?['',...text.trim().split('\n'),'']:[''];
  if(!range)return [...lines.join('\n').replace(/\s+$/,'').split('\n').filter((l,i,a)=>a.length>1||l),'','## '+title,...body].join('\n').replace(/^\n+/,'');
  return [...lines.slice(0,range.start+1),...body,...lines.slice(range.end)].join('\n');
}

// A list is its bullets: "- one" per line. The page edits items; the note keeps them as bullets.
export const listItems=text=>text.split('\n').map(l=>l.replace(/^\s*[-*]\s+/,'').trim()).filter(Boolean);
export const listText=items=>items.map(i=>'- '+String(i).replace(/\s+/g,' ').trim()).filter(l=>l!=='- ').join('\n');

const plain=(message,extra={})=>Object.assign(new Error(message),extra);

// The note record a bind names, or an error with one plain sentence. The path is relative to notebook/.
export function noteOf(store,bindNote){
  store.read();
  const relative=String(bindNote);
  if(!relative||relative.includes('\\')||relative.includes('\0')||path.posix.isAbsolute(relative)||path.posix.normalize(relative).split('/').includes('..'))throw plain('That page points outside the notebook.',{status:400});
  const file=path.join(store.recordsRoot,...path.posix.normalize(relative).split('/'));
  let real;try{real=fs.realpathSync(file);if(fs.lstatSync(file).isSymbolicLink())throw 0;}catch{throw plain('The note this page keeps its text in is not there.',{status:404});}
  if(!real.startsWith(fs.realpathSync(store.recordsRoot)+path.sep))throw plain('That page points outside the notebook.',{status:400});
  const key=store.keyOfFile.get(file)||store.keyOfFile.get(real);
  if(!key?.startsWith('notes/'))throw plain('The note this page keeps its text in is not there.',{status:404});
  return store.get('notes',key.slice('notes/'.length));
}

export function readField(store,bind){return readSection(noteOf(store,bind.note).content,bind.section);}

// {state:'saved',value} or {state:'conflict',current} (nothing written). `base` is the section the page loaded.
export async function writeField(store,bind,{value,base}){
  if(typeof value!=='string'||typeof base!=='string')throw plain('Send the new text and the text it started from.',{status:400});
  if(value.split('\n').some(l=>headingLine.test(l)))throw plain('A line that starts with # would split this section, so the page could not show it again. Start that line with something else.',{status:400});
  return store.withLockAsync(()=>{
    const id=noteOf(store,bind.note).id;
    store.freshen([store.fileOf.get('notes/'+id)]);
    return writeUnder(store,bind,value,base,noteOf(store,bind.note));
  });
}

function writeUnder(store,bind,value,base,note){
  const current=readSection(note.content,bind.section);
  if(current!==base.trim()&&current!==value.trim()){
    try{store.conflict('notes',{...note,content:writeSection(note.content,bind.section,value)},note);}catch(error){if(error.code!=='CONFLICT')throw error;}
    return {state:'conflict',current};
  }
  if(current!==value.trim())store.saveUnderLock('notes',{...note,content:writeSection(note.content,bind.section,value)},note._hash);
  return {state:'saved',value:value.trim()};
}

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {hash} from './records/store.mjs';
import {durable,windowsInvalid} from './file-policy.mjs';
import {newFindings} from './context-scan.mjs';
import {ShelfHistory,COMMIT_PREFIX} from './identity-history.mjs';
import {readSoul,syncSoul} from './assistant-soul.mjs';
import {normalized} from './packaged-skills.mjs';

// THE IDENTITY PAGE: THE FILES THAT MAKE THIS MISSION CONTROL BEHAVE AS IT DOES.
//
// Four parts, each a set of files in the mission control folder, seen and changed in the notebook
// (and by the assistant through the same path, MCP identity_files):
//
//   who      the persona paragraph of AGENTS.md, between its persona markers, and nothing else
//            of that file; Hermes' own identity file (SOUL.md) follows it (assistant-soul.mjs)
//   rule:x   rules/x.md; the one-line list of rules in AGENTS.md (mc-compile-rules,
//            tools/compile-rules.js) is brought up to date in the same change. A rule's short
//            name is its own `title:` (ruleName), never its `description:`
//   profile:x  profile/x.md
//   skill:x  skills/x/SKILL.md; a skill the package keeps up to date stays the person's once they
//            change it (packaged-skills.mjs keeps an edited skill and offers the update for review)
//
// The page numbers rules, profile pages and skills (overview), and the chat on the page is given
// the same numbers (chatContext), so "change rule 13" means the rule the page shows as 13, and the
// rules read before every job carry the numbers AGENTS.md gives them.
//
// What the page shows must save: a field the person did not change is never refused for its
// length or form, and never written (rulePlan).
//
// Only those paths: a target names one by a narrow pattern, every folder on the way must be a
// real folder (not a link) inside the workspace, the file a regular file. Every change is written
// through the workspace's transaction writer under its lock, and kept as a version of its own
// with a message saying what changed (identity-history.mjs); undo and restore are new changes
// that bring an older text back. A file with two versions waiting in Settings > Review
// conflicting edits is not changed here until that review is settled.
const require=createRequire(import.meta.url);
let compiler=null;try{compiler=require(fileURLToPath(new URL('../../tools/compile-rules.js',import.meta.url)));}catch{}

export const MANUAL='AGENTS.md';
// What the page calls AGENTS.md: "manual" meant nothing to the owner (16 October 2026).
const MAIN='your assistant\'s main instructions (AGENTS.md)';
// Hermes cuts a context file past 20,000 characters (it keeps the start and the end and drops the
// middle: prompt_builder.py CONTEXT_FILE_MAX_CHARS); the starter's manual asks to stay under 19,000.
export const MANUAL_LIMIT=20000,MANUAL_WARN=19000;
// A rule's short name: a few words, so the owner can find it among fifty.
export const NAME_LIMIT=60;
import {PERSONA_BEGIN_LINE,PERSONA_END_LINE,personaParts,personaOf,withPersona,markedManual,unmarkedManual} from './persona.mjs';
export {PERSONA_BEGIN_LINE,PERSONA_END_LINE,personaParts,personaOf,withPersona,markedManual,unmarkedManual};
const SLUG=/^[a-z0-9][a-z0-9._-]{0,99}$/,NAME=/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
const chars=text=>[...String(text??'')].length;
const lf=text=>String(text??'').replace(/\r\n?/g,'\n');
export class ShelfError extends Error{constructor(message,code,extra={}){super(message);this.code=code;Object.assign(this,extra);}}
const refuse=(message,code='REFUSED',extra)=>{throw new ShelfError(message,code,extra);};

// ---- Headers (the lines between the two --- at the top of a rule or recipe) -------------------
export function splitFront(text){
  const m=/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m?{front:m[1],head:m[0],body:text.slice(m[0].length)}:{front:null,head:'',body:text};
}
// Read as tools/compile-rules.js reads it: `key: value`, a value in double quotes unquoted.
// A value YAML writes over the indented lines below its key (`key: >`) is read as one line.
export function readFront(front){
  const out={},lines=String(front||'').split(/\r?\n/);
  for(let i=0;i<lines.length;i++){const m=/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/.exec(lines[i]);if(!m)continue;let v=m[2].trim();
    if(/^[>|][+-]?$/.test(v)){const parts=[];while(i+1<lines.length&&/^[ \t]+\S/.test(lines[i+1]))parts.push(lines[++i].trim());v=parts.join(v.startsWith('|')?'\n':' ');}
    else if(v.length>1&&v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1).replace(/\\"/g,'"');
    out[m[1]]=v;}
  return out;
}
const quoted=value=>'"'+String(value).replace(/"/g,'\\"')+'"';
// Changes the given keys in place, keeps every other line as it was, adds new keys at the end.
export function setFront(text,updates,{quote=quoted}={}){
  const eol=text.includes('\r\n')?'\r\n':'\n',{front,body}=splitFront(text);
  const lines=front===null?[]:front.split(/\r?\n/),done=new Set();
  for(let i=0;i<lines.length;i++){const m=/^([a-zA-Z_][a-zA-Z0-9_]*):/.exec(lines[i]);if(m&&Object.hasOwn(updates,m[1])&&!done.has(m[1])){
    // A line that already says this is left exactly as it is written.
    const multi=i+1<lines.length&&/^[ \t]+\S/.test(lines[i+1]);if(!multi&&readFront(lines[i])[m[1]]===String(updates[m[1]])){done.add(m[1]);continue;}
    lines[i]=m[1]+': '+quote(updates[m[1]]);done.add(m[1]);
    // A value written over several lines (YAML's folded or indented forms) goes with its key.
    while(i+1<lines.length&&/^[ \t]+\S/.test(lines[i+1]))lines.splice(i+1,1);}}
  for(const [key,value] of Object.entries(updates))if(!done.has(key))lines.push(key+': '+quote(value));
  return '---'+eol+lines.join(eol)+eol+'---'+eol+(front===null?body.replace(/^\r?\n?/,''):body);
}
const oneLine=value=>String(value??'').replace(/\s*\r?\n\s*/g,' ').trim();
// A skill's description is read as YAML by the assistants: written as YAML's double-quoted text.
const yamlQuoted=value=>'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';

// ---- Names in words --------------------------------------------------------------------------
// "never-spend-my-money" -> "Never spend my money"; "merged:finish-the-whole-task" -> "Merged: finish
// the whole task". A hyphen between digits stays, so a date reads as a date.
export function inWords(value){
  const w=String(value??'').replace(/:\s*/g,': ').replace(/(?<=[\p{L}\d])[-_.]+(?=\p{L})|(?<=\p{L})[-_.]+(?=\d)/gu,' ').replace(/\s+/g,' ').trim();
  return w.charAt(0).toUpperCase()+w.slice(1);
}
// The first words of a sentence, at most `max` characters, marked as cut when they are.
export function firstWords(text,max=40){
  const plain=oneLine(text).replace(/[`*]/g,'');let out='';
  for(const word of plain.split(' ').filter(Boolean)){const next=out?out+' '+word:word;if(chars(next)>max)break;out=next;}
  if(!out)return [...plain].slice(0,max).join('');
  return out===plain?out:out.replace(/[,;:.!?]+$/,'')+'…';
}
// A rule's short name: its own `title:`; else its file name in words, when that is short; else the
// first words of its sentence. Never its `description:`: in an owner's own files that is often a
// long summary written for another program, and until 16 October 2026 the page showed it as the
// name and refused to save a rule whose untouched description was long ("Keep the rule's name
// short", on a rule where only "Read before every job" had been switched).
export function ruleName(slug,h){
  const own=oneLine(h.title);if(own)return own;
  const words=inWords(slug);if(chars(words)<=40)return words;
  return firstWords(h.line||words,40);
}
// Where a rule that is not read before every job is read, in the page's words, and the order of
// those groups on the page: the companies, each skill, when its subject comes up, then the rest.
export function placeOf(where){
  const w=String(where??'').trim();
  if(w==='company'||w==='companies')return {key:'company',label:'For the companies',rank:0};
  const skill=/^skill:\s*(.+)$/.exec(w);if(skill)return {key:'skill:'+skill[1],label:'For the skill '+inWords(skill[1]).toLowerCase(),rank:1};
  if(['','search','when-it-matters','when-needed'].includes(w))return {key:'when-it-matters',label:'When its subject comes up',rank:2};
  return {key:w,label:inWords(w),rank:3};
}

export class IdentityShelf{
  constructor(store,{assistantHome=()=>null,now=()=>new Date(),recentWindowMs=20*60*1000}={}){
    this.store=store;this.root=store.root;this.assistantHome=assistantHome;this.now=now;this.recentWindowMs=recentWindowMs;this.history=new ShelfHistory(store);
  }
  // ---- Paths --------------------------------------------------------------------------------
  target(target){
    const t=String(target??'');
    if(t==='who')return {kind:'who',target:t,file:MANUAL,label:'who it is'};
    const m=/^(rule|profile|skill):(.+)$/.exec(t);if(!m)refuse('Choose a part of this page: who it is, a rule, a profile page or a skill.','UNKNOWN_TARGET');
    const [,kind,name]=m;
    if(name.includes('..')||windowsInvalid(name)||!(kind==='rule'?SLUG:NAME).test(name)||kind==='rule'&&['readme','memory'].includes(name.toLowerCase()))refuse('That is not one of the files this page shows.','UNKNOWN_TARGET');
    const file=kind==='rule'?'rules/'+name+'.md':kind==='profile'?'profile/'+name+'.md':'skills/'+name+'/SKILL.md';
    return {kind,target:t,name,file,label:kind==='rule'?'the rule "'+name+'"':kind==='profile'?file:'the skill "'+name+'"'};
  }
  // The absolute path of a workspace file, refusing links and anything outside the workspace.
  // missing: whether the file itself may be absent (a new rule, a removed one brought back).
  safePath(relative,{missing=false}={}){
    if(!durable(relative))refuse('That is not one of the files this page shows.','UNKNOWN_TARGET');
    const parts=relative.split('/');let at=this.root;
    const realRoot=fs.realpathSync(this.root);
    for(const part of parts.slice(0,-1)){
      at=path.join(at,part);let stat=null;try{stat=fs.lstatSync(at);}catch{}
      if(!stat){if(missing)continue;refuse('This file is missing.','MISSING',{status:404});}
      if(stat.isSymbolicLink()||!stat.isDirectory())refuse('This folder leads outside your mission control, so it is not changed here.','LINKED');
    }
    const file=path.join(this.root,...parts);let stat=null;try{stat=fs.lstatSync(file);}catch{}
    if(!stat&&!missing)refuse('This file is missing.','MISSING',{status:404});
    if(stat&&(stat.isSymbolicLink()||!stat.isFile()))refuse('This file leads outside your mission control, so it is not changed here.','LINKED');
    let real=path.dirname(file);while(!fs.existsSync(real))real=path.dirname(real);real=fs.realpathSync(real);
    if(real!==realRoot&&!real.startsWith(realRoot+path.sep))refuse('This file leads outside your mission control, so it is not changed here.','LINKED');
    return file;
  }
  readBytes(relative){const file=this.safePath(relative,{missing:true});try{return fs.readFileSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  readText(relative){const bytes=this.readBytes(relative);return bytes===null?null:bytes.toString('utf8');}
  realFolder(relative){const dir=path.join(this.root,relative);let stat=null;try{stat=fs.lstatSync(dir);}catch{}return !!stat&&stat.isDirectory()&&!stat.isSymbolicLink();}
  // ---- What the page lists --------------------------------------------------------------------
  ruleNames(){return this.realFolder('rules')?fs.readdirSync(path.join(this.root,'rules'),{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.md')&&!['README.md','MEMORY.md'].includes(e.name)&&SLUG.test(e.name.slice(0,-3))).map(e=>e.name.slice(0,-3)).sort():[];}
  profileNames(){return this.realFolder('profile')?fs.readdirSync(path.join(this.root,'profile'),{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.md')&&NAME.test(e.name.slice(0,-3))&&!windowsInvalid(e.name)).map(e=>e.name.slice(0,-3)).sort():[];}
  skillNames(){
    if(!this.realFolder('skills'))return [];
    return fs.readdirSync(path.join(this.root,'skills'),{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.name.startsWith('.')&&NAME.test(e.name)&&!windowsInvalid(e.name)).map(e=>e.name)
      .filter(name=>{try{const s=fs.lstatSync(path.join(this.root,'skills',name,'SKILL.md'));return s.isFile()&&!s.isSymbolicLink();}catch{return false;}}).sort();
  }
  // Paths with two versions waiting for the owner's review (conflicts/, Settings).
  waitingReviews(){
    const dir=path.join(this.root,'conflicts');if(!fs.existsSync(dir))return new Set();
    const out=new Set();for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.json'))){try{const c=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));if(!c.resolved_at&&typeof c.path==='string')out.add(c.path);}catch{}}return out;
  }
  // ---- Reading one part -------------------------------------------------------------------------
  view(t,text){
    if(text===null)return null;
    if(t.kind==='who')return personaOf(text);
    if(t.kind==='rule')return this.ruleFields(t.name,text);
    if(t.kind==='skill'){const {front,body}=splitFront(text),h=readFront(front);return {name:h.name||t.name,description:h.description||'',steps:lf(body).replace(/^\n+/,'')};}
    const {front,body}=splitFront(text);return {text:lf(body).replace(/^\n+/,''),kept_details:front!==null};
  }
  ruleFields(slug,text){
    const {front,body}=splitFront(text),h=readFront(front);
    return {slug,title:ruleName(slug,h),line:oneLine(h.line),group:['must','never','how'].includes(h.group)?h.group:'how',always:h.where===undefined||h.where==='always',where:h.where===undefined?'always':String(h.where),story:lf(body).replace(/^\n+/,'')};
  }
  viewText(t,view){return view===null?null:typeof view==='string'?view:JSON.stringify(view);}
  // kept_under: a list of rules kept by the owner's own program keeps the file under 19,000 (checkManual).
  manualInfo(text){return {exists:text!==null,chars:chars(text||''),limit:MANUAL_LIMIT,warn:MANUAL_WARN,kept_under:this.rulesKeeper(text)?MANUAL_WARN:null};}
  skillOrigin(name,bytes){
    let ledger={},known={};
    try{ledger=JSON.parse(fs.readFileSync(path.join(this.store.state,'packaged-skills.json'),'utf8'));}catch{}
    try{known=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/recipe-revisions.json',import.meta.url)),'utf8'));}catch{}
    const digest=normalized(bytes),key=hash(path.join(this.root,'skills',name,'SKILL.md')),revisions=known[name+'/SKILL.md']||[];
    if(ledger[key]===digest||revisions.includes(digest))return 'shipped';
    return ledger[key]!==undefined||revisions.length?'changed':'own';
  }
  read(target){
    const t=this.target(target),text=this.readText(t.file),waiting=this.waitingReviews();
    if(t.kind==='who'){
      if(text===null)return {...t,state:'no-manual',manual:this.manualInfo(null)};
      const persona=personaOf(text);
      if(persona===null)return {...t,state:'no-markers',proposal:markedManual(text).persona,manual:this.manualInfo(text),review_waiting:waiting.has(MANUAL)};
      return {...t,state:'ok',text:persona,hash:hash(persona),manual:this.manualInfo(text),soul:this.soulInfo(),review_waiting:waiting.has(MANUAL)};
    }
    if(text===null)refuse('This file is missing.','MISSING',{status:404});
    this.safePath(t.file);
    return {...t,state:'ok',fields:this.view(t,text),hash:hash(Buffer.from(text,'utf8')),review_waiting:waiting.has(t.file)||t.kind==='rule'&&waiting.has(MANUAL),
      ...(t.kind==='rule'?{manual:this.manualInfo(this.readText(MANUAL))}:{}),...(t.kind==='skill'?{origin:this.skillOrigin(t.name,Buffer.from(text,'utf8'))}:{})};
  }
  soulInfo(){const home=this.assistantHome(),soul=readSoul(home);return {kind:soul.kind,...(soul.kind==='own'&&soul.text!==null?{text:soul.text}:{})};}
  rulesState(manual){
    if(!compiler)return 'unavailable';if(manual===null)return 'no-manual';
    if(manual.indexOf(compiler.BEGIN)===-1||manual.indexOf(compiler.END)===-1)return 'no-place';
    const result=this.compiled(manual,new Map());if(result.problem)return 'problem';if(result.next===manual)return 'ok';
    return this.rulesKeeper(manual)?'kept-elsewhere':'out-of-step';
  }
  // The program that keeps the list of rules, when it is not this kit's own: the opening line of the
  // list names it ("compiled from rules/ by dev/godspeed-engine/scripts/compile-rules.py"). Null for
  // the kit's own list (mc-compile-rules), for a list whose opening line names no program, and for a
  // manual without a list.
  rulesKeeper(manual){
    if(!compiler||manual===null||manual===undefined)return null;
    const i=manual.indexOf(compiler.BEGIN),close=i===-1?-1:manual.indexOf('-->',i);if(close===-1)return null;
    const line=manual.slice(i+compiler.BEGIN.length,close);if(/\bmc-compile-rules\b/.test(line))return null;
    const named=/\bby\s+(\S+?)[.,;:]?(?=\s|$)/.exec(line);
    return named?{program:named[1]}:null;
  }
  // Everything the page shows, numbered. Rules come in the order the page lists them: first the
  // ones read before every job, with the numbers AGENTS.md gives them (ruleNumbers), then the rest
  // grouped by where they are read (placeOf), numbered on. Profile pages and skills are numbered
  // 1, 2, 3 in their own lists.
  overview(){
    const manual=this.readText(MANUAL),waiting=this.waitingReviews();
    const persona=manual===null?null:personaOf(manual);
    const who=manual===null?{state:'no-manual'}:persona===null?{state:'no-markers',proposal:markedManual(manual).persona}:{state:'ok',text:persona,hash:hash(persona)};
    const read=this.ruleNames().map(slug=>{try{const text=this.readText('rules/'+slug+'.md');return {text,rule:{target:'rule:'+slug,...this.ruleFields(slug,text),story:undefined,review_waiting:waiting.has('rules/'+slug+'.md')}};}catch{return null;}}).filter(Boolean);
    const numbers=this.ruleNumbers(manual,read);
    const rules=read.map(({rule})=>({...rule,n:numbers.get(rule.slug),...(rule.always?{}:{place:(({key,label})=>({key,label}))(placeOf(rule.where))})})).sort((a,b)=>a.n-b.n);
    const profile=this.profileNames().map(name=>{try{const text=this.readText('profile/'+name+'.md'),body=lf(splitFront(text).body),title=(body.match(/^#\s+(.+)$/m)||[])[1]||inWords(name);return {target:'profile:'+name,name,title:oneLine(title),preview:body.replace(/^#.*$/gm,'').replace(/<!--[\s\S]*?-->/g,'').trim().split('\n').find(Boolean)?.slice(0,160)||'',review_waiting:waiting.has('profile/'+name+'.md')};}catch{return null;}}).filter(Boolean).map((p,i)=>({n:i+1,...p}));
    const skills=this.skillNames().map(name=>{try{const bytes=this.readBytes('skills/'+name+'/SKILL.md'),h=readFront(splitFront(bytes.toString('utf8')).front);return {target:'skill:'+name,name,title:inWords(h.name||name),description:h.description||'',origin:this.skillOrigin(name,bytes),review_waiting:waiting.has('skills/'+name+'/SKILL.md')};}catch{return null;}}).filter(Boolean).map((k,i)=>({n:i+1,...k}));
    return {manual:{...this.manualInfo(manual),review_waiting:waiting.has(MANUAL),rules_list:this.rulesState(manual),rules_program:this.rulesKeeper(manual)?.program??null},who,soul:this.soulInfo(),rules,profile,skills};
  }
  // slug -> number. The rules read before every job keep the number the list in AGENTS.md gives
  // them (the compiler reads it back, compile-rules.js listed): that list is what the assistant
  // reads, and where it is up to date it is exactly the compiler's own order (numbered). A rule
  // the list does not carry yet follows in the compiler's order. The rules read only when their
  // subject comes up are numbered on, group by group in the page's order, by file name inside one.
  ruleNumbers(manual,read){
    const out=new Map(),always=read.filter(r=>r.rule.always),rest=read.filter(r=>!r.rule.always);
    const listed=compiler&&manual!==null?compiler.listed(manual):new Map();let last=0;
    for(const {rule} of always)if(listed.has(rule.slug)){out.set(rule.slug,listed.get(rule.slug));last=Math.max(last,listed.get(rule.slug));}
    const order=compiler?compiler.numbered(always.map(r=>({name:r.rule.slug+'.md',text:r.text})),{keepFrame:true}).rules.map(r=>r.slug):[];
    for(const slug of [...order,...always.map(r=>r.rule.slug)])if(!out.has(slug))out.set(slug,++last);
    const placed=rest.map(r=>({slug:r.rule.slug,place:placeOf(r.rule.where)})).sort((a,b)=>a.place.rank-b.place.rank||a.place.label.localeCompare(b.place.label)||a.slug.localeCompare(b.slug));
    for(const {slug} of placed)out.set(slug,++last);
    return out;
  }
  // What the chat on the page is told with every message: that the owner has the page open, and
  // the numbers it shows, so "change rule 13" reaches the rule shown as 13. detail adds each
  // rule's sentence and "who it is", for an assistant without tools to read them (domains.mjs).
  chatContext({label,detail=false}={}){
    const o=this.overview(),name=oneLine(label).slice(0,40),always=o.rules.filter(r=>r.always),rest=o.rules.filter(r=>!r.always);
    const said=r=>detail&&r.line?' Now: "'+r.line+'"':'';
    const lines=['The owner has the notebook page '+(name?'"'+name+'" ':'')+'open that shows who you are, your rules, what you know about them and your skills, numbered as below. When they name one by its number ("rule 13", "profile page 2", "skill 4"), they mean the one with that number here. Change these only with the identity_files tool, as that page does: read the part first, then change it with its expected_hash and their words. Never change these files with file tools.',
      'Who you are: target "who".'+(detail&&o.who.text?' Now: "'+oneLine(o.who.text)+'"':'')];
    if(always.length)lines.push('Rules read before every job, numbered as in AGENTS.md:',...always.map(r=>r.n+'. '+r.title+' ('+r.target+')'+said(r)));
    if(rest.length)lines.push('Rules read only when their subject comes up:',...rest.map(r=>r.n+'. '+r.title+' ('+r.target+'; '+r.place.label.toLowerCase()+')'+said(r)));
    if(o.profile.length)lines.push('Profile pages:',...o.profile.map(p=>p.n+'. '+p.title+' ('+p.target+')'));
    if(o.skills.length)lines.push('Skills:',...o.skills.map(k=>k.n+'. '+k.title+' ('+k.target+')'));
    return lines.join('\n');
  }
  // A cheap sign of whether any file the page shows changed: the chat compares it before and after
  // a reply, so the page shows what the assistant changed (domains.mjs).
  fingerprint(){
    const files=[MANUAL,...this.ruleNames().map(s=>'rules/'+s+'.md'),...this.profileNames().map(n=>'profile/'+n+'.md'),...this.skillNames().map(n=>'skills/'+n+'/SKILL.md')];
    return hash(files.map(f=>{try{const s=fs.statSync(path.join(this.root,f));return f+':'+s.size+':'+s.mtimeMs;}catch{return f+':-';}}).join('\n'));
  }
  // ---- The list of rules in AGENTS.md ---------------------------------------------------------
  // What AGENTS.md becomes with the rule files as they would be after `changes` (slug -> text or
  // null). The block keeps the opening line and closing paragraph it has, and a block already
  // longer than the compiler's limit may stay as long as it is, never longer.
  //
  // A list kept by a program of the owner's (rulesKeeper) is changed here only while this page
  // writes it exactly as it stands: the list compiled from the rule files as they are now must be
  // the manual's list to the byte. Then a changed rule changes one line of it the way that
  // program would. A list that program writes otherwise (its own headings, numbering or order, a
  // field it reads another way) or one that is behind its rule files is left to that program, and
  // the change is refused before anything is written (15 October 2026: Michael's own mission
  // control keeps its list with dev/godspeed-engine/scripts/compile-rules.py, and his push is
  // refused when the list is not what that program writes).
  gather(manual,changes){
    const keeper=this.rulesKeeper(manual);
    if(keeper){const now=this.compiled(manual,new Map());if(!now.problem&&!now.empty&&!now.noPlace&&now.next!==manual){const program=keeper.program||'a program of your own';
      return {problem:'The list of rules in '+MAIN+' is kept by '+program+', and it is not the list this page would write from your rules, so rules are not changed here. Change the rule file in rules/ and run '+program+'.',code:'RULES_KEPT_ELSEWHERE'};}}
    return this.compiled(manual,changes);
  }
  compiled(manual,changes){
    if(!compiler)return {problem:'The program that keeps the list of rules is missing from this installation.'};
    const files=new Map(this.ruleNames().map(slug=>[slug,this.readText('rules/'+slug+'.md')]));
    for(const [slug,text] of changes){if(text===null)files.delete(slug);else files.set(slug,text);}
    const i=manual.indexOf(compiler.BEGIN),j=manual.indexOf(compiler.END),ceiling=i>=0&&j>i?j+compiler.END.length-i+1:0;
    const result=compiler.compileText({files:[...files].map(([slug,text])=>({name:slug+'.md',text})),agentsText:manual,keepFrame:true,ceiling});
    if(result.problems?.length)return {problem:result.problems[0].replace(/`/g,'')};
    if(result.tooLong)return {problem:'The list of rules your assistant reads before every job would be '+result.tooLong.size+' characters, and it may be at most '+Math.max(result.tooLong.limit,ceiling)+'. Shorten a rule\'s sentence, or merge two rules that say the same thing. The longest now: '+result.tooLong.longest.map(r=>r.slug+' ('+r.chars+')').join(', ')+'.',code:'RULES_TOO_LONG'};
    if(result.empty)return {next:manual,empty:true};
    if(result.noMarkers)return {next:manual,noPlace:true};
    return {next:result.next};
  }
  // ---- Checks every change to AGENTS.md passes ----------------------------------------------------
  checkManual(before,after){
    const now=chars(after),was=chars(before||''),keeper=this.rulesKeeper(before);
    // A manual whose list of rules a program of the owner's keeps stays under the line such a
    // program keeps it under: Michael's compile-rules.py refuses a manual past 19,000 characters,
    // and his push with it (runtime-limits.json, "warn").
    if(keeper&&now>MANUAL_WARN&&now>was)refuse('This would make '+MAIN+' '+now.toLocaleString('en')+' characters long. Your list of rules is kept by '+(keeper.program||'a program of your own')+', and this page keeps a file like that under '+MANUAL_WARN.toLocaleString('en')+'. Make something shorter first.','MANUAL_TOO_LONG',{manual:{chars:now,limit:MANUAL_WARN}});
    if(now>=MANUAL_LIMIT&&now>was)refuse('This would make '+MAIN+' '+now.toLocaleString('en')+' characters long. Your assistant\'s program reads only '+MANUAL_LIMIT.toLocaleString('en')+' and drops the middle of a longer one. Make something shorter first.','MANUAL_TOO_LONG',{manual:{chars:now,limit:MANUAL_LIMIT}});
    const found=newFindings(before||'',after);
    if(found.length)refuse('Your assistant\'s program would refuse to read all of '+MAIN+' with "'+found[0].words+'" in it, because those words look like an attempt to take over an assistant. Please say it another way.','LOOKS_LIKE_TAKEOVER',{findings:found});
    return {chars:now,limit:MANUAL_LIMIT,warn:MANUAL_WARN,...(now>=MANUAL_WARN?{warning:'Your assistant reads its main instructions (AGENTS.md) in full before every job, and they are now '+now.toLocaleString('en')+' characters long. Short enough for you to read all of it? Its program stops at '+MANUAL_LIMIT.toLocaleString('en')+'.'}:{})};
  }
  // ---- Writing ----------------------------------------------------------------------------------
  // One change: plan(current) returns {writes: [{file, text|null}], message}; everything it writes
  // is published together, then committed as one version. Runs under the workspace lock.
  async change(t,plan,{expected_hash,by='notebook',words}={}){
    let outcome;
    const result=await this.store.withLockAsync(()=>{
      let current;try{current=this.read(t.target);}catch(error){if(error.code==='MISSING'&&t.missingOk)current={...t,state:'missing',hash:null};else throw error;}
      if(expected_hash!==undefined&&expected_hash!==current.hash)refuse('This changed since you opened it. Open it again to see the newest version.','CHANGED',{status:409});
      const waiting=this.waitingReviews();
      const {writes,message,extra={}}=plan(current);
      for(const w of writes)if(waiting.has(w.file))refuse('Two versions of '+(w.file===MANUAL?MAIN:w.file)+' are waiting for you in Settings, under Review conflicting edits. Settle that first, then change it here.','REVIEW_WAITING',{status:409});
      const before=new Map(writes.map(w=>[w.file,this.readBytes(w.file)]));
      for(const w of writes)this.safePath(w.file,{missing:true});
      const manualWrite=writes.find(w=>w.file===MANUAL),manual=manualWrite?this.checkManual(before.get(MANUAL)?.toString('utf8')??'',manualWrite.text??''):null;
      const changed=writes.filter(w=>{const old=before.get(w.file);return w.text===null?old!==null:old===null||!old.equals(Buffer.from(w.text,'utf8'));});
      if(!changed.length){outcome={unchanged:true};return {saved:true,unchanged:true,...extra};}
      this.store.publishFiles(changed.map(w=>w.text===null?{file:w.file,delete:true}:{file:w.file,text:w.text}));
      // What is on disk now is what is reported, never what was meant to be written.
      const after=new Map(changed.map(w=>[w.file,this.readBytes(w.file)]));
      for(const w of changed){const got=after.get(w.file);if(w.text===null?got!==null:got===null||!got.equals(Buffer.from(w.text,'utf8')))throw Error('The saved file does not hold the change');}
      const fullMessage=COMMIT_PREFIX+message+(by==='assistant'?' (asked in chat)':'');
      let recorded;try{recorded=this.history.record(changed.map(w=>({file:w.file,before:before.get(w.file),after:after.get(w.file)})),fullMessage,{body:words?'Asked in chat: '+oneLine(words).slice(0,500):undefined});}
      catch(error){recorded={commit:null,note:String(error.message).split('\n')[0]};}
      outcome={manualChanged:changed.some(w=>w.file===MANUAL)};
      return {saved:true,message:fullMessage,files:changed.map(w=>w.file),recorded:{where:recorded.kind||null,commit:recorded.commit||null,...(recorded.note?{note:recorded.note}:{})},...(manual?{manual}:{}),...extra};
    },{timeoutMs:30000});
    if(outcome?.manualChanged)result.soul=this.followPersona();
    // What the part holds now, read back from disk.
    try{const now=this.read(t.target);result.now=now.kind==='who'?{text:now.text,hash:now.hash,state:now.state}:{fields:now.fields,hash:now.hash};}catch(error){if(error.code==='MISSING')result.now={removed:true};else throw error;}
    return result;
  }
  // Hermes' identity file follows "who it is", unless its owner wrote their own (assistant-soul.mjs).
  followPersona({take=false}={}){
    const home=this.assistantHome();if(!home)return {kind:'no-assistant',written:false};
    try{const persona=personaOf(this.readText(MANUAL)||'');if(persona===null)return {kind:readSoul(home).kind,written:false,reason:'no-persona'};
      const outcome=syncSoul({home,persona,take,now:this.now()});return {kind:outcome.kind,written:outcome.written,...(outcome.reason?{reason:outcome.reason}:{}),...(outcome.kept?{kept_copy:true}:{})};}
    catch(error){return {kind:'unknown',written:false,reason:String(error.message).split('\n')[0]};}
  }
  async save(target,input={},options={}){
    const t=this.target(target);
    if(t.kind==='who'){
      const text=lf(input.text??input.fields?.text).trim();
      if(!text)refuse('"Who it is" cannot be empty.','BLANK');
      return this.change(t,current=>{if(current.state!=='ok')refuse('Your assistant\'s main instructions (AGENTS.md) have no marked "who it is" paragraph yet. Add the marks first.','NO_MARKERS');
        // Only a change is held to the length: the paragraph as it stands always saves.
        if(text!==current.text&&chars(text)>4000)refuse('Keep "who it is" to a few paragraphs, at most 4,000 characters.','TOO_LONG');
        const manual=this.readText(MANUAL);return {writes:[{file:MANUAL,text:withPersona(manual,text)}],message:'changed who it is'};},options);
    }
    const fields=input.fields||{};
    if(t.kind==='rule')return this.change(t,current=>this.rulePlan(t,current,fields,'changed the rule "'+t.name+'"'),options);
    if(t.kind==='skill')return this.change(t,()=>{
      const old=this.readText(t.file),old_description=readFront(splitFront(old).front).description,description=fields.description===undefined?oneLine(old_description):oneLine(fields.description);
      // A description changed here is held to what the assistants read; one left as it was always saves.
      if(description!==oneLine(old_description)){if(!description)refuse('Say in one sentence what this skill is for: your assistant picks a skill by it.','BLANK');if(description.length>1024)refuse('Keep what the skill is for under 1,024 characters.','TOO_LONG');}
      const steps=lf(fields.steps??splitFront(old).body);if(!steps.trim())refuse('A skill needs its steps.','BLANK');
      const headed=description===oneLine(old_description)?old:setFront(old,{description},{quote:yamlQuoted});
      return {writes:[{file:t.file,text:splitFront(headed).head+this.fitBody(old,steps)}],message:'changed the skill "'+t.name+'"'};
    },options);
    return this.change(t,()=>{
      const old=this.readText(t.file),body=lf(input.text??fields.text??'');if(!body.trim())refuse('This page cannot be empty.','BLANK');
      return {writes:[{file:t.file,text:splitFront(old).head+this.fitBody(old,body)}],message:'changed '+t.file};
    },options);
  }
  // New text for the part below a file's header, with the blank lines and line endings it had.
  fitBody(old,text){
    const body=old===null?'':splitFront(old).body,eol=(old||'').includes('\r\n')?'\r\n':'\n';
    const lead=body.match(/^(?:\r?\n)*/)[0],trail=body.match(/(?:\r?\n)*$/)[0]||eol;
    return lead+lf(text).replace(/^\n+/,'').replace(/\n+$/,'').replace(/\n/g,eol)+trail;
  }
  // A rule's file as the page's fields describe it, and the list in AGENTS.md brought up to date with it.
  // What the page shows must save (16 October 2026). Each field is checked and written only when
  // the person changed it: a name, a sentence or a kind left as the page showed it is never refused
  // for its length or form and never rewritten, and `description:` is never written from the name
  // (a new rule gets its sentence there). The short name lives in `title:`.
  rulePlan(t,current,fields,message,{create=false}={}){
    const old=create?null:this.readText(t.file),was=old===null?null:this.ruleFields(t.name,old);
    const given=key=>fields[key]!==undefined&&fields[key]!==null;
    const line=given('line')?oneLine(fields.line):was?.line??'';
    const always=given('always')?fields.always!==false:was?.always??true;
    const group=given('group')?String(fields.group):was?.group??'how';
    let title=given('title')?oneLine(fields.title):was?.title??'';
    if(create&&!title)title=firstWords(line,NAME_LIMIT);
    const changed={line:create||line!==was.line,always:create||always!==was.always,group:create||group!==was.group,title:create||title!==was.title};
    if(changed.group&&!['must','never','how'].includes(group))refuse('Choose what kind of rule this is.','BAD_GROUP');
    if(changed.title&&!title)refuse('Give the rule a name: a few words, so you can find it.','BLANK');
    if(changed.title&&chars(title)>NAME_LIMIT)refuse('Keep the rule\'s name to a few words, at most '+NAME_LIMIT+' characters, so you can find it. The whole rule goes in its sentence and its story.','TOO_LONG');
    if(always&&!line&&(changed.line||changed.always))refuse('Write the rule in one sentence: that sentence is what your assistant reads before every job.','BLANK');
    if(changed.line&&chars(line)>400)refuse('Keep the one sentence under 400 characters; the whole story goes below it.','TOO_LONG');
    let story=lf(given('story')?fields.story:was?.story??'');
    if(create&&!/^#\s/.test(story.trimStart()))story='# '+title+'\n\n'+story;
    const oldWhere=old===null?undefined:readFront(splitFront(old).front).where;
    const where=always?'always':oldWhere&&oldWhere!=='always'?oldWhere:'when-it-matters';
    const updates=create?{name:t.name,title,description:line||title,where,group,line,order:String(fields.order??this.nextOrder(group))}
      :{...(changed.title?{title}:{}),...(changed.always?{where}:{}),...(changed.group?{group}:{}),...(changed.line?{line}:{})};
    const base=old??'';const text=setFront(base,updates);const {head}=splitFront(text);
    const next=head+this.fitBody(old,story);
    const manual=this.readText(MANUAL);let writes=[{file:t.file,text:next}];
    if(manual!==null){const gathered=this.gather(manual,new Map([[t.name,next]]));if(gathered.problem)refuse(gathered.problem,gathered.code||'RULES_PROBLEM');if(gathered.next!==manual)writes.push({file:MANUAL,text:gathered.next});}
    return {writes,message};
  }
  nextOrder(group){let max=0;for(const slug of this.ruleNames()){const h=readFront(splitFront(this.readText('rules/'+slug+'.md')).front);if((h.group||'how')===group&&/^\d+$/.test(h.order||''))max=Math.max(max,Number(h.order));}return max+1;}
  async addRule(fields={},options={}){
    const title=oneLine(fields.title)||firstWords(fields.line,NAME_LIMIT);if(!title)refuse('Give the rule a name or its one sentence.','BLANK');
    if(chars(title)>NAME_LIMIT)refuse('Keep the rule\'s name to a few words, at most '+NAME_LIMIT+' characters, so you can find it. The whole rule goes in its sentence and its story.','TOO_LONG');
    const base=title.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60).replace(/-+$/,'')||'rule';
    const taken=new Set(this.ruleNames());let slug=base;for(let n=2;taken.has(slug)||fs.existsSync(path.join(this.root,'rules',slug+'.md'));n++)slug=base+'-'+n;
    const t={...this.target('rule:'+slug),missingOk:true};
    return this.change(t,current=>this.rulePlan(t,current,{...fields,title},'added the rule "'+slug+'"',{create:true}),{...options,expected_hash:undefined}).then(result=>({...result,target:t.target}));
  }
  async removeRule(target,options={}){
    const t=this.target(target);if(t.kind!=='rule')refuse('Only a rule can be removed here.','REFUSED');
    return this.change(t,()=>{
      const manual=this.readText(MANUAL);const writes=[{file:t.file,text:null}];
      if(manual!==null){const gathered=this.gather(manual,new Map([[t.name,null]]));if(gathered.problem)refuse(gathered.problem,gathered.code||'RULES_PROBLEM');if(gathered.next!==manual)writes.push({file:MANUAL,text:gathered.next});}
      return {writes,message:'removed the rule "'+t.name+'"'};
    },options);
  }
  async markWho(options={}){
    const t=this.target('who');
    return this.change(t,current=>{if(current.state==='no-manual')refuse('Your mission control has no main instructions for your assistant (AGENTS.md).','MISSING',{status:404});if(current.state==='ok')return {writes:[],message:''};return {writes:[{file:MANUAL,text:markedManual(this.readText(MANUAL)).text}],message:'marked who it is in AGENTS.md'};},{...options,expected_hash:undefined});
  }
  // Brings the list of rules in AGENTS.md up to date with the files in rules/ (for a list a
  // program elsewhere left behind).
  async gatherRules(options={}){
    const t=this.target('who');
    return this.change({...t,label:'the list of rules'},()=>{const manual=this.readText(MANUAL);if(manual===null)refuse('Your mission control has no main instructions for your assistant (AGENTS.md).','MISSING',{status:404});const g=this.gather(manual,new Map());if(g.problem)refuse(g.problem,g.code||'RULES_PROBLEM');if(g.noPlace)refuse('Your assistant\'s main instructions (AGENTS.md) have no place for the list of rules.','NO_PLACE');return {writes:[{file:MANUAL,text:g.next}],message:'brought the list of rules up to date'};},{...options,expected_hash:undefined});
  }
  // ---- Earlier versions ---------------------------------------------------------------------------
  // Newest first, one entry per change of what the page shows for this part.
  async versions(target,{limit=40}={}){
    const t=this.target(target),raw=await this.history.versions(t.file,{limit:t.kind==='who'?300:80});
    const current=this.readText(t.file),currentView=this.viewText(t,this.view(t,current));
    const out=[];let last;
    for(const v of raw){const view=this.viewText(t,this.view(t,v.text));if(out.length&&view===last)continue;last=view;out.push({...v,view});}
    if(!out.length||last!==currentView){let at=null;try{at=fs.statSync(path.join(this.root,t.file)).mtime.toISOString();}catch{}out.push({commit:null,at:at||this.now().toISOString(),author:null,message:null,body:'',text:current,view:currentView,unrecorded:true});}
    return out.reverse().slice(0,limit).map((v,i)=>({id:v.commit||'now',at:v.at,current:i===0&&v.view===currentView,removed:v.view===null,by:this.byWhom(v),message:v.message&&v.message.startsWith(COMMIT_PREFIX)?v.message.slice(COMMIT_PREFIX.length):v.message,
      ...(t.kind==='who'?{text:v.view}:{fields:v.view===null?null:JSON.parse(v.view)}),...(v.unrecorded?{unrecorded:true}:{})}));
  }
  byWhom(v){
    if(v.unrecorded)return 'not kept as a version yet';
    if(String(v.message).startsWith(COMMIT_PREFIX+'kept the version from before'))return 'kept by your notebook';
    if(v.author==='Godspeed Mission Control'&&String(v.message).startsWith(COMMIT_PREFIX))return /\(asked in chat\)$/.test(v.message)?'your assistant, asked in chat':'you, on this page';
    if(v.author==='Godspeed Mission Control')return 'saved by your notebook';
    return v.author||'unknown';
  }
  async undo(target,options={}){
    const t=this.target(target),list=await this.versions(target,{limit:3});
    const previous=list.find((v,i)=>i>0);if(!previous||!list[0].current)refuse('There is no earlier version to go back to.','NO_EARLIER');
    return this.bringBack(t,previous,'undid the last change to '+t.label,options);
  }
  async restore(target,id,options={}){
    const t=this.target(target),list=await this.versions(target,{limit:200}),version=list.find(v=>v.id===id);
    if(!version)refuse('That earlier version is not there any more. Open the list again.','NO_VERSION',{status:404});
    if(version.current)return {saved:true,unchanged:true};
    return this.bringBack(t,version,'brought back '+t.label+' as it was on '+version.at.slice(0,16).replace('T',' '),options);
  }
  async bringBack(t,version,message,options){
    // The exact text of that version, read again from history (the list carries what the page shows).
    const raw=version.id==='now'?null:(await this.history.versions(t.file,{limit:t.kind==='who'?300:80})).find(v=>v.commit===version.id);
    if(t.kind==='who'){
      return this.change(t,current=>{
        const manual=this.readText(MANUAL);
        if(version.removed||version.text===null)return {writes:[{file:MANUAL,text:unmarkedManual(manual)}],message};
        if(current.state!=='ok')refuse('Your assistant\'s main instructions (AGENTS.md) have no marked "who it is" paragraph now.','NO_MARKERS');
        return {writes:[{file:MANUAL,text:withPersona(manual,version.text)}],message};
      },options);
    }
    const text=raw?raw.text:null;
    if(t.kind!=='rule'&&text===null)refuse('This file did not exist then, so there is nothing to bring back.','NO_VERSION');
    return this.change({...t,missingOk:true},()=>{
      const writes=[{file:t.file,text}];
      if(t.kind==='rule'){const manual=this.readText(MANUAL);if(manual!==null){const g=this.gather(manual,new Map([[t.name,text]]));if(g.problem)refuse(g.problem,g.code||'RULES_PROBLEM');if(g.next!==manual)writes.push({file:MANUAL,text:g.next});}}
      return {writes,message};
    },options);
  }
  // ---- Instructions for AI apps that connect to the notebook --------------------------------------
  // My Profile's "Agent Instructions" until 15 October 2026: records (agent_instructions) that
  // get_user_profile hands every connected AI app, which no assistant may write (core/assistant-
  // mutations.mjs). They stay records, shown and changed here beside the rules: converting them
  // into rules/ would take them away from the apps that read them, and the list of rules in
  // AGENTS.md has a ceiling a set of them could break. Their earlier versions are the notebook's
  // own record history (store.commit keeps one per change); a removed one is a tombstone that
  // can be brought back.
  instructionList(){
    return this.store.list('agent_instructions',{removed:true}).filter(r=>!r.purged).map(r=>({id:r.id,instruction:r.instruction??r.content??r.instructions??r.text??'',applies_to:r.applies_to||'all',is_active:r.is_active!==false,removed:!!r.removed_at,hash:r._hash,updated_at:r.updated_at||null,sort_order:r.sort_order??null}))
      .sort((a,b)=>(a.sort_order??0)-(b.sort_order??0)||String(a.updated_at).localeCompare(String(b.updated_at)));
  }
  instructionView(r){return {instruction:r.instruction??r.content??r.instructions??r.text??'',applies_to:r.applies_to||'all',is_active:r.is_active!==false,removed:!!r.removed_at};}
  instructionVersions(id){
    const current=this.store.get('agent_instructions',String(id??''));if(!current||current.purged)refuse('This instruction is not there.','MISSING',{status:404});
    const all=[...this.store.list('record_history').filter(h=>h.source_type==='agent_instructions'&&h.source_uid===current.uid&&h.snapshot).map(h=>({id:h.id,at:h.snapshot.updated_at||h.recorded_at,...this.instructionView(h.snapshot)})).sort((a,b)=>String(a.at).localeCompare(String(b.at))),{id:'now',at:current.updated_at,...this.instructionView(current)}];
    const out=[];let last;for(const v of all){const key=JSON.stringify([v.instruction,v.applies_to,v.is_active,v.removed]);if(key===last)continue;last=key;out.push(v);}
    const now=JSON.stringify(Object.values(this.instructionView(current)));
    return out.reverse().map((v,i)=>({...v,current:i===0&&JSON.stringify([v.instruction,v.applies_to,v.is_active,v.removed])===now}));
  }
  async saveInstruction(input={},{expected_hash}={}){
    const instruction=String(input.instruction??'').trim(),applies_to=String(input.applies_to||'all');
    if(!['all','professional','personal','health','private'].includes(applies_to))refuse('Choose which apps it is for.','BAD_SCOPE');
    const value={...(input.id?{id:String(input.id)}:{}),...(input.instruction!==undefined?{instruction}:{}),...(input.applies_to!==undefined?{applies_to}:{}),...(typeof input.is_active==='boolean'?{is_active:input.is_active}:{}),...(input.removed!==undefined?{removed_at:input.removed?this.now().toISOString():null}:{})};
    if(input.instruction!==undefined&&!instruction)refuse('Write the instruction.','BLANK');if(instruction.length>2000)refuse('Keep an instruction under 2,000 characters.','TOO_LONG');
    if(!value.id){if(!instruction)refuse('Write the instruction.','BLANK');Object.assign(value,{applies_to,is_active:value.is_active??true,sort_order:this.instructionList().length});}
    else{const current=this.store.get('agent_instructions',value.id);if(!current||current.purged)refuse('This instruction is not there.','MISSING',{status:404});
      if(expected_hash!==undefined&&current._hash!==expected_hash)refuse('This instruction changed since you opened it. Open it again to see the newest version.','CHANGED',{status:409});}
    // A change that crosses another at this very moment is kept for review (store.conflict), as every record's is.
    const saved=await this.store.saveAsync('agent_instructions',value,value.id?expected_hash:undefined);return {saved:true,id:saved.id,now:this.instructionList().find(i=>i.id===saved.id)};
  }
  async restoreInstruction(id,versionId,{expected_hash}={}){
    const version=this.instructionVersions(id).find(v=>v.id===versionId);if(!version)refuse('That earlier version is not there any more.','NO_VERSION',{status:404});
    if(version.current)return {saved:true,unchanged:true};
    return this.saveInstruction({id,instruction:version.instruction,applies_to:version.applies_to,is_active:version.is_active,removed:version.removed},{expected_hash});
  }
  // ---- The owner's own words, for a change the assistant makes ----------------------------------
  // The assistant passes the owner's request as `words`, and the change is made only when those
  // words are in a message the owner sent in the last twenty minutes: in the notebook's chat, or
  // in the assistant's own conversation store (Telegram, the notebook's chat through Hermes). Text
  // that reached the assistant from a web page, a mail or a tool is never such a message.
  ownerAsked(words){
    const norm=s=>String(s??'').toLowerCase().replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim(),said=norm(words);
    if(said.length<3)return false;
    const since=this.now().getTime()-this.recentWindowMs;
    try{for(const m of this.store.list('conversation_messages'))if(m.role==='user'&&Date.parse(m.created_at)>=since&&norm(m.content).includes(said))return true;}catch{}
    const home=this.assistantHome();
    if(home&&fs.existsSync(path.join(home,'state.db'))){
      let db;try{db=new DatabaseSync(path.join(home,'state.db'),{readOnly:true});
        for(const row of db.prepare("select content from messages where role='user' and timestamp>=? order by timestamp desc limit 200").all(since/1000))if(norm(row.content).includes(said))return true;
      }catch{}finally{try{db?.close();}catch{}}
    }
    return false;
  }
}

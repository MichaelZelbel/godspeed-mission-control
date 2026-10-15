import fs from 'node:fs';
import path from 'node:path';
import {atomic,hash} from './records/store.mjs';

// HERMES' OWN IDENTITY FILE FOLLOWS "WHO IT IS".
//
// Hermes builds every system prompt from SOUL.md in its home first (the identity slot; without
// one it uses its built-in "You are Hermes Agent, built by Nous Research ..."), and only then the
// project's AGENTS.md from terminal.cwd (agent/system_prompt.py _identity_parts and
// _context_files_part; agent/prompt_builder.py load_soul_md and build_context_files_prompt). A
// routine (cron) skips AGENTS.md but keeps SOUL.md. Hermes seeds SOUL.md with its own default on
// first run (hermes_cli/config.py _ensure_default_soul_md), so until 15 October 2026 every
// Godspeed assistant was told "You are Hermes Agent" before it read "You are Godspeed Mission
// Control", and a routine's message was written by Hermes Agent alone. On the test server the
// Telegram chat's stored prompt began with Hermes' text (state.db, session of 4 October 2026).
//
// Two sources, both shown and changed on the notebook page that shows who the assistant is: the
// persona paragraph of AGENTS.md (its "who it is", between the persona markers), and the owner's
// extra instructions (assistant/extra-instructions.md, EXTRA), which follow it with a blank line
// between. This file is written from them: when it is missing, when it is Hermes' own untouched
// default, and when it is one this module wrote. One its owner wrote themselves is never replaced
// silently: the page says Hermes also reads a text it does not hold yet, shows it, and "Bring it
// here" moves that text into the extra instructions, keeping the old file as a copy beside it
// (16 October 2026: what the assistant's program reads is never a file nobody can see).
export const SOUL_MARK='<!-- godspeed:who-it-is - written by Godspeed Mission Control from the who-it-is paragraph of AGENTS.md and from assistant/extra-instructions.md. Change those, not this file: this file follows them. -->';
export const EXTRA='assistant/extra-instructions.md';
// Hermes reads at most this much of a context file and drops the middle of a longer one
// (prompt_builder.py CONTEXT_FILE_MAX_CHARS), SOUL.md included.
export const SOUL_LIMIT=20000;
const normal=text=>String(text??'').replace(/\r\n?/g,'\n').replace(/^﻿/,'').trim();
// Hermes' own seeded texts (hermes_cli/default_soul.py: DEFAULT_SOUL_MD, its ASCII variant, the
// previous generation and the two comment-only scaffolds older installers wrote). A file equal to
// one of them carries no intent of its owner.
const HERMES_DEFAULT='You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work gets a short report of what changed, what\'s verified, and what\'s left, never a replay of the process. No filler ("Great question," "I\'d be happy to"), no restating the request back, no re-summarizing what you already said, no narrating tool calls the user can see. Plain claims over adjectives; when unsure, say so plainly. Agree because it\'s right, not because the user said it. Depth is earned — give it when the user asks for detail, teaches, or the stakes demand it, not by default.';
const SCAFFOLD_HEAD='# Hermes Agent Persona\n\n<!--\nThis file defines the agent\'s personality and tone.\nThe agent will embody whatever you write here.\nEdit this to customize how Hermes communicates with you.\n\n';
const SCAFFOLD_TAIL='This file is loaded fresh each message -- no restart needed.\nDelete the contents (or this file) to use the default personality.\n-->';
export const HERMES_DEFAULTS=[
  HERMES_DEFAULT,
  HERMES_DEFAULT.replaceAll('—','--'),
  'You are Hermes Agent, an intelligent AI assistant created by Nous Research. You are helpful, knowledgeable, and direct. You assist users with a wide range of tasks including answering questions, writing and editing code, analyzing information, creative work, and executing actions via your tools. You communicate clearly, admit uncertainty when appropriate, and prioritize being genuinely useful over being verbose unless otherwise directed below. Be targeted and efficient in your exploration and investigations.',
  SCAFFOLD_HEAD+'Examples:\n  - "You are a warm, playful assistant who uses kaomoji occasionally."\n  - "You are a concise technical expert. No fluff, just facts."\n  - "You speak like a friendly coworker who happens to know everything."\n\n'+SCAFFOLD_TAIL,
  SCAFFOLD_HEAD+SCAFFOLD_TAIL,
].map(normal);

export function soulText(persona,extra=''){return SOUL_MARK+'\n\n'+normal(persona)+(normal(extra)?'\n\n'+normal(extra):'')+'\n';}
export const soulChars=(persona,extra)=>[...soulText(persona,extra)].length;
const recordFile=home=>path.join(home,'.godspeed-soul.json');
const lastWritten=home=>{try{return JSON.parse(fs.readFileSync(recordFile(home),'utf8')).hash||null;}catch{return null;}};

// What the assistant's identity file is now: missing, empty, Hermes' own default, ours (written
// from "who it is"), or its owner's own.
export function readSoul(home){
  if(!home)return {kind:'no-assistant'};
  const file=path.join(home,'SOUL.md');let stat=null;try{stat=fs.lstatSync(file);}catch{}
  if(!stat)return {kind:'missing',file};
  // A link leads somewhere else; nothing is written through it.
  if(stat.isSymbolicLink()||!stat.isFile())return {kind:'own',file,text:null,linked:true};
  const text=fs.readFileSync(file,'utf8'),plain=normal(text);
  if(!plain)return {kind:'empty',file,text};
  if(HERMES_DEFAULTS.includes(plain))return {kind:'hermes',file,text};
  if(plain.startsWith('<!-- godspeed:who-it-is'))return {kind:'ours',file,text,edited:!!lastWritten(home)&&lastWritten(home)!==hash(text)};
  return {kind:'own',file,text};
}

// The extra instructions in a workspace, or '' (a missing file is none).
export function readExtra(root){try{return fs.readFileSync(path.join(root,EXTRA),'utf8');}catch{return '';}}
// Brings SOUL.md in step with `persona` and `extra`. take: also replace the owner's own file (the
// page's "Bring it here", after its text was moved into the extra instructions). Whatever is
// replaced that was not written from them unchanged is kept beside it first. A text past what
// Hermes reads is not written (the page refuses such a change before it is saved).
export function syncSoul({home,persona,extra='',take=false,now=new Date()}){
  const soul=readSoul(home);
  if(soul.kind==='no-assistant')return {...soul,written:false};
  if(!normal(persona))return {kind:soul.kind,file:soul.file,written:false,reason:'no-persona'};
  if(soul.linked)return {kind:soul.kind,file:soul.file,written:false,reason:'linked'};
  if(soul.kind==='own'&&!take)return {kind:'own',file:soul.file,written:false,reason:'own'};
  const want=soulText(persona,extra);
  if([...want].length>SOUL_LIMIT)return {kind:soul.kind,file:soul.file,written:false,reason:'too-long'};
  if(soul.text===want)return {kind:soul.kind,file:soul.file,written:false,inStep:true};
  let kept=null;
  if(soul.kind==='own'||soul.kind==='hermes'||soul.edited){
    kept=path.join(home,'SOUL.before-godspeed-'+now.toISOString().replace(/[:.]/g,'-')+'.md');
    fs.writeFileSync(kept,soul.text,{flag:'wx'});
  }
  atomic(soul.file,want);
  if(process.platform!=='win32')try{fs.chmodSync(soul.file,0o600);}catch{}
  atomic(recordFile(home),JSON.stringify({hash:hash(want),at:now.toISOString()}));
  return {kind:'ours',file:soul.file,written:true,replaced:soul.kind,kept};
}

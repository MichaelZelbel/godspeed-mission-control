import fs from 'node:fs';
import path from 'node:path';
import { shared } from './file-policy.mjs';
// A Mission Control file the owner keeps from every assistant: private: true,
// ai_visibility: hidden or visibility_scope: private in its frontmatter (or its
// JSON). Frontmatter is YAML; until 6 October 2026 it was read as JSON, so a
// quoted value ("true", 'hidden') or a comment after it was missed.
const marked=meta=>meta?.private===true||String(meta?.ai_visibility??'').toLowerCase()==='hidden'||String(meta?.visibility_scope??'').toLowerCase()==='private';
const scalar=raw=>{const value=String(raw).replace(/\s+#.*$/,'').trim().replace(/^(["'])(.*)\1$/,'$2');return /^(true|yes|on)$/i.test(value)?true:/^(false|no|off)$/i.test(value)?false:value;};
export function privateFile(relative,text){
  // Blind comparison keys remain available to their owner and recovery, but
  // must never reveal the side assignment in ordinary assistant context.
  if(/^work\/lead-comparisons\/[^/]+\/blind-key\.json$/.test(relative))return true;
  if(/^(?:private:\s*true|ai_visibility:\s*hidden|visibility_scope:\s*private)\s*$/m.test(text))return true;
  const frontmatter=text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if(frontmatter){const meta={};for(const line of frontmatter[1].split(/\r?\n/)){const m=line.match(/^([A-Za-z_][\w-]*):(.*)$/);if(m)meta[m[1]]=scalar(m[2]);}if(marked(meta))return true;try{return marked(JSON.parse(frontmatter[1]));}catch{return false;}}
  try{return marked(JSON.parse(text));}catch{return false;}
}
export function fileContext(store,limit=40000){
  const result=[];let remaining=limit;
  const walk=(relative)=>{
    const target=path.join(store.root,relative);if(!fs.existsSync(target))return;
    const info=fs.lstatSync(target);if(info.isSymbolicLink())return;
    if(info.isDirectory()){for(const name of fs.readdirSync(target))if(remaining>0)walk(path.posix.join(relative,name));}
    else if(remaining>0&&shared(relative)&&/\.(md|json|jsonl|csv|txt)$/.test(relative)){
      const full=fs.readFileSync(target,'utf8');if(privateFile(relative,full))return;
      const text=full.slice(0,remaining);result.push({path:relative,content:text});remaining-=text.length;
    }
  };
  // The rooms whose files are themselves the content. 'due' is not among them any more: a reminder
  // is a record (#90), and both readers of this already get every one of them as rows of their
  // own (briefing.mjs context.deadlines, chat-context.mjs context.personal.deadlines), worked
  // out by the program that owns them rather than read off a page.
  for(const name of ['profile','goals','coach','journal','work','observations','rules'])walk(name);
  return {files:result,truncated:remaining<=0};
}

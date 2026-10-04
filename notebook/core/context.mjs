import fs from 'node:fs';
import path from 'node:path';
import { durable } from './file-policy.mjs';
function privateFile(relative,text){
  // Blind comparison keys remain available to their owner and recovery, but
  // must never reveal the side assignment in ordinary assistant context.
  if(/^work\/lead-comparisons\/[^/]+\/blind-key\.json$/.test(relative))return true;
  if(/^(?:private:\s*true|ai_visibility:\s*hidden|visibility_scope:\s*private)\s*$/m.test(text))return true;
  const frontmatter=text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  try{const meta=JSON.parse(frontmatter?frontmatter[1]:text);return meta?.private===true||meta?.ai_visibility==='hidden'||meta?.visibility_scope==='private';}catch{return false;}
}
export function fileContext(store,limit=40000){
  const result=[];let remaining=limit;
  const walk=(relative)=>{
    const target=path.join(store.root,relative);if(!fs.existsSync(target))return;
    const info=fs.lstatSync(target);if(info.isSymbolicLink())return;
    if(info.isDirectory()){for(const name of fs.readdirSync(target))if(remaining>0)walk(path.posix.join(relative,name));}
    else if(remaining>0&&durable(relative)&&/\.(md|json|jsonl|csv|txt)$/.test(relative)){
      const full=fs.readFileSync(target,'utf8');if(privateFile(relative,full))return;
      const text=full.slice(0,remaining);result.push({path:relative,content:text});remaining-=text.length;
    }
  };
  for(const name of ['profile','goals','due','coach','journal','work','observations','rules'])walk(name);
  return {files:result,truncated:remaining<=0};
}

import fs from 'node:fs';
import path from 'node:path';
import { durable } from './file-policy.mjs';
export function fileContext(store,limit=40000){
  const result=[];let remaining=limit;
  const walk=(relative)=>{
    const target=path.join(store.root,relative);if(!fs.existsSync(target))return;
    const info=fs.lstatSync(target);if(info.isSymbolicLink())return;
    if(info.isDirectory()){for(const name of fs.readdirSync(target))if(remaining>0)walk(path.posix.join(relative,name));}
    else if(remaining>0&&durable(relative)&&/\.(md|json|jsonl|csv|txt)$/.test(relative)){
      const text=fs.readFileSync(target,'utf8').slice(0,remaining);if(/^(?:private:\s*true|ai_visibility:\s*hidden|visibility_scope:\s*private)\s*$/m.test(text))return;result.push({path:relative,content:text});remaining-=text.length;
    }
  };
  for(const name of ['profile','goals','due','coach','journal','work','observations','rules'])walk(name);
  return {files:result,truncated:remaining<=0};
}

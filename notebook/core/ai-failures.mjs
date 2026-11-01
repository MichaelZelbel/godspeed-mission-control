import fs from 'node:fs';
import path from 'node:path';
import {scrubCredentials} from './runtime.mjs';

// THE DIAGNOSIS OF A FAILED AI REQUEST, KEPT (issue #127). The chat told the reader that "its private
// runtime diagnostics are retained for investigation", and nothing retained them: the AI program's
// error output lived in memory for the length of one request. When the Charm Challenge's scenario
// met a failure on a throwaway machine, the cause went with the machine. Now every failure the
// notebook's chat meets is appended, with every key and token taken out, to one private file in the
// notebook's state folder, newest last, and only the newest entries are kept. A scenario prints it
// into its job log (scenarios/scenario-lib.sh print_kept_diagnosis); a person finds it beside the
// notebook's other machine state. It is never shown in the chat.
export const KEPT_FILE='ai-failures.log';
const MOST_ENTRIES=40,MOST_DIAGNOSIS=6000;

export function keepAiFailure({file,diagnostic,said,secrets=[],now=new Date(),extra={}}){
  if(!file)return false;
  try{
    const text=String(diagnostic||'').replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/).map(line=>scrubCredentials(line,secrets).trimEnd()).join('\n').trim();
    const entry={at:now.toISOString(),said:scrubCredentials(said||'',secrets),...extra,diagnosis:text.slice(-MOST_DIAGNOSIS)};
    let lines=[];
    try{lines=fs.readFileSync(file,'utf8').split('\n').filter(Boolean);}catch{}
    lines.push(JSON.stringify(entry));
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,lines.slice(-MOST_ENTRIES).join('\n')+'\n',{mode:0o600});
    if(process.platform!=='win32')try{fs.chmodSync(file,0o600);}catch{}
    return true;
  }catch{return false;}
}

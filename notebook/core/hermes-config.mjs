import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';

// Hermes' own clock reads HERMES_TIMEZONE, then `timezone` in its config.yaml, then the machine's
// zone (hermes_time.py). The notebook passes the installation's zone whenever it runs a Hermes
// command itself, but a routine asked for in the chat ("every weekday at seven") is made by Hermes,
// which on a Linux server then read seven o'clock on the server's clock, usually UTC. Until
// 8 October 2026 only the one-click server's Telegram setup wrote the reader's zone there. A zone
// already in the file is someone's choice and stays.
export function withTimezone(text,timezone){
 if(!timezone)return text;
 const line=String(text).match(/^timezone:[ \t]*(.*?)[ \t]*(?:#.*)?$/m);
 if(line&&line[1].replace(/^["']|["']$/g,'').trim())return text;
 return line?text.replace(line[0],'timezone: '+JSON.stringify(timezone)):String(text).replace(/\n*$/,'\n')+'timezone: '+JSON.stringify(timezone)+'\n';
}
// ONE KEY OF HERMES' config.yaml, CHANGED IN PLACE. The file is block-style YAML as Hermes, the
// installers and wire-assistant.mjs write it (two spaces per level; a list's "- " items may stand
// at the level of their key, as Hermes' own writer puts them). Everything else in it, comments
// included, is kept as it was. keys: the path, e.g. ['tools','tool_search','enabled']; value: the
// YAML text for it, written on the key's own line.
const escapeKey=key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const linesOf=text=>{const out=[];let at=0;for(const line of text.split('\n')){out.push({at,line});at+=line.length+1;}return out;};
const indentOf=line=>line.match(/^ */)[0].length;
// Where the lines that belong to the key on line i end (an index into lines): deeper lines, blank
// lines and comments, and "- " items at the key's own level.
function childrenEnd(lines,i,indent){
 let end=i+1,j=i+1;
 for(;j<lines.length;j++){
  const {line}=lines[j],bare=line.trim();
  if(!bare||bare.startsWith('#')){continue;}
  if(indentOf(line)>indent||(indentOf(line)===indent&&/^-(\s|$)/.test(bare))){end=j+1;continue;}
  break;
 }
 return end;
}
export function setConfigValue(text,keys,value){
 text=String(text||'').replace(/^﻿/,'').replace(/\r\n/g,'\n');
 let lines=linesOf(text),from=0,to=lines.length,indent=0;
 for(let depth=0;depth<keys.length;depth++){
  const pattern=new RegExp('^'+' '.repeat(indent)+escapeKey(keys[depth])+':(?:[ \\t]+(.*?))?[ \\t]*$');
  let found=-1;for(let i=from;i<to;i++){if(pattern.test(lines[i].line)){found=i;break;}}
  const last=depth===keys.length-1;
  if(found===-1){
   // Missing from here down: written in full at the end of the block it belongs to.
   const rest=keys.slice(depth).map((k,n)=>' '.repeat(indent+2*n)+k+':'+(n===keys.length-depth-1?' '+value:'')).join('\n');
   const before=to<lines.length?lines[to].at:text.length;
   const head=text.slice(0,before).replace(/\n*$/,'\n');
   return (head===('\n')?'':head)+rest+'\n'+(to<lines.length?text.slice(before):'');
  }
  const own=lines[found].line.match(pattern)[1]||'';
  if(last){
   // The key's own line takes the value; any list items or deeper lines under it go.
   const end=childrenEnd(lines,found,indent),start=lines[found].at,stop=end<lines.length?lines[end].at:text.length;
   return text.slice(0,start)+' '.repeat(indent)+keys[depth]+': '+value+'\n'+text.slice(stop);
  }
  if(own&&!own.startsWith('#')){
   // A flow mapping or a scalar where a section belongs ("agent: {}"): it becomes the section.
   const start=lines[found].at,end=childrenEnd(lines,found,indent),stop=end<lines.length?lines[end].at:text.length;
   const flow=own.match(/^\{\s*\}$/)?'':null;
   if(flow===null)return text;// a value we do not understand is the owner's: left alone
   text=text.slice(0,start)+' '.repeat(indent)+keys[depth]+':\n'+text.slice(stop);
   lines=linesOf(text);
  }
  from=found+1;to=childrenEnd(lines,found,indent);indent+=2;
 }
 return text;
}
// The value of one key as written (the text after "key:", or the list under it), or null.
export function readConfigValue(text,keys){
 text=String(text||'').replace(/^﻿/,'').replace(/\r\n/g,'\n');
 const lines=linesOf(text);let from=0,to=lines.length,indent=0;
 for(let depth=0;depth<keys.length;depth++){
  const pattern=new RegExp('^'+' '.repeat(indent)+escapeKey(keys[depth])+':(?:[ \\t]+(.*?))?[ \\t]*$');
  let found=-1;for(let i=from;i<to;i++){if(pattern.test(lines[i].line)){found=i;break;}}
  if(found===-1)return null;
  if(depth===keys.length-1){
   const own=(lines[found].line.match(pattern)[1]||'').replace(/\s+#.*$/,'');
   if(own)return own;
   const items=lines.slice(found+1,childrenEnd(lines,found,indent)).map(l=>l.line.trim()).filter(l=>l.startsWith('- ')).map(l=>l.slice(2).trim());
   return items.length?items:'';
  }
  from=found+1;to=childrenEnd(lines,found,indent);indent+=2;
 }
 return null;
}
// A list setting as Hermes reads it (agent.skill_utils.parse_config_string_list): a YAML list, a
// flow list, a JSON-array string ("hermes config set" stores one) or one name.
export function configList(value){
 if(value===null||value===undefined||value==='')return [];
 if(Array.isArray(value))return value.map(v=>v.replace(/^["']|["']$/g,'')).filter(Boolean);
 let text=String(value).trim().replace(/^(["'])(\[.*\])\1$/,'$2');
 if(text.startsWith('['))return text.slice(1,text.lastIndexOf(']')).split(',').map(v=>v.trim().replace(/^["']|["']$/g,'')).filter(Boolean);
 return [text.replace(/^["']|["']$/g,'')].filter(Boolean);
}

// WHAT THE ASSISTANT OF A MISSION CONTROL MADE FROM THE STARTER NEEDS FROM HERMES, written on every
// wiring. Each one was found by a live run of the book's prompts (9 October 2026), and each would
// hit any model:
//
// - No Hermes memory beside the notebook. memory_enabled: false switches off only Hermes' notes;
//   its profile of the user (memories/USER.md) stays on unless user_profile_enabled is false too,
//   and the assistant wrote "Jo moved to Lisbon" there and answered from it, while her page in the
//   notebook still said Leeds. Both are off, and the memory tool is not offered at all.
// - No clarify tool. The notebook's chat runs Hermes for one turn (`hermes chat --oneshot`), where
//   nobody can answer it, so Hermes tells the model to pick an answer itself, and it did ("your
//   answers: target, not costly-day"). Without the tool the assistant asks in its reply, and the
//   reader answers in the next message, on every channel.
// - The notebook's tools are offered directly. Hermes puts every tool of an MCP server behind its
//   tool search by default (tools.tool_search.enabled "auto"); called by name they "do not exist",
//   and the morning brief never reached the notebook. Hermes has no switch per server, so the search
//   is off: the notebook's 47 tools cost about 6,000 tokens of every request.
// - Hermes knows its scheduler runs. Without a gateway, Hermes' cronjob tool tells the model that a
//   routine "will NOT fire until the gateway is started" and to say so; under Godspeed the notebook
//   runs `hermes cron tick` itself, and the model repeated the warning over AGENTS.md. The cron
//   provider godspeed_notebook (godspeed-cron-provider.py, installed as a Hermes plugin) is Hermes'
//   own built-in ticker under another name, which is how Hermes knows that jobs fire without its
//   gateway (hermes_cli/cron.py, _builtin_gateway_liveness).
export const CRON_PROVIDER='godspeed_notebook';
export function godspeedHermesSettings(text){
 let out=String(text||'');
 out=setConfigValue(out,['memory','memory_enabled'],'false');
 out=setConfigValue(out,['memory','user_profile_enabled'],'false');
 // Toolsets the owner switched off stay off; clarify and memory join them.
 const disabled=configList(readConfigValue(out,['agent','disabled_toolsets']));
 const wanted=[...disabled,...['clarify','memory'].filter(n=>!disabled.includes(n))];
 out=setConfigValue(out,['agent','disabled_toolsets'],'['+wanted.map(n=>JSON.stringify(n)).join(', ')+']');
 out=setConfigValue(out,['tools','tool_search','enabled'],'"off"');
 out=setConfigValue(out,['cron','provider'],CRON_PROVIDER);
 return out;
}

// Only an existing configuration is changed: wire-assistant.mjs writes the first one, and a file
// holding nothing but a zone would keep it from writing the rest.
export function setHermesTimezone(home,timezone){
 const file=path.join(home,'config.yaml');if(!timezone||!fs.existsSync(file))return false;
 const text=fs.readFileSync(file,'utf8').replace(/^﻿/,''),next=withTimezone(text,timezone);
 if(next===text)return false;
 atomic(file,next);if(process.platform!=='win32')fs.chmodSync(file,0o600);return true;
}

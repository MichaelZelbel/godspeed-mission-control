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
// Only an existing configuration is changed: wire-assistant.mjs writes the first one, and a file
// holding nothing but a zone would keep it from writing the rest.
export function setHermesTimezone(home,timezone){
 const file=path.join(home,'config.yaml');if(!timezone||!fs.existsSync(file))return false;
 const text=fs.readFileSync(file,'utf8').replace(/^﻿/,''),next=withTimezone(text,timezone);
 if(next===text)return false;
 atomic(file,next);if(process.platform!=='win32')fs.chmodSync(file,0o600);return true;
}

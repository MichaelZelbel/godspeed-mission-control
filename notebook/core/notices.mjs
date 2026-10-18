import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';

// WHAT THE NOTEBOOK MUST TELL THE PERSON AND CANNOT SEND ITSELF (18 October 2026), such as a nightly
// backup that failed. With the original assistant only Hermes sends anything, so the notebook queues
// such a notice here, in this machine's own state, and the two routines that run every 15 minutes
// (the coach's reminders and the journal's check-ins, routine-scripts/godspeed_routines.py notices)
// say each one once, where the routines' results go: Telegram, or a note in "From your routines".
// The notebook's bell shows it too (a notifications record), for a machine with neither routine.
export const NOTICES_FILE='notices.json';
const KEEP=50;
export function readNotices(store){try{const data=JSON.parse(fs.readFileSync(path.join(store.state,NOTICES_FILE),'utf8'));return Array.isArray(data?.notices)?data.notices:[];}catch{return [];}}
export function queueNotice(store,{id,text,at=new Date().toISOString()}){
 if(typeof id!=='string'||!id||typeof text!=='string'||!text.trim())throw Error('A notice needs an id and its words');
 const notices=readNotices(store);if(notices.some(n=>n.id===id))return false;
 atomic(path.join(store.state,NOTICES_FILE),JSON.stringify({notices:[...notices,{id,text:text.trim(),at}].slice(-KEEP)},null,2)+'\n');
 return true;
}

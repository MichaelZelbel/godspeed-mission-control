#!/usr/bin/env node
// THE MAIL COUNTS, AS THE ROUTINE RUNS IT (4 November 2026, #215; core/mail-trackers.mjs says what it
// counts). It prints nothing and sends nothing. With no tracker holding a mail rule it exits before
// the mail program is loaded. A mail connection that is missing or refused counts nothing and is not
// an error here: the daily connection check tells the person. Only a failure of the notebook's own
// files is one fixed sentence, never an error's own text.
//
//   GODSPEED_WORKSPACE=<mission control> node notebook/scripts/mail-count.mjs
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {countMail} from '../core/mail-trackers.mjs';

export async function runMailCount({root,search,now=new Date()}){
 const store=new Store(root,{device:machineDevice(root).id}),tz=store.get('settings','installation')?.timezone||'UTC';
 return countMail({store,query:new QueryService(store),search,now,tz});
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const root=process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_ROOT;
 if(!root){console.error('The mail counts do not know which mission control to read.');process.exit(2);}
 try{
  await runMailCount({root:path.resolve(root)});
  process.exit(0);
 }catch{
  console.error('The mail counts could not be updated.');
  process.exit(1);
 }
}

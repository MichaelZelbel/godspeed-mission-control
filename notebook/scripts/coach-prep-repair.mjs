#!/usr/bin/env node
// ONE REPAIR ITEM FOR A TALK WHOSE PREPARATION FAILED ITS REVIEW THREE TIMES IN A ROW (#135).
//
// tools/mc-coach-prep prepares a coaching talk of an area with research domains, and a second AI
// reviews it before the talk may open from it. On 3 November 2026 the same preparation failed its
// review three times for a talk the next day, and nobody was told. After the third failed try in a
// row, mc-coach-prep runs this: it files one repair item in the notebook's work list, the way the
// morning briefing files its own (core/briefing.mjs): a work_items record of kind repair with an id
// made from the talk, so a fourth failure finds it open and files no second one. An item the person
// already closed (verified) is filed again, as the briefing does.
//
// A TALK THAT OPENED WITHOUT ITS PREPARATION (#359) gets the same kind of item, with the same id: on
// 8 November 2026 a health talk opened with nothing prepared and nobody heard of it. mc-coach-prep
// finds such talks each night (godspeed-coach prep-missed) and runs this with --opened-unprepared
// "<why, in everyday words>" and --next <the area's next talk day>, which the item asks to be ready.
//
//   node notebook/scripts/coach-prep-repair.mjs --godspeed <mission control> --area <area> --talk <YYYY-MM-DD>
//        [--title "Weekly check-in"] [--tries 3] [--issues-file <file>] [--summary <run summary path>]
//        [--opened-unprepared "<reason>" --next <YYYY-MM-DD>]
//
// Prints "filed <id>" or "already open <id>"; exit 1 with one sentence when it could not.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store,hash} from '../core/records/store.mjs';
import {machineDevice} from '../core/device-id.mjs';

export function repairId(area,talk){return 'repair-coach-prep-'+hash([area,talk]).slice(0,24);}

export function fileCoachPrepRepair({root,area,talk,title=area,tries=3,issues=[],summary='',unprepared='',next='',env=process.env}){
 const store=new Store(root,{device:machineDevice(root,env).id}),id=repairId(area,talk);
 const old=store.get('work_items',id);
 if(old&&old.state!=='verified'&&!old.removed_at)return {filed:false,id};
 const said=issues.map(x=>String(x).replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,12);
 const ready=day=>`has a preparation that passes its review (godspeed-coach prep-check ${area} --date ${day} says ready)`;
 const what=unprepared
  ?{title:`The ${title} talk of ${talk} opened without a reviewed preparation: ${unprepared}`,tries:0,error:unprepared,
   check:next?`The next ${title} talk (${next}) ${ready(next)}`:`The next ${title} talk has a preparation that passes its review`}
  :{title:`The ${title} talk of ${talk} could not be prepared: its preparation failed its review ${tries} times in a row`,tries,error:said.join('; ')||'The review did not pass.',
   check:`The ${title} talk of ${talk} ${ready(talk)}`};
 store.save('work_items',{id,kind:'repair',title:what.title,
  state:'needs_review',area,talk,tries:what.tries,issues:said,error:what.error,
  ...(summary?{summary}:{}),
  check:what.check,
  allowed_action:'inspect-and-retry',dependencies:[],max_attempts:3},old?old._hash:undefined);
 return {filed:true,id};
}

const isMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(isMain){
 const arg=name=>{const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:undefined;};
 const root=arg('godspeed')||process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_ROOT,area=arg('area'),talk=arg('talk');
 if(!root||!/^[a-z0-9][a-z0-9-]*$/.test(area||'')||!/^\d{4}-\d{2}-\d{2}$/.test(talk||'')){console.error('coach-prep-repair: --godspeed <folder> --area <area> --talk <YYYY-MM-DD> are needed');process.exit(2);}
 let issues=[];const file=arg('issues-file');
 if(file)try{issues=fs.readFileSync(file,'utf8').split(/\r?\n/).map(l=>l.replace(/^\s*-\s*/,'').trim()).filter(Boolean);}catch{}
 try{
  const next=arg('next')||'';
  if(next&&!/^\d{4}-\d{2}-\d{2}$/.test(next)){console.error('coach-prep-repair: --next is a day as YYYY-MM-DD');process.exit(2);}
  const r=fileCoachPrepRepair({root:path.resolve(root),area,talk,title:arg('title')||area,tries:Number(arg('tries'))||3,issues,summary:arg('summary')||'',unprepared:arg('opened-unprepared')||'',next});
  console.log((r.filed?'filed ':'already open ')+r.id);
 }catch(error){console.error('coach-prep-repair: the repair item could not be filed: '+error.message);process.exit(1);}
}

#!/usr/bin/env node
// Typed native Telegram bridge. No arbitrary operations, shell fragments or model quotes.
import {habitButtonAction} from '../core/habit-buttons.mjs';
import {now} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
let body='';
try{
 for await(const chunk of process.stdin){body+=chunk;if(Buffer.byteLength(body)>8192)throw Error('Input too large');}
 const root=process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_COACH_DIR;
 if(!root)throw Error('Installation missing');
 console.log(JSON.stringify(habitButtonAction(root,JSON.parse(body),{now:now()})));
}catch{
 console.log(JSON.stringify({ok:false,status:'unavailable',buttons:[],notice:'I could not confirm a save. Ask for a fresh habit card before trying again.'}));
 process.exitCode=1;
}

#!/usr/bin/env node
// The Telegram setup chat's last step on the one-click server (GODSPEED_TG_FINISH, set by
// docker/full-candidate/telegram-runner.mjs). Files the reader's goal and clock the way the
// notebook's own "Start with one goal" does, and makes Telegram the place routines deliver
// to. Reads {"timezone":"Europe/London","goal":"..."} on standard input.
import fs from 'node:fs';
import {Store} from '../core/records/store.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';

const root=process.env.GODSPEED_WORKSPACE;if(!root)throw Error('Set GODSPEED_WORKSPACE to the notebook folder');
const input=JSON.parse(fs.readFileSync(0,'utf8')||'{}');
const timezone=typeof input.timezone==='string'&&input.timezone?input.timezone:undefined,goal=String(input.goal||'').trim();
const store=new Store(root,{device:process.env.GODSPEED_DEVICE||'local'});
const scheduler=new NativeScheduler(store,{executable:process.env.GODSPEED_HERMES||'/opt/hermes/bin/hermes',home:process.env.HERMES_HOME,device:store.device});
await scheduler.configure({goal,timezone,delivery:'telegram'});
// configure keeps an earlier setup's clock and delivery; the chat's answers are newer.
await store.saveAsync('settings',{id:'installation',...(timezone?{timezone}:{}),delivery:'telegram'});
console.log('Filed the goal and the clock; routines deliver to Telegram.');
process.exit(0);

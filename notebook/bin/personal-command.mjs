#!/usr/bin/env node
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {machineDevice} from '../core/device-id.mjs';
// This machine's own name, as bin/godspeed.mjs uses it: the assistant's goal,
// work, due, watch and coach commands write records and jobs through here, and
// until 7 October 2026 they stamped the old shared name "local", the name the
// 6 October change set out to remove (it was fixed in godspeed.mjs but not here).
const root=process.env.GODSPEED_WORKSPACE;if(!root)throw Error('Choose the isolated workspace');const [command,...args]=process.argv.slice(2),store=new Store(root,{device:machineDevice(root).id}),domains=new Domains(new QueryService(store));
const type=['goals','work','forecast'].includes(command)?{type:'card-command',card:command,args}:command==='due'?{type:'due-command',args}:command==='subs'?{type:'subscription-command',args}:command==='watch'?{type:'watch-command',args}:['coach','journal','headache'].includes(command)?{type:'addon-command',addon:command,args}:null;if(!type)throw Error('Choose goals, work, forecast, due, subs, watch, coach, journal or headache');
console.log((await domains.invoke('personal-operation',type)).result);

#!/usr/bin/env node
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
const root=process.env.GODSPEED_WORKSPACE;if(!root)throw Error('Choose the isolated workspace');const [command,...args]=process.argv.slice(2),store=new Store(root),domains=new Domains(new QueryService(store));
const type=['goals','work','forecast'].includes(command)?{type:'card-command',card:command,args}:command==='due'?{type:'due-command',args}:['coach','journal','headache'].includes(command)?{type:'addon-command',addon:command,args}:null;if(!type)throw Error('Choose goals, work, forecast, due, coach, journal or headache');
console.log((await domains.invoke('personal-operation',type)).result);

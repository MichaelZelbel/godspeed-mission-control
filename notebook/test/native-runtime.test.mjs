import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {nativeAgent} from '../core/native-agent.mjs';import {NativeScheduler,nativeJobs} from '../core/native-scheduler.mjs';import {Store} from '../core/records/store.mjs';import {Domains} from '../core/domains.mjs';import {QueryService} from '../core/query.mjs';
function fixture(t){const base=fileURLToPath(new URL('../../.test-tmp/',import.meta.url));fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'native-godspeed-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('notebook transport preserves the real Hermes agent loop, tools and named conversation',async()=>{
 let captured;const agent=nativeAgent({executable:'hermes',home:'fixture-home',cwd:'fixture-workspace',spawnProcess:(exe,args,options)=>{captured={exe,args,options};const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin.on('data',data=>{assert.equal(String(data),'Fictional question');queueMicrotask(()=>{child.stdout.write('Fictional reply');child.emit('close',0);});});return child;}});
 assert.equal((await agent({message:'Fictional question',conversation_id:'fictional-thread'})).reply,'Fictional reply');
 assert.equal(captured.exe,'hermes');assert.ok(captured.args.includes('--continue'));assert.ok(captured.args.includes('--create-if-missing'));assert.equal(captured.args.includes('--max-turns'),false);assert.equal(captured.args.includes('--toolsets'),false);
});
test('Godspeed chat uses native Hermes rather than the notebook action planner while memory stays connected',async t=>{
 const store=new Store(fixture(t)),domains=new Domains(new QueryService(store),{provider:()=>assert.fail('Replacement planner ran')});domains.nativeAgent=async input=>({reply:'Original agent '+input.message});
 assert.equal((await domains.invoke('conversation-chat',{message:'Fictional question',conversation_id:'fixture'})).reply,'Original agent Fictional question');
 assert.equal(store.list('conversation_messages').at(-1).source_app,'hermes');
 const note=await store.saveAsync('notes',{title:'Fictional memory',content:'Menerio remains connected'});assert.equal(store.get('notes',note.id).content,'Menerio remains connected');
});
test('native setup files the goal using the original main tool and creates no replacement routines',async t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'rules'));const store=new Store(root),home=path.join(root,'.hermes'),scheduler=new NativeScheduler(store,{home,executable:'hermes'});
 await scheduler.configure({goal:'Fictional original goal',timezone:'Europe/Berlin'});
 assert.ok(fs.existsSync(path.join(root,'goals/fictional-original-goal.md')));assert.match(fs.readFileSync(path.join(root,'goals/fictional-original-goal.md'),'utf8'),/STATUS: adopted/);
 assert.equal(store.list('jobs').length,0);assert.equal(nativeJobs(home).length,0);
});
test('notebook schedule controls call Hermes cron and reflect its job file',async t=>{
 const root=fixture(t),store=new Store(root),home=path.join(root,'.hermes'),calls=[];
 fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.mkdirSync(path.join(root,'skills/morning-brief'),{recursive:true});fs.writeFileSync(path.join(root,'skills/morning-brief/SKILL.md'),'Fictional skill');
 fs.writeFileSync(path.join(home,'cron/jobs.json'),JSON.stringify([{id:'fixture',name:'Morning brief',enabled:true,state:'scheduled'}]));
 const scheduler=new NativeScheduler(store,{home,executable:'hermes',run:async(exe,args)=>{calls.push({exe,args});return {stdout:''};}});
 await scheduler.control({id:'fixture',paused:true});assert.deepEqual(calls[0],{exe:'hermes',args:['cron','pause','fixture']});
 await scheduler.control({kind:'morning-brief',interval_ms:86400000},{enable:true});assert.ok(calls[1].args.includes('--skill'));assert.ok(calls[1].args.includes('morning-brief'));assert.equal(store.list('jobs').length,0);
});

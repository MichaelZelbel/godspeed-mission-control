import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createService} from '../server/main.mjs';
import {mcp} from '../server/mcp.mjs';
import {loadSettings,saveSettings,setSetting} from '../../third-party/addons/godspeed-journal/lib/settings.mjs';
import {writeEntry,readEntries} from '../../third-party/addons/godspeed-journal/lib/store.mjs';
import {contextBlock} from '../../third-party/addons/godspeed-journal/lib/context.mjs';
import {dueMessages} from '../../third-party/addons/godspeed-journal/lib/tick.mjs';
import {checkRecord} from '../../third-party/addons/godspeed-journal/lib/evidence.mjs';

const bin=fileURLToPath(new URL('../../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs',import.meta.url));
const at=new Date('2026-10-20T12:00:00Z');
const fixture=(t,{cleanup=true}={})=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-journal-pause-'));
 if(cleanup)t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'AGENTS.md'),'# Fictional workspace\n');
 saveSettings(root,{...loadSettings(root),git_sync:'off',timezone:'UTC'});
 return root;
};
const run=(root,...args)=>spawnSync(process.execPath,[bin,...args,'--godspeed',root],{encoding:'utf8',windowsHide:true,env:{...process.env,GODSPEED_NOW:at.toISOString(),GODSPEED_JOURNAL_GIT_SYNC:'off'}});
const files=root=>{
 const dir=path.join(root,'routines','journal','entries');
 return fs.existsSync(dir)?fs.readdirSync(dir,{recursive:true}).filter(p=>p.endsWith('.md')).map(p=>[p,fs.readFileSync(path.join(dir,p),'utf8')]):[];
};

test('Settings pause rejects chat journal commands and MCP entries, creates no entry file, and resume saves once',async t=>{
 const root=fixture(t,{cleanup:false}),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:3});});
 const operation=async value=>fetch(base+'/api/functions/personal-operation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await operation({type:'journal-switch',enabled:false})).status,200);
 const command=await operation({type:'addon-command',addon:'journal',args:['note','Fictional private thought']});
 assert.equal(command.status,400);
 assert.match(await command.text(),/capture is paused/);
 const chat=await fetch(base+'/api/browser-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'/journal note "Fictional private chat thought"'})});
 assert.equal(chat.status,400);assert.match(await chat.text(),/capture is paused/);
 const response=await mcp({id:1,method:'tools/call',params:{name:'personal_operation',arguments:{type:'journal-add',content:'Fictional private thought'}}},{store:service.store,query:service.query,domains:service.domains});
 assert.equal(response.result.isError,true);
 assert.deepEqual(files(root),[]);
 assert.equal(service.query.rows('journal').length,0);
 assert.equal(fs.existsSync(path.join(root,'routines','journal','entries')),false);
 assert.equal((await operation({type:'journal-switch',enabled:true})).status,200);
 const resumed=await fetch(base+'/api/browser-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'/journal note "Fictional resumed thought"'})});
 assert.equal(resumed.status,200);assert.equal(JSON.parse((await resumed.json()).reply).ok,true);
 assert.equal(service.query.rows('journal').length,1);
 assert.equal(service.query.rows('journal')[0].content,'Fictional resumed thought');
});

test('every journal mutation respects pause, reports remain readable, and explicit config resume works',t=>{
 const root=fixture(t);
 for(const args of [['start','Fictional task','--done-means','draft'],['start','Fictional closed task'],['done','Fictional closed task','--missed','letter']]){
  const result=run(root,...args);assert.equal(result.status,0,result.stderr);
 }
 assert.equal(run(root,'config','set','capture_enabled','off').status,0);
 const before=files(root);
 for(const args of [['note','Fictional rejected note'],['start','Fictional rejected start'],['define','Fictional task','--done-means','letter'],['done','Fictional task'],['drop','Fictional task'],['reopen','Fictional closed task'],['met','Fictional closed task','--met','letter'],['mark','Fictional task','asked']]){
  const result=run(root,...args);assert.equal(result.status,1,args.join(' '));assert.match(result.stderr,/capture is paused/);assert.doesNotMatch(result.stdout,/Saved|Reopened/);
 }
 assert.deepEqual(files(root),before);
 assert.match(run(root,'day','2026-10-20').stdout,/Fictional task/);
 assert.match(run(root,'context').stdout,/capture is paused/);
 assert.doesNotMatch(run(root,'context').stdout,/Fictional task/);
 assert.equal(run(root,'config','set','capture_enabled','on').status,0);
 assert.equal(run(root,'note','Fictional resumed note').status,0);
 assert.equal(files(root).length,before.length+1);
});

test('shared writer rechecks saved pause even with settings loaded before pause',t=>{
 const root=fixture(t),stale=loadSettings(root);
 setSetting(root,'capture_enabled','off');
 assert.throws(()=>writeEntry(root,stale,{kind:'note',words:'Fictional stale write'},at),/capture is paused/);
 assert.equal(fs.existsSync(path.join(root,'routines','journal','entries')),false);
 setSetting(root,'capture_enabled','on');
 writeEntry(root,loadSettings(root),{kind:'note',words:'Fictional resumed write'},at);
 assert.equal(readEntries(root,loadSettings(root),{until:at}).length,1);
});

test('paused tick and evidence neither run hooks nor close tasks or emit check-ins',t=>{
 const root=fixture(t),settings=loadSettings(root),hook=path.join(root,'fictional-hook.mjs'),marker=path.join(root,'hook-ran');
 fs.writeFileSync(hook,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'ran');\n`);
 writeEntry(root,settings,{kind:'start',task:'fictional-post',title:'Substack post'},new Date(at.getTime()-4*3600000));
 saveSettings(root,{...settings,capture_enabled:false,evidence:{script:hook},nudge:{...settings.nudge,enabled:true,quiet_hours:''}});
 const paused=loadSettings(root),entries=readEntries(root,paused,{until:at}),before=files(root);
 assert.deepEqual(dueMessages(entries,paused,at),{messages:[],records:[]});
 assert.equal(checkRecord(root,paused,entries,at).closes.length,0);
 for(const command of ['tick','evidence']){const result=run(root,command);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');}
 assert.equal(fs.existsSync(marker),false);
 assert.deepEqual(files(root),before);
 assert.match(contextBlock(entries,paused,at),/capture is paused/);
});

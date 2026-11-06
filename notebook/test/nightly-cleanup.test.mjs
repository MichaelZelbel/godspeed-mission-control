import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {nightlyCleanup,cleanupLog} from '../core/cleanup.mjs';

// THE NIGHTLY CLEANUP (#238) on a throwaway assistant home and mission control; every file is made up.
const NOW=Date.parse('2026-11-05T02:45:00Z'),DAY=86400000;
const make=(file,days,text='x'.repeat(100))=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);const at=new Date(NOW-days*DAY);fs.utimesSync(file,at,at);return file;};
const fixture=t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cleanup-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 return {base,root:path.join(base,'godspeed'),home:path.join(base,'hermes')};
};
const gone=file=>!fs.existsSync(file);

test('old dumps, transcripts and run files go; recent files, listed sessions, undo backups and everything off the list stay',t=>{
 const {base,root,home}=fixture(t),keep=[],drop=[];
 const sessions=path.join(home,'sessions'),profile=path.join(home,'profiles','work','sessions');
 for(const folder of [sessions,profile]){
  drop.push(make(path.join(folder,'request_dump_20260101_000000_aaaaaaaa_1.json'),40),make(path.join(folder,'session_20260101_000000_aaaaaaaa.json'),40),make(path.join(folder,'20260101_000000_aaaaaaaa.jsonl'),40));
  keep.push(make(path.join(folder,'request_dump_20261025_000000_bbbbbbbb_1.json'),10),make(path.join(folder,'session_20261025_000000_bbbbbbbb.json'),10));
  keep.push(make(path.join(folder,'session_20260101_000000_listed01.json'),40),make(path.join(folder,'20260101_000000_listed01.jsonl'),40),make(path.join(folder,'request_dump_20260101_000000_listed01_2.json'),40));
  keep.push(make(path.join(folder,'sessions.json'),400,JSON.stringify({'agent:main:telegram:dm:1':{session_id:'20260101_000000_listed01',platform:'telegram'}})));
  keep.push(make(path.join(folder,'notes.txt'),400));
 }
 keep.push(make(path.join(home,'state.db'),400),make(path.join(home,'.env'),400),make(path.join(home,'config.yaml'),400),make(path.join(home,'skills','one','SKILL.md'),400),make(path.join(home,'cron','jobs.json'),400));
 for(const kind of ['research','work','next-action','coach-prep']){
  drop.push(make(path.join(root,'routines',kind,'2026-09-25','answer.txt'),40),make(path.join(root,'routines',kind,'2026-09-25','item','log.txt'),40));
  keep.push(make(path.join(root,'routines',kind,'2026-10-25','answer.txt'),10));
 }
 keep.push(make(path.join(root,'routines','work','2026-09-25','W-20260925-01','before.txt'),40));
 keep.push(make(path.join(root,'notebook','page.md'),400),make(path.join(root,'routines','journal','settings.json'),400),make(path.join(root,'archives','chat','2026-01.jsonl'),400),make(path.join(root,'.godspeed','backups','b1.tar'),400),make(path.join(root,'.godspeed','state.db'),400),make(path.join(root,'.godspeed','before-update-20261015-093000','x.json'),400));
 const result=nightlyCleanup({root,home,now:NOW});
 for(const file of drop)assert.ok(gone(file),file);
 for(const file of keep)assert.ok(!gone(file),file);
 assert.ok(gone(path.join(root,'routines','research','2026-09-25')),'an emptied day folder goes too');
 const freed=Object.fromEntries(result.places.map(p=>[p.place,p.files]));
 assert.equal(freed['assistant sessions'],3);assert.equal(freed['profile work sessions'],3);assert.equal(freed['routines/work'],2);
 assert.match(cleanupLog(result),/assistant sessions: freed 0\.0 MB in 3 files[\s\S]*disk free: .* before, .* after/);
});

test('a link is never followed, and a damaged sessions.json leaves its folder alone',t=>{
 const {base,root,home}=fixture(t);
 const outside=make(path.join(base,'outside','precious.json'),400),outsideDir=path.join(base,'outsideDir');
 const old=make(path.join(outsideDir,'2026-09-25','answer.txt'),40);
 const sessions=path.join(home,'sessions');fs.mkdirSync(sessions,{recursive:true});
 fs.symlinkSync(outside,path.join(sessions,'session_20260101_link.json'));
 fs.mkdirSync(path.join(root,'routines'),{recursive:true});
 fs.symlinkSync(outsideDir,path.join(root,'routines','work'));
 fs.symlinkSync(old,path.join(root,'routines','research'));
 const damaged=path.join(home,'profiles','broken','sessions');
 make(path.join(damaged,'sessions.json'),400,'{not json');const dump=make(path.join(damaged,'session_20260101_x.json'),40);
 nightlyCleanup({root,home,now:NOW});
 assert.ok(!gone(outside));assert.ok(!gone(old));assert.ok(fs.lstatSync(path.join(sessions,'session_20260101_link.json')).isSymbolicLink());
 assert.ok(!gone(dump));
});

test('a session or run-log folder on another file system is left alone',t=>{
 const {root,home}=fixture(t),session=make(path.join(home,'sessions','session_20260101_old.json'),40),logs=make(path.join(root,'routines','work','2026-01-01','answer.txt'),40),real=fs.lstatSync;
 const otherDevice=stat=>Object.create(stat,{dev:{value:stat.dev+1}});
 t.mock.method(fs,'lstatSync',p=>{const stat=real(p);return [path.join(home,'sessions'),path.join(root,'routines','work')].includes(String(p))?otherDevice(stat):stat;});
 nightlyCleanup({root,home,now:NOW});
 assert.ok(!gone(session),'a mounted sessions folder is not entered');assert.ok(!gone(logs),'a mounted run-log folder is not entered');
});

test('a place that cannot be read is reported as stopped early, and the other places are still cleaned',t=>{
 const {root,home}=fixture(t);
 const old=make(path.join(root,'routines','work','2026-01-01','a.txt'),40);
 const real=fs.readdirSync;
 t.mock.method(fs,'readdirSync',(p,...rest)=>{if(String(p).endsWith(path.join('routines','research')))throw Object.assign(new Error('io'),{code:'EIO'});return real(p,...rest);});
 make(path.join(root,'routines','research','2026-01-01','b.txt'),40);
 const result=nightlyCleanup({root,home,now:NOW});
 assert.ok(gone(old));
 assert.match(cleanupLog(result),/routines\/research: freed .*stopped early/);
});

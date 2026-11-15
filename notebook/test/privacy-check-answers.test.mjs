import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
import { userFacing } from '../server/main.mjs';

// GitHub's answer to "is this repository private?" decides what the person reads, and in every
// answer but 404 nothing reaches GitHub: not even the read with this computer's Git sign-in.
const at=(hour,minute)=>{const d=new Date();d.setHours(hour,minute,0,0);if(d<=Date.now())d.setDate(d.getDate()+1);return d;};
const clock=d=>d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',timeZoneName:'short'});

function answering(t,status,headers={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'privacy-answer-'));
  const sync=new FileSync(new Store(dir)),calls=[];
  sync.git=args=>{calls.push(args[0]);return '';};
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status,headers});
  t.after(()=>{globalThis.fetch=original;fs.rmSync(dir,{recursive:true,force:true});});
  return {check:()=>sync.verifyRemote('https://github.com/owner/notes.git'),calls};
}

test('a 403 rate limit says GitHub is limiting this network and when to try again',async t=>{
  const reset=at(14,5),{check,calls}=answering(t,403,{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(reset.getTime()/1000)});
  await assert.rejects(check(),error=>{
    assert.match(error.message,/^GitHub is limiting requests from this network right now/);
    assert.match(error.message,/no files were uploaded/);
    assert.ok(error.message.endsWith('Try again after '+clock(reset)+'.'),error.message);
    return true;
  });
  assert.deepEqual(calls,[]);
});

test('a 429 with retry-after says when to try again, from now',async t=>{
  const before=Date.now(),{check,calls}=answering(t,429,{'retry-after':'600'});
  const times=[clock(new Date(before+600000)),clock(new Date(Date.now()+600000))];
  await assert.rejects(check(),error=>{
    assert.match(error.message,/^GitHub is limiting requests from this network right now.*no files were uploaded/);
    assert.ok(times.some(time=>error.message.endsWith('Try again after '+time+'.')),error.message);
    return true;
  });
  assert.deepEqual(calls,[]);
});

test('a 403 with only retry-after is a limit too',async t=>{
  const before=Date.now(),{check,calls}=answering(t,403,{'retry-after':'600'});
  const times=[clock(new Date(before+600000)),clock(new Date(Date.now()+600000))];
  await assert.rejects(check(),error=>{
    assert.match(error.message,/^GitHub is limiting requests from this network right now.*no files were uploaded/);
    assert.ok(times.some(time=>error.message.endsWith('Try again after '+time+'.')),error.message);
    return true;
  });
  assert.deepEqual(calls,[]);
});

test('a 429 without a reset time still says it is a limit',async t=>{
  const {check,calls}=answering(t,429);
  await assert.rejects(check(),/GitHub is limiting requests from this network right now.*no files were uploaded\. Try again in an hour\.$/);
  assert.deepEqual(calls,[]);
});

test('any other answer names GitHub\'s status',async t=>{
  for(const [status,headers] of [[503,{}],[403,{'x-ratelimit-remaining':'42'}]]){
    const {check,calls}=answering(t,status,headers);
    await assert.rejects(check(),new RegExp(': GitHub answered '+status+' when asked whether the repository is private.*no files were uploaded'));
    assert.deepEqual(calls,[]);
  }
});

test('200 refuses a public repository and 404 goes on to read it, without pushing',async t=>{
  const pub=answering(t,200);
  await assert.rejects(pub.check(),/publicly readable/);assert.deepEqual(pub.calls,[]);
  const priv=answering(t,404);
  await priv.check();assert.deepEqual(priv.calls,['ls-remote']);
});

test('Connect record sync shows the worker\'s message about GitHub\'s answer as it is',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'privacy-worker-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const worker=fileURLToPath(new URL('../scripts/sync-worker.mjs',import.meta.url));
  const stub='data:text/javascript,globalThis.fetch=async()=>new Response(null,{status:503})';
  const out=JSON.parse(execFileSync(process.execPath,['--import',stub,worker,dir,'configure','https://github.com/owner/notes.git'],{encoding:'utf8',windowsHide:true}).trim().split('\n').at(-1));
  assert.equal(out.state,'configuration_failed');
  assert.match(out.configuration_error,/^GitHub answered 503 when asked whether the repository is private.*no files were uploaded/);
  assert.equal(fs.existsSync(path.join(dir,'.git')),false);
});

// Settings shows the message through the server's error sanitizer, which cuts server paths out. Until
// #562's review it read the "s://" of the status page's address as a Windows drive path ("check http[path]").
test('Settings shows the status page address whole, and still hides a drive path',async t=>{
  const {check}=answering(t,503);let message;
  await assert.rejects(check(),error=>{message=userFacing(error,[os.homedir(),os.tmpdir()]);return true;});
  assert.ok(message.endsWith('check https://www.githubstatus.com.'),message);
  assert.equal(userFacing(new Error("Cannot open 'C:\\Users\\ann\\notes' or D:/data/x"),[]),"Cannot open '[path]' or [path]");
});

// Both refusals keep saying it "could not be verified": the nightly's live check
// (scenarios/github-privacy-live.mjs) asks GitHub again after a wait only for refusals worded so.
test('a rate limit and any other answer both say it could not be verified',async t=>{
  for(const [status,headers] of [[403,{'x-ratelimit-remaining':'0'}],[429,{}],[503,{}]]){
    const {check}=answering(t,status,headers);
    await assert.rejects(check(),/could not be verified; no files were uploaded/);
  }
});

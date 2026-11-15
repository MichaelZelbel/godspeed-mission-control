import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';

// The last words of the Linux and Mac installer (14 October 2026): where the mission control is,
// how to start talking to it, and where its maker writes about it. They run here in bash on their
// own, with the installer's variables set the three ways a computer can end the install.
const script=fs.readFileSync(new URL('../scripts/install-native-notebook.sh',import.meta.url),'utf8').replaceAll('\r','');
const tail=script.slice(script.indexOf('# The last words a person reads after installing'));
const run=env=>spawnSync('bash',['-c','setup_path(){ [ -n "$SETUP" ] && echo "$SETUP"; }\n'+tail],{encoding:'utf8',env:{PATH:process.env.PATH,root:'/home/reader/godspeed-v2',GODSPEED_PORT:'47831',web_address:'',web_problem:'',SETUP:'',ai_named:'0',...env}});
const newsletter='I write about what it does and what broke, free: https://michaelzelbel.substack.com/subscribe';

test('a computer without a web address: the folder, the local notebook, the newsletter',()=>{
 const r=run({});assert.equal(r.status,0);
 assert.match(r.stdout,/^\nYour mission control is in \/home\/reader\/godspeed-v2\.\n/);
 assert.match(r.stdout,/To talk to it, open your notebook at http:\/\/127\.0\.0\.1:47831\/dashboard\. The first time, connect your own AI account in Settings, under Your AI: the chat and the daily routines both use it\.\n/);
 assert.ok(r.stdout.trimEnd().endsWith(newsletter),'the newsletter line is the last line');
});

test('a server with its first private link: the link, then the newsletter',()=>{
 const r=run({web_address:'https://notebook.example',SETUP:'/setup#invite=fixture'});assert.equal(r.status,0);
 assert.match(r.stdout,/To talk to it, open this private link to make your account/);
 assert.match(r.stdout,/\nhttps:\/\/notebook\.example\/setup#invite=fixture\nThe first time, connect your own AI account in Settings, under Your AI: the chat and the daily routines both use it\.\n/);
 assert.ok(r.stdout.trimEnd().endsWith(newsletter));
});

// What Settings connects powers the chat and the routines (18 October 2026); a Hermes already signed
// in to an AI of its own needs nothing more, and is told where to see it.
test('a Hermes already signed in to an AI is told where to look, not to connect again',()=>{
 const r=run({ai_named:'1'});assert.equal(r.status,0);
 assert.match(r.stdout,/dashboard\. Your chat and daily routines use the AI that Hermes is already signed in to\. Settings, under Your AI, says which, and whether the routines reach it\.\n/);
 assert.doesNotMatch(r.stdout,/connect your own AI/);
});

test('a server whose web address failed stops with the problem and no newsletter',()=>{
 const r=run({web_address:'https://notebook.example',web_problem:'The address does not answer.'});
 assert.equal(r.status,1);assert.match(r.stderr,/The address does not answer\./);
 assert.ok(!r.stdout.includes('substack'),'a failed install does not advertise');
});

// Whether Hermes is "already signed in" is read as Settings reads it (core/routine-ai.mjs): a fresh
// Hermes' own example config names a default model under provider "auto" with no key, and the first
// walk of this ending (18 October 2026) told that reader they were signed in.
test('a fresh Hermes with only its example model is told to connect; one with a provider and its key is not',()=>{
 const kit=new URL('../..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-last-words-'));
 try{
  fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: "anthropic/claude-opus-4.6"\n  provider: "auto"\n  base_url: "https://openrouter.ai/api/v1"\n');
  const fresh=run({ai_named:'',node:process.execPath,version:kit,HERMES_HOME:home});
  assert.equal(fresh.status,0,fresh.stderr);assert.match(fresh.stdout,/connect your own AI account in Settings, under Your AI/);
  fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: "openrouter"\n  default: "fictional/model"\n');fs.writeFileSync(path.join(home,'.env'),'OPENROUTER_API_KEY=fictional\n');
  const signed=run({ai_named:'',node:process.execPath,version:kit,HERMES_HOME:home});
  assert.equal(signed.status,0,signed.stderr);assert.match(signed.stdout,/use the AI that Hermes is already signed in to/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

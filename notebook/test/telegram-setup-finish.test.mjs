import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {installStarter} from '../core/starter-workspace.mjs';
import {FLAG} from '../core/starting-routines.mjs';
import {IdentityShelf} from '../core/identity-shelf.mjs';

// The one-click setup chat's last step (GODSPEED_TG_FINISH) for a fresh server, as the chat asks
// since 16 October 2026: the goal and the few sentences about the reader can both be skipped, and
// what they did say reaches the page the assistant reads before it helps.
const finish=fileURLToPath(new URL('../scripts/telegram-setup-finish.mjs',import.meta.url));
function fresh(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-tg-finish-fresh-')),home=path.join(root,'.hermes-home');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  installStarter(root);fs.mkdirSync(home);fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openrouter\ntimezone: ""\n');
  const run=input=>spawnSync(process.execPath,['--no-warnings',finish],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:120000,
    env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_DEVICE:'vps',HERMES_HOME:home,GODSPEED_HERMES:path.join(root,'no-hermes-here')}});
  return {root,home,run,about:()=>fs.readFileSync(path.join(root,'profile','about-me.md'),'utf8')};
}

test('a goal skipped in the chat files the clock and Telegram, and leaves the routines waiting for the first goal',t=>{
  const f=fresh(t),result=f.run({timezone:'Europe/Vienna',timezone_from:'browser',owner_name:'Anna',joined:false});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/^Filed the clock; routines deliver to Telegram\./);
  const store=new Store(f.root),settings=store.get('settings','installation');
  assert.deepEqual([settings.owner,settings.timezone,settings.delivery],['vps','Europe/Vienna','telegram'],'this server runs the routines');
  assert.equal(store.get('settings',FLAG)?.state,'pending','a goal told later, in the chat or in Settings, starts the routines');
  assert.equal(store.list('goals').length,0,'no goal is made up');
  assert.match(fs.readFileSync(path.join(f.home,'config.yaml'),'utf8'),/^timezone: "Europe\/Vienna"$/m,'Hermes\' clock is the reader\'s');
  // The second part, getting to know them, waits for them (core/context-setup.mjs), with the zone
  // from their browser, so it does not ask the city.
  const ctx=JSON.parse(fs.readFileSync(path.join(f.root,'.godspeed','context-setup.json'),'utf8'));
  assert.deepEqual([ctx.state,ctx.owner_name,ctx.timezone,ctx.timezone_from],['waiting','Anna','Europe/Vienna','browser']);
  assert.match(result.stderr,/the word context still starts it/,'no Hermes here, so the invitation is not planned, and that is said');
  const again=f.run({timezone:'Europe/Vienna',timezone_from:'browser',owner_name:'Anna',joined:false});
  assert.equal(again.status,0,again.stderr);assert.equal(new Store(f.root).get('settings',FLAG)?.state,'pending','Try again changes nothing');
});

test('a few sentences about the reader go into profile/about-me.md once, with its earlier version kept',async t=>{
  const f=fresh(t),said='I am a fictional nurse in Leeds. I run before work and I want help with my rota.';
  fs.writeFileSync(path.join(f.root,'what-my-ai-knew.md'),said+'\n');
  const before=f.about();
  for(let i=0;i<2;i++){const result=f.run({timezone:'Europe/London',goal:'',joined:false,about:'what-my-ai-knew.md'});assert.equal(result.status,0,result.stderr);}
  const now=f.about();
  assert.ok(now.startsWith(before.replace(/\n+$/,'')),'what the page said stays');
  assert.equal(now.split('## In my own words').length,2,'filed once, even when the step runs again');
  assert.match(now,/## In my own words\n\nI am a fictional nurse in Leeds\. I run before work and I want help with my rota\.\n$/);
  assert.equal(fs.readFileSync(path.join(f.root,'what-my-ai-knew.md'),'utf8'),said+'\n','the reader\'s own text stays as it was');
});

test('a longer text, like the book\'s briefing, is named on the page instead of copied into it',t=>{
  const f=fresh(t),long='# What my AI knew\n\n'+'Anna is a fictional teacher who keeps bees. '.repeat(60);
  fs.writeFileSync(path.join(f.root,'notes.md'),long);
  const result=f.run({timezone:'Europe/London',goal:'',joined:false,about:'notes.md'});
  assert.equal(result.status,0,result.stderr);
  assert.match(f.about(),/## In my own words\n\nWhat I told you about myself when I set you up is in the file `notes\.md` at the top of my mission control\. Read it before you help me\.\n$/);
  assert.doesNotMatch(f.about(),/keeps bees/);
  const before=f.about(),odd=f.run({timezone:'Europe/London',goal:'',joined:false,about:'../outside.md'});
  assert.equal(odd.status,0,odd.stderr);assert.equal(f.about(),before,'only a file at the top of the folder is read');
});

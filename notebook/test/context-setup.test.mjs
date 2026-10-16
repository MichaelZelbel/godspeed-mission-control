import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {installStarter} from '../core/starter-workspace.mjs';
import {installSkillTree} from '../core/packaged-skills.mjs';
import {beginContext,readContext,writeContext,inviteNow,scheduleInvite,markContext,showCard,setTimezone,findZone,contextStatus,
  INVITE_SCRIPT,INVITE_JOB,INVITE_MINUTES} from '../core/context-setup.mjs';
import {createService} from '../server/main.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// The setup in two parts (16 October 2026, Michael): the technical part ends when an AI and Telegram
// work; getting to know the owner is a chat the assistant leads afterwards, started by the word
// "context", by the one invitation about ten minutes later, or by the dashboard's card.
const kit=fileURLToPath(new URL('../../',import.meta.url));
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const havePython=spawnSync(python,['--version']).status===0;
function workspace(t,{starter=true}={}){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-context-')),root=path.join(base,'workspace'),home=path.join(base,'hermes');
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(home,{recursive:true});if(starter)installStarter(root);
  fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openrouter\ntimezone: "Europe/Berlin"\n');
  return {root,home,store:new Store(root,{device:'vps'})};
}

test('the one invitation is planned once, about ten minutes after the technical part, as a Hermes job that only prints it',async t=>{
  const {root,home,store}=workspace(t),calls=[];
  beginContext(store,{ownerName:'Anna',timezone:'Europe/Vienna',timezoneFrom:'browser'});
  const scheduler={command:async args=>{calls.push(args);fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.writeFileSync(path.join(home,'cron','jobs.json'),JSON.stringify({jobs:[{id:'j1',name:INVITE_JOB}]}));}};
  const before=Date.now(),planned=await scheduleInvite(scheduler,{store,home});
  assert.equal(planned.scheduled,true);assert.equal(calls.length,1);
  const [create,when,...rest]=calls[0];
  assert.equal(create,'create');
  const minutes=(Date.parse(when)-before)/60000;
  assert.ok(minutes>INVITE_MINUTES-1&&minutes<=INVITE_MINUTES+1,'about ten minutes from now: '+when);
  assert.match(when,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/,'a fixed moment, which every Hermes runs once');
  assert.deepEqual(rest,['--no-agent','--script',INVITE_SCRIPT,'--name',INVITE_JOB,'--deliver','telegram','--failure-deliver','local','--workdir',root]);
  const script=fs.readFileSync(path.join(home,'scripts',INVITE_SCRIPT),'utf8');
  assert.match(script,/context-setup\.mjs", "invite"\]/);assert.ok(script.includes(JSON.stringify(root)));
  assert.equal((await scheduleInvite(scheduler,{store,home})).scheduled,false,'never a second one');assert.equal(calls.length,1);
});

test('the invitation goes out once, and not at all when the chat began or ended before it was due',t=>{
  const {store}=workspace(t);
  beginContext(store,{ownerName:'Anna'});
  const text=inviteNow(store);
  assert.equal(text,'Hi Anna, me again. Shall we take five minutes so I get to know you? Three things: where you live, a little about you, and what you would like my help with first.\n\nNo rush: answer whenever you like, today or next week. Just reply when you are ready, or send context.');
  assert.doesNotMatch(text,/[–—]/);
  assert.equal(readContext(store).state,'invited');assert.equal(readContext(store).invitation,text,'kept for the assistant to see');
  assert.equal(inviteNow(store),'','never a reminder');
  for(const action of ['start','done','skip']){
    const other=workspace(t);beginContext(other.store,{ownerName:'Ben'});markContext(other.store,action);
    assert.equal(inviteNow(other.store),'',action+': no invitation');
  }
  // A setup run again after it began keeps where the chat stands.
  markContext(store,'start');beginContext(store,{ownerName:'Anna'});assert.equal(readContext(store).state,'started');
});

test('the scheduled script prints the invitation once, as Hermes delivers it',t=>{
  const {root,store}=workspace(t);beginContext(store,{ownerName:'Anna'});
  const run=()=>execFileSync(process.execPath,['--no-warnings',path.join(kit,'notebook','scripts','context-setup.mjs'),'invite'],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_DEVICE:'vps'},encoding:'utf8'});
  assert.match(run(),/^Hi Anna, me again\./);assert.equal(run(),'','empty, so Hermes sends nothing');
});

test('a city sets the notebook\'s clock and Hermes\' own, even over a zone set before',async t=>{
  const {home,store}=workspace(t);
  assert.deepEqual(['Vienna','new york','Germany','Asia/Tokyo','Krefeld',''].map(findZone),['Europe/Vienna','America/New_York','Europe/Berlin','Asia/Tokyo',null,null]);
  const result=await setTimezone(store,{city:'Vienna',home});
  assert.deepEqual(result,{found:true,zone:'Europe/Vienna',city:'Vienna'});
  assert.equal(store.get('settings','installation').timezone,'Europe/Vienna');
  assert.match(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),/^timezone: "Europe\/Vienna"$/m);
  assert.equal(readContext(store).timezone_from,'answer');
  assert.deepEqual(await setTimezone(store,{city:'Krefeld',home}),{found:false,city:'Krefeld'});
  assert.equal(store.get('settings','installation').timezone,'Europe/Vienna','a place it does not know changes nothing');
});

test('the dashboard card shows until the chat ended or was hidden, and only on a mission control made from the starter',async t=>{
  const fresh=workspace(t);
  assert.equal(showCard(fresh.store),true,'nobody wrote on the page about them yet');
  beginContext(fresh.store,{ownerName:'Anna'});assert.equal(showCard(fresh.store),true);
  inviteNow(fresh.store);assert.equal(showCard(fresh.store),true);
  markContext(fresh.store,'start');assert.equal(showCard(fresh.store),true);
  markContext(fresh.store,'done');assert.equal(showCard(fresh.store),false);
  const hidden=workspace(t);markContext(hidden.store,'skip');assert.equal(showCard(hidden.store),false);
  const adopted=workspace(t,{starter:false});fs.writeFileSync(path.join(adopted.root,'AGENTS.md'),'# Mine\n');
  assert.equal(showCard(adopted.store),false,'an adopted mission control is its owner\'s');
  const told=workspace(t);fs.appendFileSync(path.join(told.root,'profile','about-me.md'),'\n## In my own words\n\nI keep bees.\n');
  assert.equal(showCard(told.store),false,'they told it about themselves already');
  const service=await createService({root:workspace(t).root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    assert.deepEqual(await(await fetch(base+'/api/context-setup')).json(),{show:true,state:null});
    const hide=await fetch(base+'/api/context-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'skip'})});
    assert.deepEqual(await hide.json(),{show:false,state:'skipped'});
    assert.equal((await(await fetch(base+'/api/context-setup')).json()).show,false);
  }finally{await service.close();}
});

test('the assistant\'s tool: what is known, where the chat stands, and what it keeps, with the owner\'s own words',async t=>{
  const {root,store}=workspace(t);process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  t.after(()=>{delete process.env.GODSPEED_ASSISTANT_CONFIG;});
  beginContext(store,{ownerName:'Anna',timezone:'Europe/Vienna',timezoneFrom:'browser'});inviteNow(store);
  const service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;let id=0;
  try{
  const call=async args=>{const reply=await(await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name:'context_setup',arguments:args}})})).json();
    const text=reply.result.content[0].text;return reply.result.isError?{error:text}:JSON.parse(text);};
  const listed=await(await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:0,method:'tools/list'})})).json();
  assert.ok(listed.result.tools.some(tool=>tool.name==='context_setup'));
  service.store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Vienna',delivery:'telegram'});
  const status=await call({action:'status'});
  assert.equal(status.state,'invited');assert.deepEqual(status.timezone,{zone:'Europe/Vienna',city:'Vienna',from:'browser'});
  assert.equal(status.about.told,false);assert.deepEqual(status.goals,[]);assert.match(status.where,/Godspeed's brain/);
  assert.deepEqual(await call({action:'start'}),{state:'started'});
  const said='I am a fictional nurse in Leeds, two kids, I run before work.';
  assert.match((await call({action:'about',text:said,words:said})).error,/owner's own words/,'nothing the owner did not say');
  service.store.save('conversation_messages',{conversation_id:'telegram',role:'user',content:said,created_at:new Date().toISOString()});
  assert.deepEqual(await call({action:'about',text:said,words:said}),{kept:true,page:'whole',file:null});
  assert.match(fs.readFileSync(path.join(root,'profile','about-me.md'),'utf8'),/## In my own words\n\nI am a fictional nurse in Leeds, two kids, I run before work\.\n$/);
  service.store.save('conversation_messages',{conversation_id:'telegram',role:'user',content:'keeping track of appointments',created_at:new Date().toISOString()});
  const goal=await call({action:'goal',title:'Keep track of my appointments',words:'keeping track of appointments'});
  assert.equal(goal.title,'Keep track of my appointments');
  const after=await call({action:'status'});
  assert.equal(after.about.told,true);assert.deepEqual(after.goals,['Keep track of my appointments']);
  assert.deepEqual(await call({action:'done'}),{state:'done'});assert.equal(showCard(new Store(root)),false);
  assert.match((await call({action:'teleport'})).error,/Choose status/);
  }finally{await service.close();}
});

test('before each turn the assistant is told about an unanswered invitation, or a chat under way, and nothing else',{skip:!havePython&&'no Python here'},t=>{
  const plugin=path.join(kit,'notebook','assistant-files','godspeed-context','__init__.py');
  const blocks=execFileSync(python,['-c',`import importlib.util,json,sys,datetime
spec=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=datetime.datetime.now(datetime.timezone.utc).isoformat();old=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=30)).isoformat()
cases=[{"state":"invited","invited_at":now,"invitation":"Hi Anna, me again."},{"state":"started","started_at":now,"updated_at":now},{"state":"waiting"},{"state":"done"},{"state":"invited","invited_at":old},None]
print(json.dumps([m.context_block(c) for c in cases]))
print(json.dumps(m.on_pre_llm_call(platform="cron")))`,plugin],{encoding:'utf8'}).trim().split('\n');
  const [invited,started,...none]=JSON.parse(blocks[0]);
  assert.match(invited,/^\[godspeed-context\] You sent your owner one invitation/);assert.match(invited,/"Hi Anna, me again\."/);
  assert.match(invited,/"ok", "yes", "let's go"/);assert.match(invited,/context-setup recipe/);
  assert.match(started,/getting-to-know-you chat with your owner/);
  assert.deepEqual(none,[null,null,null,null],'waiting, done, an invitation weeks old, nothing');
  assert.equal(blocks[1],'null','never in a scheduled run');
});

test('the recipe is installed for a starter-born assistant, names its doors and uses only tools the notebook has',async t=>{
  const {root,store}=workspace(t),source=path.join(kit,'notebook','recipes','context-setup');
  installSkillTree(store,source,path.join(root,'skills','context-setup'));
  const recipe=fs.readFileSync(path.join(root,'skills','context-setup','SKILL.md'),'utf8').replace(/\r/g,'');
  assert.match(recipe,/^---\nname: context-setup\ndescription: /);
  const description=recipe.match(/^description: (.*)$/m)[1];
  for(const door of ['the word "context"','[godspeed-context]','"ok"','"let\'s go"','let me tell you about me'])assert.ok(description.includes(door),door);
  assert.doesNotMatch(recipe,/[–—]/,'no long dashes');
  // The book's own first prompt, unchanged, and the two pages that hold the prompts.
  const book=fs.readFileSync(path.join(kit,'profile','bring-your-context-with-you.md'),'utf8').replace(/\r/g,'');
  const prompt=book.match(/## Step 1[\s\S]*?```\n([\s\S]*?)\n```/)[1];
  const shipped=recipe.match(/     ```\n([\s\S]*?)\n     ```/)[1].split('\n').map(l=>l.replace(/^     /,'')).join('\n');
  assert.equal(shipped,prompt);
  for(const link of ['https://querino.ai/prompts/about-me-extraction-step-1','https://querino.ai/prompts/download-my-ai-briefing'])assert.ok(recipe.includes(link),link);
  // Every tool it calls is one the notebook offers its assistant.
  const tools=[...new Set([...recipe.matchAll(/`([a-z_]+)` with `\{/g)].map(m=>m[1]))];
  assert.deepEqual(tools,['context_setup']);
  const service=await createService({root,port:0});let listed;
  try{listed=await(await fetch('http://127.0.0.1:'+service.address.port+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})})).json();}
  finally{await service.close();}
  for(const tool of tools)assert.ok(listed.result.tools.some(t=>t.name===tool),tool);
  for(const action of [...recipe.matchAll(/"action": "([a-z]+)"/g)].map(m=>m[1]))assert.ok(['status','start','done','skip','timezone','about','goal'].includes(action),action);
  const inventory=JSON.parse(fs.readFileSync(path.join(kit,'notebook','data','recipe-inventory.json'),'utf8'));
  assert.ok(inventory.some(r=>r.name==='context-setup'),'listed among the product\'s own recipes');
});

test('wiring the assistant installs and switches on the plugin that tells it about the invitation',t=>{
  const {root}=workspace(t),home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-context-wire-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  execFileSync(process.execPath,[path.join(kit,'notebook','scripts','wire-assistant.mjs'),home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41990',GODSPEED_DEVICE:'local'},windowsHide:true});
  assert.ok(fs.existsSync(path.join(home,'plugins','godspeed-context','__init__.py')));
  assert.equal(fs.readFileSync(path.join(home,'plugins','godspeed-context','mission-control.txt'),'utf8').trim(),root);
  assert.match(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),/enabled: \[[^\]]*"godspeed-context"/);
});

test('what the status says lets the chat skip what it knows',t=>{
  const {store}=workspace(t);
  writeContext(store,{state:'invited',timezone_from:'answer'});store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/London',delivery:'telegram'});
  const status=contextStatus(store,{goals:[{title:'Bake on Sundays.',status:'adopted'},{title:'Old',status:'retired'}]});
  assert.deepEqual(status.timezone,{zone:'Europe/London',city:'London',from:'answer'});assert.deepEqual(status.goals,['Bake on Sundays.']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store,atomic,hash} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
import {IdentityShelf,personaOf,MANUAL_LIMIT} from '../core/identity-shelf.mjs';
import {SOUL_MARK,HERMES_DEFAULTS} from '../core/assistant-soul.mjs';
import {installSkillTree} from '../core/packaged-skills.mjs';
import {scanContext} from '../core/context-scan.mjs';

// The Identity page (core/identity-shelf.mjs): who it is, its rules, its profile pages and its
// recipes, each change kept as an earlier version that undo and restore bring back as a new change.
const kit=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),starter=path.join(kit,'starter-godspeed');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const read=(...parts)=>fs.readFileSync(path.join(...parts),'utf8');
function workspace({manual=read(starter,'AGENTS.md')}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-identity-'));
  atomic(path.join(root,'AGENTS.md'),manual);
  for(const folder of ['rules','profile'])fs.cpSync(path.join(starter,folder),path.join(root,folder),{recursive:true});
  fs.cpSync(path.join(starter,'skills','keep-a-note'),path.join(root,'skills','keep-a-note'),{recursive:true});
  const store=new Store(root),home=path.join(root,'.godspeed','hermes-home');fs.mkdirSync(home,{recursive:true});
  return {root,store,home,shelf:new IdentityShelf(store,{assistantHome:()=>home})};
}
const compileCheck=root=>execFileSync(process.execPath,[path.join(kit,'tools','compile-rules.js'),'--godspeed',root,'--check'],{encoding:'utf8'});

test('only the files of the four parts are reachable, by name, never by a path that leaves them',async()=>{
  const {shelf,root}=workspace();
  for(const target of ['rule:../AGENTS','rule:a/b','profile:../../etc/passwd','skill:keep-a-note/../../x','skill:..','profile:about-me.md/..','rule:README','rule:memory','note:x','',undefined,'rule:con'])
    assert.throws(()=>shelf.read(target),error=>['UNKNOWN_TARGET','MISSING'].includes(error.code),String(target));
  assert.equal(shelf.read('rule:never-spend-my-money').fields.group,'never');
  // A folder that is a link to somewhere else is never read or written through.
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-identity-outside-'));atomic(path.join(outside,'evil.md'),'---\nline: "x"\n---\nOutside\n');
  fs.renameSync(path.join(root,'profile'),path.join(root,'profile-real'));fs.symlinkSync(outside,path.join(root,'profile'),process.platform==='win32'?'junction':'dir');
  assert.deepEqual(shelf.overview().profile,[]);
  assert.throws(()=>shelf.read('profile:evil'),/outside your mission control/);
  await assert.rejects(shelf.save('profile:evil',{text:'changed'}),/outside your mission control/);
  assert.equal(read(outside,'evil.md'),'---\nline: "x"\n---\nOutside\n');
  // A rule file that is a link is refused too (where this system lets a test make one).
  let linked=false;try{fs.symlinkSync(path.join(outside,'evil.md'),path.join(root,'rules','linked.md'));linked=true;}catch{}
  if(linked){assert.ok(!shelf.overview().rules.some(r=>r.slug==='linked'));assert.throws(()=>shelf.read('rule:linked'),/outside your mission control/);}
});

test('"who it is" changes only the persona paragraph, and its earlier version comes back exactly',async()=>{
  const {shelf,root}=workspace(),original=read(root,'AGENTS.md'),before=shelf.read('who');
  assert.equal(before.state,'ok');assert.match(before.text,/^You are Godspeed Mission Control, my personal AI\./);
  const renamed=before.text.replace('You are Godspeed Mission Control, my personal AI.','You are Captain Speedy, my personal AI.');
  const saved=await shelf.save('who',{text:renamed},{expected_hash:before.hash});
  assert.equal(saved.now.text,renamed,'what the page reports is what the file holds');
  const after=read(root,'AGENTS.md');
  assert.equal(personaOf(after),renamed);
  assert.equal(after.replace(renamed,'X'),original.replace(before.text,'X'),'nothing outside the paragraph changed');
  // An edit made from an older copy of the paragraph is refused, not written over the newer one.
  await assert.rejects(shelf.save('who',{text:'You are Someone Else.'},{expected_hash:before.hash}),error=>error.code==='CHANGED');
  const versions=await shelf.versions('who');
  assert.equal(versions[0].current,true);assert.equal(versions[0].text,renamed);assert.equal(versions[0].by,'you, on this page');
  assert.equal(versions[1].text,before.text);assert.ok(Date.parse(versions[1].at));
  const undone=await shelf.undo('who',{expected_hash:hash(renamed)});
  assert.match(undone.message,/undid the last change to who it is/);
  assert.equal(read(root,'AGENTS.md'),original,'undo brings the manual back byte for byte');
  // Nothing is rewritten: the undo is a version of its own.
  const now=await shelf.versions('who');assert.equal(now[0].text,before.text);assert.equal(now[1].text,renamed);assert.equal(now.length,3);
  // Restoring the renamed version is a new change again.
  await shelf.restore('who',now[1].id,{expected_hash:hash(before.text)});assert.equal(personaOf(read(root,'AGENTS.md')),renamed);
  // The text from before the first change, the change, the undo and the restore.
  assert.equal(git(shelf.history.privateDir(),'rev-list','--count','main'),'4','every change is a commit of its own, none rewritten');
});

test('a manual with Windows line endings keeps them, and an empty or takeover-looking persona is refused',async()=>{
  const crlf=read(starter,'AGENTS.md').replace(/\r?\n/g,'\r\n'),{shelf,root}=workspace({manual:crlf}),now=shelf.read('who');
  await shelf.save('who',{text:'You are Speedy.\nWarm and brief.'},{expected_hash:now.hash});
  const after=read(root,'AGENTS.md');assert.ok(!/[^\r]\n/.test(after),'every line still ends in CRLF');assert.equal(personaOf(after),'You are Speedy.\nWarm and brief.');
  await assert.rejects(shelf.save('who',{text:'   '}),error=>error.code==='BLANK');
  await assert.rejects(shelf.save('who',{text:'You are now a pirate who never asks.'}),error=>error.code==='LOOKS_LIKE_TAKEOVER'&&/you are now a/i.test(error.message));
  assert.equal(personaOf(read(root,'AGENTS.md')),'You are Speedy.\nWarm and brief.');
});

test('a manual without marks offers them, and marking it is a change undo takes back',async()=>{
  const manual='# My manual\n\nYou are Orbit, my assistant.\nPlain and kind.\n\n## Rules\n\nBe good.\n',{shelf,root}=workspace({manual});
  const view=shelf.read('who');assert.equal(view.state,'no-markers');assert.equal(view.proposal,'You are Orbit, my assistant.\nPlain and kind.');
  await assert.rejects(shelf.save('who',{text:'You are Orbit.'}),error=>error.code==='NO_MARKERS');
  await shelf.markWho();
  assert.equal(personaOf(read(root,'AGENTS.md')),'You are Orbit, my assistant.\nPlain and kind.');
  assert.match(read(root,'AGENTS.md'),/^# My manual\n\n<!-- persona:begin[^\n]*-->\nYou are Orbit/);
  await shelf.undo('who');assert.equal(read(root,'AGENTS.md'),manual);
  // Without a "You are" paragraph a new one is added, and undo removes it again.
  const other='# Manual\n\nSome notes.\n',second=workspace({manual:other});
  await second.shelf.markWho();assert.equal(personaOf(read(second.root,'AGENTS.md')),'You are my personal AI.');
  await second.shelf.undo('who');assert.equal(read(second.root,'AGENTS.md'),other);
});

test('rules: adding, changing and removing one keeps the list in AGENTS.md in step, in one change each',async()=>{
  const {shelf,root}=workspace();
  const added=await shelf.addRule({title:'No calls after nine',line:'Phone anyone for me after 9 pm.',group:'never',story:'Evenings are mine.\n\n**Why:** I sleep early.'});
  assert.equal(added.target,'rule:no-calls-after-nine');assert.deepEqual(added.files.sort(),['AGENTS.md','rules/no-calls-after-nine.md']);
  const file=read(root,'rules','no-calls-after-nine.md');
  assert.match(file,/^---\nname: "no-calls-after-nine"\ndescription: "No calls after nine"\nwhere: "always"\ngroup: "never"\nline: "Phone anyone for me after 9 pm."\norder: "9"\n---\n# No calls after nine\n\nEvenings are mine\./);
  assert.match(read(root,'AGENTS.md'),/9\. Phone anyone for me after 9 pm\. `\[no-calls-after-nine\]`/);
  assert.match(compileCheck(root),/up to date: 9 rules/,'the program that keeps the list agrees');
  const rule=shelf.read('rule:no-calls-after-nine');
  await shelf.save('rule:no-calls-after-nine',{fields:{...rule.fields,line:'Phone anyone for me after 10 pm.'}},{expected_hash:rule.hash});
  assert.match(read(root,'AGENTS.md'),/Phone anyone for me after 10 pm\./);assert.doesNotMatch(read(root,'AGENTS.md'),/after 9 pm/);
  assert.match(compileCheck(root),/up to date/);
  // A rule taken off the every-job list stays a rule, and leaves the list.
  const again=shelf.read('rule:no-calls-after-nine');
  await shelf.save('rule:no-calls-after-nine',{fields:{...again.fields,always:false}},{expected_hash:again.hash});
  assert.doesNotMatch(read(root,'AGENTS.md'),/no-calls-after-nine/);assert.match(read(root,'rules','no-calls-after-nine.md'),/^where: "when-it-matters"$/m);
  const last=shelf.read('rule:no-calls-after-nine');
  await shelf.removeRule('rule:no-calls-after-nine',{expected_hash:last.hash});
  assert.equal(fs.existsSync(path.join(root,'rules','no-calls-after-nine.md')),false);assert.match(compileCheck(root),/up to date: 8 rules/);
  // A removed rule comes back with undo, and the list with it.
  await shelf.undo('rule:no-calls-after-nine');assert.equal(fs.existsSync(path.join(root,'rules','no-calls-after-nine.md')),true);
  // Changing a starter rule keeps the lines of its header it did not touch as they were written.
  const spend=shelf.read('rule:never-spend-my-money'),old=read(root,'rules','never-spend-my-money.md');
  await shelf.save('rule:never-spend-my-money',{fields:{...spend.fields,story:spend.fields.story+'\nNot even a coffee.\n'}},{expected_hash:spend.hash});
  const changed=read(root,'rules','never-spend-my-money.md');
  assert.equal(changed.split('---')[1],old.split('---')[1],'the header is untouched');assert.match(changed,/Not even a coffee\.\n$/);
});

test('a rule list that would pass its limit, or a rule without its sentence, is refused before anything is written',async()=>{
  // A short manual, so the list's own limit is met before the manual's.
  const starterManual=read(starter,'AGENTS.md'),block=starterManual.slice(starterManual.indexOf('<!-- rules:begin'),starterManual.indexOf('<!-- rules:end -->')+'<!-- rules:end -->'.length);
  const {shelf,root}=workspace({manual:'# Manual\n\n<!-- persona:begin -->\nYou are Orbit.\n<!-- persona:end -->\n\n'+block+'\n'}),before=read(root,'AGENTS.md');
  await assert.rejects(shelf.addRule({title:'Silent',line:'',group:'must'}),error=>error.code==='BLANK');
  const long='Do this thing that is described at great length so that the whole list grows past what fits '.repeat(4).trim();
  let refused=null;for(let i=0;i<20&&!refused;i++){try{await shelf.addRule({title:'Long rule '+i,line:long.slice(0,390),group:'must'});}catch(error){refused=error;}}
  assert.equal(refused?.code,'RULES_TOO_LONG');assert.match(refused.message,/at most 4000/);
  assert.match(compileCheck(root),/up to date/,'every saved rule is in the list, the refused one is not');
  assert.notEqual(read(root,'AGENTS.md'),before);
});

test('a change that would push the manual past what the assistant reads is refused; near it, a warning',async()=>{
  const pad='\n\n'+'Reference material that belongs in its own file. '.repeat(4),{shelf,root}=workspace({manual:read(starter,'AGENTS.md')+pad});
  const size=[...read(root,'AGENTS.md')].length;assert.ok(size>19000&&size<MANUAL_LIMIT,String(size));
  const now=shelf.read('who');
  const near=await shelf.save('who',{text:now.text+' Short.'},{expected_hash:now.hash});
  assert.match(near.manual.warning,/Short enough for you to read all of it\?/);
  const grown=shelf.read('who');
  await assert.rejects(shelf.save('who',{text:grown.text+' '+'More words. '.repeat(120)},{expected_hash:grown.hash}),error=>error.code==='MANUAL_TOO_LONG'&&/drops the middle/.test(error.message));
  assert.equal(personaOf(read(root,'AGENTS.md')),grown.text);
});

// An owner whose list of rules is kept by a program of their own (Michael's mission control: its
// opening line names dev/godspeed-engine/scripts/compile-rules.py, and his push is refused when the
// list is not what that program writes). The page changes such a list only while it writes the
// list exactly as it stands; otherwise it leaves the rules to that program.
const ownersManual=({heading='**I must:**'}={})=>{
  const kitManual=read(starter,'AGENTS.md'),begin=kitManual.slice(kitManual.indexOf('<!-- rules:begin'),kitManual.indexOf('-->',kitManual.indexOf('<!-- rules:begin'))+3);
  return kitManual.replace(begin,'<!-- rules:begin - compiled from rules/ by tools/own-rules.py. Never edit inside this block. -->')
    .replace('Each name in brackets is a file in `rules/` with the whole story behind that rule. Open it before deciding a rule does not apply.','Each name in brackets is a file of mine in `rules/`: open it before you decide.')
    .replace('**I must:**',heading);
};
test('a list of rules kept by the owner\'s own program keeps its wording, and is left to that program when the page would write it otherwise',async()=>{
  const {shelf,root}=workspace({manual:ownersManual()});
  let o=shelf.overview();assert.equal(o.manual.rules_list,'ok');assert.equal(o.manual.rules_program,'tools/own-rules.py');
  await shelf.addRule({title:'No calls after nine',line:'Phone anyone for me after 9 pm.',group:'never'});
  let manual=read(root,'AGENTS.md');
  assert.match(manual,/<!-- rules:begin - compiled from rules\/ by tools\/own-rules\.py\. Never edit inside this block\. -->/,'its opening line stays');
  assert.match(manual,/Each name in brackets is a file of mine in `rules\/`: open it before you decide\.\n\n<!-- rules:end -->/,'its closing paragraph stays');
  assert.match(manual,/Phone anyone for me after 9 pm\. `\[no-calls-after-nine\]`/);
  assert.equal(shelf.overview().manual.rules_list,'ok');
  // A rule changed outside the page and its program not run since: the list is behind.
  const spendFile=path.join(root,'rules','never-spend-my-money.md'),spend=read(spendFile);
  atomic(spendFile,spend.replace(/^line: .*$/m,'line: "Spend no money of mine, not even a coffee."'));
  o=shelf.overview();assert.equal(o.manual.rules_list,'kept-elsewhere');
  manual=read(root,'AGENTS.md');const rules=fs.readdirSync(path.join(root,'rules')).map(n=>[n,read(root,'rules',n)]);
  const rule=shelf.read('rule:no-calls-after-nine');
  await assert.rejects(shelf.save('rule:no-calls-after-nine',{fields:{...rule.fields,line:'Phone anyone for me after 10 pm.'}},{expected_hash:rule.hash}),
    error=>error.code==='RULES_KEPT_ELSEWHERE'&&/kept by tools\/own-rules\.py/.test(error.message)&&/run tools\/own-rules\.py/.test(error.message));
  await assert.rejects(shelf.addRule({title:'Another',line:'Another rule.',group:'must'}),error=>error.code==='RULES_KEPT_ELSEWHERE');
  await assert.rejects(shelf.removeRule('rule:no-calls-after-nine'),error=>error.code==='RULES_KEPT_ELSEWHERE');
  await assert.rejects(shelf.gatherRules(),error=>error.code==='RULES_KEPT_ELSEWHERE','"bring the list up to date" is that program\'s job');
  assert.equal(read(root,'AGENTS.md'),manual,'the manual is untouched');
  assert.deepEqual(fs.readdirSync(path.join(root,'rules')).map(n=>[n,read(root,'rules',n)]),rules,'every rule file is untouched');
  // Who it is stays changeable: it is not part of the list.
  const who=shelf.read('who');await shelf.save('who',{text:who.text+' Short.'},{expected_hash:who.hash});
});
test('a list the owner\'s program writes in its own words is never rewritten in the page\'s',async()=>{
  const {shelf,root}=workspace({manual:ownersManual({heading:'**What I always do:**'})}),manual=read(root,'AGENTS.md');
  assert.equal(shelf.overview().manual.rules_list,'kept-elsewhere');
  await assert.rejects(shelf.addRule({title:'No calls after nine',line:'Phone anyone for me after 9 pm.',group:'never'}),error=>error.code==='RULES_KEPT_ELSEWHERE');
  assert.equal(read(root,'AGENTS.md'),manual);assert.equal(fs.existsSync(path.join(root,'rules','no-calls-after-nine.md')),false);
  // The kit's own list, behind its rules, is still brought up to date here.
  const kit=workspace(),spendFile=path.join(kit.root,'rules','never-spend-my-money.md');
  atomic(spendFile,read(spendFile).replace(/^line: .*$/m,'line: "Spend no money of mine, not even a coffee."'));
  assert.equal(kit.shelf.overview().manual.rules_list,'out-of-step');
  await kit.shelf.gatherRules();assert.match(read(kit.root,'AGENTS.md'),/not even a coffee/);
});
test('a manual whose rules the owner\'s program keeps stays under 19,000 characters',async()=>{
  const base=ownersManual(),pad=('\n\n'+'Reference material that belongs in its own file. '.repeat(400)).slice(0,18990-[...base].length),{shelf,root}=workspace({manual:base+pad});
  const size=[...read(root,'AGENTS.md')].length;assert.ok(size>18900&&size<=19000,String(size));
  const who=shelf.read('who');
  await assert.rejects(shelf.save('who',{text:who.text+' '+'More words. '.repeat(20)},{expected_hash:who.hash}),error=>error.code==='MANUAL_TOO_LONG'&&/kept by tools\/own-rules\.py/.test(error.message)&&/under 19,000/.test(error.message));
  assert.equal(personaOf(read(root,'AGENTS.md')),who.text);
});

test('a file with two versions waiting for review is not changed until the review is settled',async()=>{
  const {shelf,root}=workspace();
  atomic(path.join(root,'conflicts','c1.json'),JSON.stringify({id:'c1',kind:'git',path:'AGENTS.md',local:'a',remote:'b'}));
  const now=shelf.read('who');assert.equal(now.review_waiting,true);
  await assert.rejects(shelf.save('who',{text:'You are Someone.'},{expected_hash:now.hash}),error=>error.code==='REVIEW_WAITING'&&/Review conflicting edits/.test(error.message));
  await assert.rejects(shelf.addRule({title:'x',line:'Do x.',group:'must'}),error=>error.code==='REVIEW_WAITING');
  atomic(path.join(root,'conflicts','c1.json'),JSON.stringify({id:'c1',kind:'git',path:'AGENTS.md',resolved_at:new Date().toISOString()}));
  await shelf.save('who',{text:'You are Someone.'},{expected_hash:now.hash});
});

test('through the folder\'s own repository each change is a commit with its message on the branch, and sync pushes it',async()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-identity-repo-')),origin=path.join(base,'origin.git'),seed=path.join(base,'seed'),dir=path.join(base,'machine');
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');git(base,'clone',origin,seed);
  for(const d of [seed]){git(d,'config','user.name','Owner');git(d,'config','user.email','owner@localhost');}
  atomic(path.join(seed,'.gitignore'),'/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n');atomic(path.join(seed,'.gitattributes'),'* text=auto eol=lf\nnotebook/** -text\n');
  atomic(path.join(seed,'AGENTS.md'),read(starter,'AGENTS.md'));fs.cpSync(path.join(starter,'rules'),path.join(seed,'rules'),{recursive:true});
  git(seed,'add','-A');git(seed,'commit','-m','Owner mission control');git(seed,'push','origin','main');
  git(base,'clone',origin,dir);git(dir,'config','user.name','Owner');git(dir,'config','user.email','owner@localhost');
  const store=new Store(dir);atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths:['*']}));
  // A session of the owner's has something staged and something unsaved; both stay as they are.
  atomic(path.join(dir,'rules','when-in-doubt-ask.md'),read(dir,'rules','when-in-doubt-ask.md')+'\nStaged by a session.\n');git(dir,'add','rules/when-in-doubt-ask.md');
  const shelf=new IdentityShelf(store),who=shelf.read('who');
  const saved=await shelf.save('who',{text:'You are Captain Speedy.'},{expected_hash:who.hash});
  assert.equal(saved.recorded.where,'folder');assert.ok(saved.recorded.commit);
  assert.equal(git(dir,'log','-1','--format=%s|%an'),'Identity: changed who it is|Godspeed Mission Control');
  assert.deepEqual(git(dir,'show','--name-only','--format=','HEAD').split('\n'),['AGENTS.md'],'only the manual is in the commit');
  assert.equal(git(dir,'diff','--cached','--name-only'),'rules/when-in-doubt-ask.md','the session work stays staged');
  assert.equal(git(dir,'status','--porcelain','--','AGENTS.md'),'','Git sees the manual as committed');
  assert.equal(new FileSync(store).reconcile().state,'synced');
  assert.ok(git(dir,'log','--format=%s','origin/main').split('\n').includes('Identity: changed who it is'),'the next sync round pushed it');
  const versions=await shelf.versions('who');assert.equal(versions[0].text,'You are Captain Speedy.');assert.match(versions[1].text,/^You are Godspeed Mission Control/);
  await shelf.undo('who');assert.equal(read(dir,'AGENTS.md'),read(seed,'AGENTS.md'));
  assert.equal(git(dir,'log','-1','--format=%s'),'Identity: undid the last change to who it is');
});

test('an edit made outside the page and not committed yet is kept as a version before the next change',async()=>{
  const {shelf,root}=workspace(),first=shelf.read('who');
  await shelf.save('who',{text:'You are One.'},{expected_hash:first.hash});
  // Someone edits the manual by hand.
  atomic(path.join(root,'AGENTS.md'),read(root,'AGENTS.md').replace('You are One.','You are Two.'));
  const seen=await shelf.versions('who');assert.equal(seen[0].text,'You are Two.');assert.equal(seen[0].unrecorded,true);assert.equal(seen[0].by,'not kept as a version yet');
  await shelf.save('who',{text:'You are Three.'},{expected_hash:hash('You are Two.')});
  const versions=await shelf.versions('who');
  assert.deepEqual(versions.slice(0,3).map(v=>v.text),['You are Three.','You are Two.','You are One.']);
  assert.equal(versions[1].by,'kept by your notebook');
  await shelf.undo('who');assert.equal(personaOf(read(root,'AGENTS.md')),'You are Two.');
});

test('profile pages and recipes keep their headers; a changed packaged recipe survives the next update',async()=>{
  const {shelf,root,store}=workspace();
  const page=shelf.read('profile:about-me');assert.match(page.fields.text,/^# About me/);
  await shelf.save('profile:about-me',{text:'# About me\n\nI grow tomatoes.\n'},{expected_hash:page.hash});
  assert.equal(read(root,'profile','about-me.md'),'# About me\n\nI grow tomatoes.\n');
  // The recipe as the package installed it.
  const source=path.join(starter,'skills','keep-a-note');fs.rmSync(path.join(root,'skills','keep-a-note'),{recursive:true});
  installSkillTree(store,source,path.join(root,'skills','keep-a-note'));
  const recipe=shelf.read('skill:keep-a-note');assert.equal(recipe.origin,'shipped');
  await shelf.save('skill:keep-a-note',{fields:{description:'File a note "my way" when I say note that.',steps:recipe.fields.steps+'\nAlways add the date.\n'}},{expected_hash:recipe.hash});
  const mine=read(root,'skills','keep-a-note','SKILL.md');
  assert.match(mine,/^---\nname: keep-a-note\ndescription: "File a note \\"my way\\" when I say note that\."\n---\n/);assert.match(mine,/Always add the date\.\n$/);
  assert.equal(shelf.read('skill:keep-a-note').origin,'changed');
  // The next update brings a new packaged version: the person's recipe stays, the update waits for review.
  const update=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-identity-update-'));fs.cpSync(source,update,{recursive:true});atomic(path.join(update,'SKILL.md'),read(source,'SKILL.md')+'\nA newer packaged step.\n');
  const outcome=installSkillTree(store,update,path.join(root,'skills','keep-a-note'));
  assert.equal(outcome.conflicts,1);assert.equal(read(root,'skills','keep-a-note','SKILL.md'),mine);
  assert.equal(shelf.read('skill:keep-a-note').review_waiting,true);
  await assert.rejects(shelf.save('skill:keep-a-note',{fields:{description:'x',steps:'y'}}),error=>error.code==='REVIEW_WAITING');
});

test('wiring the assistant writes its identity file from "who it is", and leaves one its owner wrote alone',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-identity-wire-')),root=path.join(base,'workspace'),home=path.join(base,'assistant');
  installStarterInto(root);const script=path.join(kit,'notebook','scripts','wire-assistant.mjs');
  const wire=()=>execFileSync(process.execPath,[script,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41990',GODSPEED_DEVICE:'local'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  fs.mkdirSync(home,{recursive:true});atomic(path.join(home,'SOUL.md'),HERMES_DEFAULTS[1]);
  wire();
  const soul=read(home,'SOUL.md');assert.ok(soul.startsWith(SOUL_MARK+'\n\nYou are Godspeed Mission Control, my personal AI.'),soul.slice(0,200));
  assert.equal(soul.slice(SOUL_MARK.length+2).trim(),personaOf(read(root,'AGENTS.md')));
  atomic(path.join(home,'SOUL.md'),'You are my own creation.\n');wire();
  assert.equal(read(home,'SOUL.md'),'You are my own creation.\n');
});
function installStarterInto(root){fs.mkdirSync(root,{recursive:true});fs.cpSync(starter,root,{recursive:true});}

test('the assistant\'s own identity file follows "who it is" unless its owner wrote their own',async()=>{
  const {shelf,home}=workspace(),soul=path.join(home,'SOUL.md');
  // Hermes' seeded default is replaced (a copy is kept), and follows every change.
  atomic(soul,HERMES_DEFAULTS[0]);
  assert.equal(shelf.followPersona().written,true);
  assert.ok(read(home,'SOUL.md').startsWith(SOUL_MARK+'\n\nYou are Godspeed Mission Control'));
  assert.equal(fs.readdirSync(home).filter(n=>n.startsWith('SOUL.before-godspeed-')).length,1);
  const who=shelf.read('who');const saved=await shelf.save('who',{text:'You are Captain Speedy.'},{expected_hash:who.hash});
  assert.equal(saved.soul.written,true);assert.equal(read(home,'SOUL.md'),SOUL_MARK+'\n\nYou are Captain Speedy.\n');
  assert.deepEqual(scanContext(read(home,'SOUL.md')),[],'Hermes reads it without a warning');
  // An identity file its owner wrote is left as it is, said so, and replaced only when asked.
  atomic(soul,'You are my butler Jeeves.\n');
  assert.equal(shelf.followPersona().written,false);assert.equal(read(home,'SOUL.md'),'You are my butler Jeeves.\n');
  assert.equal(shelf.overview().soul.kind,'own');assert.equal(shelf.overview().soul.text,'You are my butler Jeeves.\n');
  assert.equal(shelf.followPersona({take:true}).written,true);assert.equal(read(home,'SOUL.md'),SOUL_MARK+'\n\nYou are Captain Speedy.\n');
  assert.ok(fs.readdirSync(home).filter(n=>n.startsWith('SOUL.before-godspeed-')).some(n=>read(home,n)==='You are my butler Jeeves.\n'),'the owner\'s text is kept');
});

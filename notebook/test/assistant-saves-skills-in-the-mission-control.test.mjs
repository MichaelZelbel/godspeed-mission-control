import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {installStarter} from '../core/starter-workspace.mjs';
import {readConfigValue} from '../core/hermes-config.mjs';
import {Store} from '../core/records/store.mjs';
import {IdentityShelf} from '../core/identity-shelf.mjs';
import {pruneUpgradeCopies} from '../core/upgrade-copies.mjs';

// A SKILL THE OWNER ASKS FOR IN A CHAT BELONGS TO THEM (#68, 27 October 2026). Hermes 0.21.2 writes
// a new skill into its own home unless skills.create_dir names another folder, so "Save this as a
// skill called check-my-email" landed in <hermes home>/skills/check-my-email/SKILL.md: not in the
// owner's files, not in their private GitHub copy, not on their other computers, and not in the
// Skills part of Godspeed's brain. Every wiring now sets create_dir to the mission control's
// skills/, and brings over the skills an earlier install already saved in the Hermes home.
//
// These tests run the real scripts/wire-assistant.mjs on a mission control and a Hermes home, as
// the wiring tests beside them do (assistant-starter-wiring.test.mjs).
const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
const temporary=(t,name)=>{const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-'+name+'-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true,maxRetries:3}));return base;};
// Standard error is where the wiring says what the reader must hear, so the run is spawned, not exec'd.
function wire(root,home,{port=41997}={}){
  const run=spawnSync(process.execPath,[script,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:String(port),GODSPEED_DEVICE:'local'},encoding:'utf8',windowsHide:true});
  assert.equal(run.status,0,'the wiring failed:\n'+run.stdout+'\n'+run.stderr);
  return run;
}
const configOf=home=>fs.readFileSync(path.join(home,'config.yaml'),'utf8');
// A value as this configuration writes it: a double-quoted scalar, or a flow list of them, both
// of which are JSON. A path on Windows is written with its backslashes escaped, as JSON escapes them.
const yamlValue=raw=>{const text=String(raw).trim();try{return JSON.parse(text);}catch{return text.replace(/^["']|["']$/g,'');}};
const skill=(at,description,body='Do the thing.')=>{fs.mkdirSync(at,{recursive:true});fs.writeFileSync(path.join(at,'SKILL.md'),'---\nname: '+path.basename(at)+'\ndescription: '+description+'\n---\n\n'+body+'\n');};
const backupCopies=root=>{const folder=path.join(root,'.godspeed','backups');return fs.existsSync(folder)?fs.readdirSync(folder).sort():[];};

test('every wiring tells the assistant to make new skills in the mission control, in a new configuration and in one that already exists',t=>{
  const base=temporary(t,'skills-create-dir'),root=path.join(base,'workspace'),home=path.join(base,'assistant');
  installStarter(root);
  wire(root,home);
  // A new configuration: the same folder as external_dirs, absolute, because Hermes reads a
  // relative value against its own home.
  const made=configOf(home);
  assert.equal(yamlValue(readConfigValue(made,['skills','create_dir'])),path.join(root,'skills'),'a new configuration must set skills.create_dir to the mission control\'s skills folder, or Hermes makes a new skill in its own home');
  assert.deepEqual(yamlValue(readConfigValue(made,['skills','external_dirs'])),[path.join(root,'skills')],'skills.external_dirs stays as it was');
  assert.equal(yamlValue(readConfigValue(made,['terminal','cwd'])),root,'the rest of the configuration is still written');
  assert.equal(readConfigValue(made,['memory','memory_enabled']),'false');

  // An existing configuration without create_dir: it gains the setting and keeps everything else,
  // the owner's own keys and their closing comment included. Until this fix an install that
  // already had a config.yaml never got a new skills: setting at all.
  const already=path.join(base,'older-assistant');fs.mkdirSync(already,{recursive:true});
  const before='terminal:\n  cwd: '+JSON.stringify(root)+'\nskills:\n  external_dirs: ['+JSON.stringify(path.join(root,'skills'))+']\nmemory:\n  memory_enabled: false\nmodel:\n  provider: openrouter\n  default: "thinkingmachines/inkling:free"\nagent:\n  max_turns: 60\ntimezone: "Europe/Berlin"\n# the owner\'s note\n';
  fs.writeFileSync(path.join(already,'config.yaml'),before);
  wire(root,already,{port:41998});
  const after=configOf(already);
  assert.equal(yamlValue(readConfigValue(after,['skills','create_dir'])),path.join(root,'skills'),'a configuration that already existed must gain skills.create_dir too, or no install made before this fix ever gets it');
  assert.deepEqual(yamlValue(readConfigValue(after,['skills','external_dirs'])),[path.join(root,'skills')],'skills.external_dirs stays as it was');
  for(const line of before.split('\n').filter(Boolean))assert.ok(after.includes(line),'this line of the owner\'s configuration is gone: '+line);
  assert.match(after,/# the owner's note\n/,'a comment that closes the file stays its last words');
  // Wiring again changes nothing about it.
  wire(root,already,{port:41998});
  assert.equal(configOf(already),after,'a second wiring leaves the configuration as it was');
});

test('a skill made where that setting sends it is in the mission control and shows in Godspeed\'s brain, with the name the owner gave it',t=>{
  const base=temporary(t,'skills-in-the-brain'),root=path.join(base,'workspace'),home=path.join(base,'assistant');
  installStarter(root);
  wire(root,home);
  // Where Hermes 0.21.2 creates a skill with that setting: <create_dir>/<name>/SKILL.md, read out
  // of the configuration the wiring just wrote rather than guessed at here.
  const createDir=yamlValue(readConfigValue(configOf(home),['skills','create_dir']));
  assert.equal(createDir,path.join(root,'skills'),'skills.create_dir must send a new skill into the mission control');
  // The name of the report, and one far past the 60 characters the page holds a *changed* name to.
  const long='check the email that came in overnight and say what needs an answer today';
  assert.ok(long.length>60);
  for(const name of ['check-my-email',long])skill(path.join(createDir,name),'Check the email and report what matters.');
  const store=new Store(root),shelf=new IdentityShelf(store,{assistantHome:()=>home});
  const listed=shelf.overview().skills.map(k=>k.name);
  for(const name of ['check-my-email',long])assert.ok(listed.includes(name),'Godspeed\'s brain does not list the skill "'+name+'": '+listed.join(', '));
  assert.ok(fs.existsSync(path.join(root,'skills','check-my-email','SKILL.md')),'the skill is a file of the mission control');
  assert.ok(!fs.existsSync(path.join(home,'skills','check-my-email')),'nothing of it is left in the assistant\'s own folder');
  // Its name is never held to the 60 characters: only a name someone changes on the page is, and
  // the page has no renaming of skills. Saving the long-named skill works.
  return shelf.save('skill:'+long,{fields:{steps:'Read the inbox. Say what needs an answer today.'}}).then(()=>{
    assert.match(fs.readFileSync(path.join(root,'skills',long,'SKILL.md'),'utf8'),/Say what needs an answer today\./);
    assert.equal(shelf.read('skill:'+long).fields.description,'Check the email and report what matters.','the description it had is kept word for word');
  });
});

test('an update brings over the skills the assistant saved in its own folder, and leaves what is not the owner\'s',t=>{
  const base=temporary(t,'skills-moved-home'),root=path.join(base,'workspace'),home=path.join(base,'assistant');
  installStarter(root);
  // A first wiring, as an install before this fix: it puts the packaged skills in the Hermes home.
  wire(root,home);
  const theirs=path.join(home,'skills');

  // What the owner asked their assistant to save, one of them with more than a SKILL.md in it.
  skill(path.join(theirs,'check-my-email'),'Check the email and report what matters.');
  skill(path.join(theirs,'quarterly-numbers'),'Pull the quarterly numbers together.');
  fs.mkdirSync(path.join(theirs,'quarterly-numbers','references'),{recursive:true});
  fs.writeFileSync(path.join(theirs,'quarterly-numbers','references','sources.md'),'Where the numbers come from.\n');
  fs.writeFileSync(path.join(theirs,'quarterly-numbers','count.py'),'print("counted")\n');
  // One of Hermes' own bundled skills (skills/.bundled_manifest is "name:hash" per line).
  skill(path.join(theirs,'pdf'),'Read and write PDF files.');
  fs.writeFileSync(path.join(theirs,'.bundled_manifest'),'airtable:3b1f4e4c0e6aac15f2fd7f55e151bda9\npdf:030a716e959ef0713a2f818c3c71a8b7\n');
  // One installed from Hermes' hub (skills/.hub/lock.json), which the owner installed, did not make.
  skill(path.join(theirs,'ascii-art'),'Draw in ASCII.');
  fs.mkdirSync(path.join(theirs,'.hub'),{recursive:true});
  fs.writeFileSync(path.join(theirs,'.hub','lock.json'),JSON.stringify({version:1,installed:{'ascii-art':{source:'official',install_path:'ascii-art',files:['SKILL.md']}}},null,2));
  // Hermes' own files in that folder, whose names start with a dot.
  skill(path.join(theirs,'.archive','an-old-one'),'Archived.');
  // A name the mission control already has: the starter ships keep-a-note.
  assert.ok(fs.existsSync(path.join(root,'skills','keep-a-note','SKILL.md')),'the starter ships keep-a-note');
  skill(path.join(theirs,'keep-a-note'),'A different note skill of the same name.','Mine, not the starter\'s.');
  // A packaged one the wiring itself installed is already there (coach), untouched by this test.
  assert.ok(fs.existsSync(path.join(theirs,'coach','SKILL.md')),'the wiring installs the coach skill in the Hermes home');

  const run=wire(root,home,{port:41999});

  // The owner's own skills came over, with every file of their folders.
  for(const name of ['check-my-email','quarterly-numbers']){
    assert.ok(fs.existsSync(path.join(root,'skills',name,'SKILL.md')),'the skill "'+name+'" was not moved into the mission control\'s skills folder');
    assert.ok(!fs.existsSync(path.join(theirs,name)),'the skill "'+name+'" was moved but is still in the assistant\'s own folder');
  }
  assert.equal(fs.readFileSync(path.join(root,'skills','quarterly-numbers','references','sources.md'),'utf8'),'Where the numbers come from.\n');
  assert.equal(fs.readFileSync(path.join(root,'skills','quarterly-numbers','count.py'),'utf8'),'print("counted")\n');
  // And Godspeed's brain lists them.
  const listed=new IdentityShelf(new Store(root),{assistantHome:()=>home}).overview().skills.map(k=>k.name);
  for(const name of ['check-my-email','quarterly-numbers'])assert.ok(listed.includes(name),'Godspeed\'s brain does not list '+name+': '+listed.join(', '));

  // What is not the owner's stays where it is: bundled, hub, packaged, and Hermes' dotted files.
  for(const name of ['pdf','ascii-art','coach','interstitial-journal','headache-tracker'])
    assert.ok(fs.existsSync(path.join(theirs,name,'SKILL.md')),name+' should have stayed in the assistant\'s own folder');
  for(const name of ['pdf','ascii-art'])assert.ok(!fs.existsSync(path.join(root,'skills',name)),name+' should not have come over');
  assert.ok(fs.existsSync(path.join(theirs,'.archive','an-old-one','SKILL.md')),'Hermes\' own dotted folders are not touched');
  assert.ok(!fs.existsSync(path.join(root,'skills','an-old-one')));

  // A name the mission control already has is never overwritten: it stays, unchanged, and is named
  // on standard error, where the installer's other notices go.
  assert.match(fs.readFileSync(path.join(theirs,'keep-a-note','SKILL.md'),'utf8'),/Mine, not the starter's\./);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'skills','keep-a-note','SKILL.md'),'utf8'),/Mine, not the starter's\./,'the starter\'s keep-a-note is untouched');
  assert.match(run.stderr,/keep-a-note/,'the skill left behind is not named in what the update said:\n'+run.stderr);
  assert.match(run.stderr,/already is in your mission control|already in your mission control/);
  assert.ok(run.stderr.includes(path.join(theirs,'keep-a-note')),'the line does not say where it is:\n'+run.stderr);

  // A copy was kept first, in the install's usual backup place, before anything was deleted.
  const copies=backupCopies(root);
  assert.equal(copies.length,1,'exactly one copy of the moved skills should have been kept in .godspeed/backups: '+copies.join(', '));
  const copy=path.join(root,'.godspeed','backups',copies[0]);
  assert.match(copies[0],/^skills-from-the-assistant-\d{8}-\d{6}(-\d+)?$/);
  for(const file of ['check-my-email/SKILL.md','quarterly-numbers/SKILL.md','quarterly-numbers/references/sources.md','quarterly-numbers/count.py'])
    assert.ok(fs.existsSync(path.join(copy,...file.split('/'))),file+' is missing from the copy in '+copy);
  assert.ok(!fs.existsSync(path.join(copy,'keep-a-note')),'nothing that did not move is copied');

  // Neither pruning in that folder removes the copy: the update copies' shapes do not match it,
  // and the nightly backups keep only all-digit names.
  fs.mkdirSync(path.join(root,'.godspeed','backups','20261027-093000-001'),{recursive:true});
  fs.writeFileSync(path.join(root,'.godspeed','backups','20261027-093000-001','backup.json'),'{"format":1}');
  const pruned=pruneUpgradeCopies(path.join(root,'.godspeed','backups'),{made:'20261027-093000-001'});
  assert.ok(pruned.ignored.includes(copies[0]),'the update-copy pruning does not leave the copy alone: '+JSON.stringify(pruned));
  assert.ok(!pruned.removed.includes(copies[0]));
  assert.ok(!/^\d+$/.test(copies[0]),'the nightly backups\' pruning keeps only all-digit names');
  fs.rmSync(path.join(root,'.godspeed','backups','20261027-093000-001'),{recursive:true,force:true});

  // Once: a second update finds nothing more to move, makes no second copy, and names the skill
  // left for its name again, nothing else.
  const second=wire(root,home,{port:41999});
  assert.deepEqual(backupCopies(root),copies,'a second update moved something again and made another copy in .godspeed/backups');
  assert.match(second.stderr,/keep-a-note/);
  assert.ok(!second.stderr.includes('check-my-email'),'a skill already moved is named again:\n'+second.stderr);
  assert.ok(fs.existsSync(path.join(theirs,'keep-a-note','SKILL.md')));
  assert.ok(fs.existsSync(path.join(root,'skills','check-my-email','SKILL.md')));
});

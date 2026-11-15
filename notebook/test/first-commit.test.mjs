// A new mission control's Git repository had no commit (beta fault list, 18 October 2026): the
// installers ran `git init` and committed nothing, so mc-search, which searches the files Git
// keeps, found nothing on a new installation, and the branch was master where the notebook syncs
// only on main. `godspeed.mjs init` now makes the first commit, once.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {firstCommit,keepOutOfGit,keptOutOfGit} from '../core/first-commit.mjs';

const kit=fileURLToPath(new URL('../../',import.meta.url)),cli=path.join(kit,'notebook','bin','godspeed.mjs'),search=path.join(kit,'tools','search.js');
const folder=name=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-first-commit-'+name+'-'));
// A computer that never used Git: no name, no global settings, Ubuntu's default branch.
function freshComputer(){
  const home=folder('home'),config=path.join(home,'.gitconfig');fs.writeFileSync(config,'');
  const env={...process.env,HOME:home,USERPROFILE:home,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_NOSYSTEM:'1'};
  for(const name of ['GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL','EMAIL'])delete env[name];
  return env;
}
const git=(root,args,env=process.env)=>spawnSync('git',['-C',root,...args],{encoding:'utf8',env,windowsHide:true});
function installed(env){
  const root=folder('mc');
  assert.equal(git(root,['-c','init.defaultBranch=master','init','-q'],env).status,0);
  const run=spawnSync(process.execPath,[cli,'init'],{encoding:'utf8',env:{...env,GODSPEED_WORKSPACE:root},windowsHide:true});
  assert.equal(run.status,0,run.stderr);
  return {root,result:JSON.parse(run.stdout)};
}

test('init gives a new mission control its first commit, on main, with the notebook state left out',()=>{
  const env=freshComputer(),{root,result}=installed(env);
  assert.equal(result.firstCommit.branch,'main');
  assert.equal(git(root,['symbolic-ref','--short','HEAD'],env).stdout.trim(),'main');
  assert.equal(git(root,['log','--format=%s|%an','-1'],env).stdout.trim(),'Start my mission control|Godspeed Mission Control','a computer with no Git name commits under the notebook\'s');
  const tracked=git(root,['ls-files'],env).stdout.split('\n').filter(Boolean);
  for(const file of ['AGENTS.md','procedures.md','.gitignore','NOTEBOOK.md'])assert.ok(tracked.includes(file),file+' is in the first commit');
  assert.ok(!tracked.includes('FULL-ALPHA.md'),'the note has its name since 2.0.0-beta.11 only');
  assert.ok(tracked.some(file=>file.startsWith('notebook/')),'the notebook\'s pages are in it');
  assert.ok(tracked.some(file=>file.startsWith('skills/')),'the recipes are in it');
  assert.ok(!tracked.some(file=>file.startsWith('.godspeed/')),'keys, databases and media never are');
  assert.ok(fs.existsSync(path.join(root,'.godspeed')),'precondition: the notebook has its state folder');
  assert.equal(git(root,['status','--porcelain'],env).stdout.trim(),'','nothing is left over after it');
  // On main now, `sync folder` gets as far as asking for the folder's copy on GitHub, and says so plainly.
  const sync=spawnSync(process.execPath,[cli,'sync','folder'],{encoding:'utf8',env:{...env,GODSPEED_WORKSPACE:root},windowsHide:true});
  assert.equal(sync.status,1);
  assert.match(sync.stderr,/^Error: This folder's repository has no copy on GitHub yet \(origin\); connect one with Connect record sync in Settings/m);
  // mc-search finds the starter's files on a new installation.
  fs.writeFileSync(path.join(root,'procedures.md'),fs.readFileSync(path.join(root,'procedures.md'),'utf8')+'\nThe dentist reminder goes out every six months.\n');
  const found=spawnSync(process.execPath,[search,'--godspeed',root,'--local','dentist','reminder'],{encoding:'utf8',env,windowsHide:true});
  assert.equal(found.status,0,found.stderr);
  assert.match(found.stdout,/procedures\.md/);
});

test('init makes the first commit only once, and never in a folder that has commits, another repository or none',()=>{
  const env=freshComputer(),{root}=installed(env),head=git(root,['rev-parse','HEAD'],env).stdout.trim();
  const again=spawnSync(process.execPath,[cli,'init'],{encoding:'utf8',env:{...env,GODSPEED_WORKSPACE:root},windowsHide:true});
  assert.equal(again.status,0,again.stderr);
  assert.equal(JSON.parse(again.stdout).firstCommit,undefined);
  assert.equal(git(root,['rev-parse','HEAD'],env).stdout.trim(),head,'a second run adds no commit');
  assert.equal(firstCommit(root).reason,'already has commits');
  // A folder with its owner's history: left exactly as it is, branch and all.
  const owned=folder('owned');git(owned,['-c','init.defaultBranch=master','init','-q'],env);fs.writeFileSync(path.join(owned,'notes.md'),'mine\n');
  git(owned,['add','-A'],env);git(owned,['-c','user.name=Owner','-c','user.email=owner@example.com','commit','-qm','mine'],env);
  const ownedHead=git(owned,['rev-parse','HEAD'],env).stdout.trim();
  assert.equal(firstCommit(owned).made,false);
  assert.equal(git(owned,['rev-parse','HEAD'],env).stdout.trim(),ownedHead);
  assert.equal(git(owned,['symbolic-ref','--short','HEAD'],env).stdout.trim(),'master');
  // A folder inside another repository, and a folder with none.
  const inside=path.join(owned,'inner');fs.mkdirSync(inside);
  assert.equal(firstCommit(inside).made,false);
  const none=folder('none');assert.equal(firstCommit(none).made,false);assert.equal(fs.existsSync(path.join(none,'.git')),false);
});

test('a Git name the owner set is the first commit\'s author, and the ignore lines are added once',()=>{
  const env=freshComputer();fs.writeFileSync(env.GIT_CONFIG_GLOBAL,'[user]\n\tname = Sam Reader\n\temail = sam@example.com\n');
  const {root}=installed(env);
  assert.equal(git(root,['log','--format=%an <%ae>','-1'],env).stdout.trim(),'Sam Reader <sam@example.com>');
  const ignore=path.join(root,'.gitignore');fs.writeFileSync(ignore,'# mine\nprivate/\n');
  assert.deepEqual(keepOutOfGit(root),keptOutOfGit);
  assert.deepEqual(keepOutOfGit(root),[],'nothing is added twice');
  const text=fs.readFileSync(ignore,'utf8');assert.ok(text.startsWith('# mine\nprivate/\n'),'the owner\'s lines stay first and unchanged');
});

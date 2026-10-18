import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {execFileSync} from 'node:child_process';
import {about,installedRelease} from '../core/about.mjs';
import {VERSION} from '../core/version.mjs';
import {BLS} from '../core/food-table.mjs';
import {withTable} from './food-fixture.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// Settings, About (18 October 2026). The README ("Settings, About names it and its licence") and
// the food tracker sent readers to an About section the routed Settings page did not have: the
// About tab lived on an older Settings page no address opens. Now Settings shows the version and
// release, where this installation keeps its files, the food table's source and licence, and the
// user guide; the version is read from one place, the notebook's package.json.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');
const temporary=name=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-about-'+name+'-'));
const A='69967129e488417d8d5acb42340363239427092a',B='54f72d3dafbc5b74fd03858e31fa2456c935a41f';

test('the release is what the installer recorded, on Windows, a Mac or Linux and a server, and nothing is guessed',()=>{
 // Windows: <app>\payload\kit is the product, candidate-manifest.json lies beside it.
 const app=temporary('windows'),kit=path.join(app,'payload','kit');fs.mkdirSync(kit,{recursive:true});
 fs.writeFileSync(path.join(app,'payload','candidate-manifest.json'),'﻿'+JSON.stringify({channel:'full-alpha',version:'2.0.0-alpha.1',kitCommit:A.toUpperCase(),kitCommittedAt:'2026-10-18T00:49:22+02:00'}));
 assert.deepEqual(installedRelease({root:kit,env:{}}),{code:A,date:'2026-10-18T00:49:22+02:00',installed_by:'windows'});
 // A Mac or Linux computer: .godspeed/integrated-runtime/versions/<commit>.
 const versions=path.join(temporary('computer'),'.godspeed','integrated-runtime','versions',A);fs.mkdirSync(versions,{recursive:true});
 assert.deepEqual(installedRelease({root:versions,env:{}}),{code:A,date:null,installed_by:'computer',git:versions});
 // The one-line server: the commit its image was built from.
 assert.deepEqual(installedRelease({root:temporary('server'),env:{GODSPEED_REVISION:B}}),{code:B,date:null,installed_by:'server'});
 // A copy no installer made, or a record that is not a release code, has no release.
 assert.equal(installedRelease({root:temporary('checkout'),env:{GODSPEED_REVISION:'unknown'}}),null);
 const odd=path.join(temporary('odd'),'versions','main');fs.mkdirSync(odd,{recursive:true});
 assert.equal(installedRelease({root:odd,env:{}}),null);
});

test('a Mac or Linux release takes its date from its own Git copy, and shows none without one',async()=>{
 const work=temporary('git'),copy=path.join(work,'copy'),git=(...args)=>execFileSync('git',['-C',copy,...args],{encoding:'utf8'}).trim();
 fs.mkdirSync(copy);git('init','-q');fs.writeFileSync(path.join(copy,'a.txt'),'a');git('add','a.txt');
 execFileSync('git',['-C',copy,'-c','user.name=Fictional','-c','user.email=fictional@example.invalid','commit','-q','-m','one'],{env:{...process.env,GIT_COMMITTER_DATE:'2026-10-18T00:49:22+02:00',GIT_AUTHOR_DATE:'2026-10-18T00:49:22+02:00'}});
 const code=git('rev-parse','HEAD'),versions=path.join(work,'.godspeed','integrated-runtime','versions');fs.mkdirSync(versions,{recursive:true});
 const root=path.join(versions,code);fs.renameSync(copy,root);
 const store={root:work,recordsRoot:path.join(work,'notebook'),state:path.join(work,'.godspeed')};
 assert.deepEqual((await about({store,mediaRoot:path.join(work,'.godspeed','media'),device:'local',root,env:{}})).release,{code,date:'2026-10-18T00:49:22+02:00',installed_by:'computer'});
 const bare=path.join(versions,'b'.repeat(40));fs.mkdirSync(bare);
 assert.deepEqual((await about({store,mediaRoot:path.join(work,'.godspeed','media'),device:'local',root:bare,env:{}})).release,{code:'b'.repeat(40),date:null,installed_by:'computer'});
});

test('/api/about names the version, this installation\'s folders and the food table; /health reads the same version',async t=>{
 const root=temporary('service'),media=temporary('media');
 await withTable(root);
 const service=await createService({root,mediaRoot:media,port:0});t.after(()=>service.close());
 const base='http://127.0.0.1:'+service.address.port;
 const about=await (await fetch(base+'/api/about')).json();
 assert.equal(about.version,JSON.parse(read('../package.json')).version);
 assert.equal(about.version,VERSION);
 assert.equal((await (await fetch(base+'/health')).json()).version,about.version,'the health address and Settings, About name the same version');
 assert.equal(about.on,'computer');
 assert.deepEqual(about.folders,{workspace:path.resolve(root),notes:path.join(path.resolve(root),'notebook'),media:path.resolve(media),backups:path.join(path.resolve(root),'.godspeed','backups')});
 assert.equal(about.food.installed,true);
 assert.equal(about.food.notice,path.join(path.resolve(root),'.godspeed','food','bls-4.0','NOTICE.md'));
 assert.ok(fs.existsSync(about.food.notice),'the notice it names is there');
 assert.equal(about.food.licence,'CC BY 4.0');assert.equal(about.food.citation,BLS.citation);assert.equal(about.food.publisher,'Max Rubner-Institut');
 assert.match(about.food.packaged,/Open Food Facts/);
 assert.ok(about.release===null||/^[0-9a-f]{40}$/.test(about.release.code),'a release code or none, never a guess');
});

test('a notebook without the food table says so, and a server calls itself one',async t=>{
 const root=temporary('no-table');
 const service=await createService({root,port:0,device:'vps'});t.after(()=>service.close());
 const about=await (await fetch('http://127.0.0.1:'+service.address.port+'/api/about')).json();
 assert.equal(about.on,'server');assert.equal(about.food.installed,false);assert.equal(about.food.notice,null);
});

test('Settings shows the About section, with the guide and its known issues, in plain words',()=>{
 const control=read('../ui/src/local/Control.tsx'),aboutTab=read('../ui/src/components/settings/AboutTab.tsx');
 assert.match(control,/import \{AboutTab\} from '@\/components\/settings\/AboutTab';/);
 assert.match(control,/<AboutTab\/>/,'the routed Settings page shows it');
 assert.match(aboutTab,/fetch\('\/api\/about'\)/);
 assert.match(aboutTab,/<h2 className="text-xl">About<\/h2>/);
 assert.match(aboutTab,/GUIDE_URL/);assert.match(aboutTab,/known-issues/);
 for(const words of ['Version','Release code','Your mission control folder','Your notes','Photos and files','Backups','Food values','Help'])assert.ok(aboutTab.includes(words),words);
 assert.match(aboutTab,/update#check-which-release-you-have/,'the guide says how to compare the release code');
 assert.doesNotMatch(aboutTab,/[–—]/,'no long dashes in what a reader sees');
});

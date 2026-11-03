// THE MORNING BRIEF ROUTINE RUNS THE NOTEBOOK'S OWN BRIEFING (3 November 2026, #160).
//
// On every install the assistant runs the routines, and its Morning brief was the starter recipe, so
// the notebook's briefing (core/briefing.mjs: the Charm Challenge line word for word, a sentence that
// breaks a writing rule cut) never reached anyone. These tests hold the new path to that: the entry
// the routine's script runs (scripts/morning-brief.mjs) saves the notebook's briefing and gives its
// words to deliver, never sends the same words twice, and refuses without an AI; and the
// routine's own script (godspeed_routines.py, brief) prints those words, or fails in one sentence.
// Everything in here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {addonCommand} from '../core/native-personal.mjs';
import {routineFiles} from '../core/starting-routines.mjs';
import {BRIEF_SCRIPT} from '../core/notebook-routines.mjs';
import {runMorningBrief} from '../scripts/morning-brief.mjs';

const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const havePython=spawnSync(python,['--version']).status===0;
const OK='No fresh health observations are recorded. Review the fictional list today.';
const verifies=input=>input.kind==='brief-verification'?{passed:true,reason:'Fictional sources checked.'}:null;

function workspace(t,{charm=false,rules=[]}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-routine-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 const store=new Store(root);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 fs.mkdirSync(path.join(root,'profile'),{recursive:true});
 fs.writeFileSync(path.join(root,'profile','voice.md'),'# Voice\n\n```voice-rules\n'+rules.join('\n')+'\n```\n');
 if(charm)addonCommand(store,{addon:'charm',args:['start']});
 return {root,store};
}

test('the routine\'s entry saves the notebook\'s own briefing, with the Charm line, and gives its words',async t=>{
 process.env.GODSPEED_CHARM_NOW='2026-10-21T08:00:00Z';process.env.GODSPEED_NOW='2026-10-21T08:00:00Z';
 t.after(()=>{delete process.env.GODSPEED_CHARM_NOW;delete process.env.GODSPEED_NOW;});
 const {root}=workspace(t,{charm:true});let line=null;
 const provider=async input=>{const v=verifies(input);if(v)return v;line=input.context.charm_line;return OK+'\n\n'+input.context.charm_line;};
 const {text,result}=await runMorningBrief({root,provider});
 assert.ok(line&&/^Charm Challenge: day 1 of 21/.test(line),'the briefing was given the Charm line: '+line);
 assert.ok(text.split(/\r?\n/).includes(line),'the words to deliver carry it as a line of its own');
 const notes=new QueryService(new Store(root)).rows('notes').filter(n=>n.source_app==='morning-brief');
 assert.equal(notes.length,1);assert.equal(notes[0].id,result.record_id);assert.equal(notes[0].content.trim(),text);
 // The same words again are refused by the briefing's own check, so nothing goes out twice.
 await assert.rejects(runMorningBrief({root,provider}),/already saved/);
});

test('the routine\'s entry cuts a sentence that breaks a writing rule and delivers the rest',async t=>{
 const {root}=workspace(t,{rules:['BANNED-WORD: realm']});let writes=0;
 const provider=async input=>{const v=verifies(input);if(v)return v;writes++;return 'Your realm is open today. Review the fictional list today. A useful closing remains.';};
 const {text}=await runMorningBrief({root,provider});
 assert.equal(writes,2,'the one rewrite');
 assert.doesNotMatch(text,/realm/i);assert.match(text,/Review the fictional list today\./);
});

test('without an AI the routine\'s entry says so in one sentence',async t=>{
 const {root}=workspace(t);
 await assert.rejects(runMorningBrief({root,env:{GODSPEED_ASSISTANT_CONFIG:path.join(root,'none.json')}}),/no AI to write with: connect one in Settings/);
});

// The routine's own script, as Hermes runs it: its Python, and the entry above replaced by a stand-in.
function scripts(t,entry){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-script-')),home=path.join(root,'.hermes'),state=path.join(root,'.godspeed');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 const files=routineFiles({root,home,state,timezone:'Europe/Berlin'}),stub=path.join(root,'stand-in-brief.mjs');
 fs.writeFileSync(stub,entry);
 files['godspeed-routines.json']=JSON.stringify({...JSON.parse(files['godspeed-routines.json']),brief:stub});
 fs.mkdirSync(path.join(home,'scripts'),{recursive:true});for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(home,'scripts',name),text);
 return spawnSync(python,[path.join(home,'scripts',BRIEF_SCRIPT)],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},timeout:120000});
}

test('the Morning brief routine\'s script prints the briefing for Hermes to deliver',{skip:!havePython&&'no Python here'},t=>{
 const run=scripts(t,"if(!process.env.GODSPEED_WORKSPACE)process.exit(3);process.stdout.write('Your morning briefing, made up.\\n\\nCharm Challenge: day 1 of 21.\\n');");
 assert.equal(run.status,0,run.stderr);
 assert.equal(run.stdout.trim(),'Your morning briefing, made up.\n\nCharm Challenge: day 1 of 21.'.replace(/\n/g,process.platform==='win32'?'\r\n':'\n').replace(/\r\n/g,'\n'));
 const silent=scripts(t,'process.exit(0);');
 assert.equal(silent.status,0,silent.stderr);assert.equal(silent.stdout,'','nothing printed is Hermes\' silence');
});

test('a briefing that could not be written fails the routine in one sentence',{skip:!havePython&&'no Python here'},t=>{
 const run=scripts(t,"console.error('The morning brief has no AI to write with: connect one in Settings, Your AI.');process.exit(1);");
 assert.notEqual(run.status,0);
 assert.match(run.stderr,/^The morning brief could not be written\.\r?\nThe morning brief has no AI to write with/);
});

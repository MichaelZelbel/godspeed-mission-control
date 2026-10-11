import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {installStarter,addArchiveLine,ARCHIVE_LINE} from '../core/starter-workspace.mjs';

test('integrated installation retains every original Godspeed starter file and preserves user edits',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-starter-')),root=path.join(base,'workspace');
  const starter=fileURLToPath(new URL('../../starter-godspeed/',import.meta.url));
  installStarter(root,starter);
  const compare=(source,dest)=>{for(const name of fs.readdirSync(source)){const a=path.join(source,name),b=path.join(dest,name);assert.ok(fs.existsSync(b),b);if(fs.statSync(a).isDirectory())compare(a,b);else assert.deepEqual(fs.readFileSync(b),fs.readFileSync(a));}};
  compare(starter,root);
  fs.writeFileSync(path.join(root,'AGENTS.md'),'My customised operating manual');
  fs.writeFileSync(path.join(root,'goals','my-goal.md'),'My retained goal');
  fs.unlinkSync(path.join(root,'profile','about-me.md'));
  installStarter(root,starter);
  assert.equal(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),'My customised operating manual');
  assert.equal(fs.readFileSync(path.join(root,'goals','my-goal.md'),'utf8'),'My retained goal');
  assert.ok(fs.existsSync(path.join(root,'profile','about-me.md')));
});

test('an existing reader\'s manual gets the archive line once, under its word about prompts/, and an adopted one never',()=>{
  const starter=fileURLToPath(new URL('../../starter-godspeed/',import.meta.url));
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-archive-line-')),root=path.join(base,'reader');
  installStarter(root,starter);
  const manual=path.join(root,'AGENTS.md'),fresh=fs.readFileSync(manual,'utf8');
  assert.ok(fresh.includes(ARCHIVE_LINE),'a new folder gets the line with the starter');
  // The manual as the 10 October release wrote it: the line is not there yet.
  const before=fresh.replace(ARCHIVE_LINE+'\n','');
  assert.ok(!before.includes('mc-prompt-archive search'));
  fs.writeFileSync(manual,before);
  assert.equal(addArchiveLine(root,path.join(root,'.godspeed'),starter),true);
  assert.equal(fs.readFileSync(manual,'utf8'),fresh,'it lands where the starter has it, right under the word about prompts/');
  assert.equal(addArchiveLine(root,path.join(root,'.godspeed'),starter),false);
  assert.equal(fs.readFileSync(manual,'utf8'),fresh,'a second update adds nothing');
  fs.writeFileSync(manual,before);
  assert.equal(addArchiveLine(root,path.join(root,'.godspeed'),starter),false);
  assert.equal(fs.readFileSync(manual,'utf8'),before,'a line its owner deleted is not put back');
  // A manual without that word gets it at the end, in its own line endings.
  const other=path.join(base,'other');installStarter(other,starter);
  fs.writeFileSync(path.join(other,'AGENTS.md'),'# Nova\r\n\r\nMy own manual.\r\n');
  assert.equal(addArchiveLine(other,path.join(other,'.godspeed'),starter),true);
  assert.equal(fs.readFileSync(path.join(other,'AGENTS.md'),'utf8'),'# Nova\r\n\r\nMy own manual.\r\n\r\n'+ARCHIVE_LINE+'\r\n');
  // An adopted mission control (its own rules, none of the starter's) is its owner's own manual.
  const adopted=path.join(base,'adopted');fs.mkdirSync(path.join(adopted,'rules'),{recursive:true});
  fs.writeFileSync(path.join(adopted,'rules','mine.md'),'x');fs.writeFileSync(path.join(adopted,'AGENTS.md'),'# Mine\n');
  assert.equal(addArchiveLine(adopted,path.join(adopted,'.godspeed'),starter),false);
  assert.equal(fs.readFileSync(path.join(adopted,'AGENTS.md'),'utf8'),'# Mine\n');
});

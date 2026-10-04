import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {installStarter} from '../core/starter-workspace.mjs';

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

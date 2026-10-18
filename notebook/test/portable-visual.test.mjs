import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

// Catches a missing packaged executable and credential-dependent help.
test('the installed visual helper explains its contract without credentials or private engine',()=>{
 const script=fileURLToPath(new URL('../recipes/excalidraw-visuals/scripts/generate-visual.cjs',import.meta.url));
 const result=spawnSync(process.execPath,[script,'--help'],{cwd:os.tmpdir(),env:{PATH:process.env.PATH},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/--input/);
 assert.match(result.stdout,/KIE_API_KEY/);
});

test('visual input validation fails before contacting a provider or creating output',()=>{
 const script=fileURLToPath(new URL('../recipes/excalidraw-visuals/scripts/generate-visual.cjs',import.meta.url));
 const result=spawnSync(process.execPath,[script,'Fictional robot','not-created.png','bad-ratio'],{cwd:os.tmpdir(),env:{PATH:process.env.PATH},encoding:'utf8'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/Invalid aspect ratio/);
 assert.equal(fs.existsSync(os.tmpdir()+'/not-created.png'),false);
});

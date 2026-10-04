import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require = createRequire(import.meta.url);
const runtime = require('../recipes/embedded-captions/scripts/hyperframes-runtime.cjs');
test('resolves both checkout and npm CLI entry points, preferring explicit root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-caption-runtime-'));
  for (const relative of ['node_modules/hyperframes/dist/cli.js','packages/cli/dist/cli.js']) {
    fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});
    fs.writeFileSync(path.join(root,relative),'');
    assert.equal(runtime.resolve(root).root,root);
    assert.equal(runtime.resolve(root).cli,path.join(root, relative));
  }
});
test('all bundled caption scripts remain equivalent', () => {
  for(const recipe of ['video-captions','embedded-captions']) {
    const scripts = new URL(`../recipes/${recipe}/scripts/`,import.meta.url);
    for(const file of fs.readdirSync(scripts)) {
      if(fs.statSync(new URL(file,scripts)).isFile()) assert.deepEqual(fs.readFileSync(new URL(file,scripts)),fs.readFileSync(new URL(`../reusable-recipes/${recipe}/scripts/${file}`,import.meta.url)),file);
    }
  }
});
test('near-silent audio is refused before even reusing a cached transcript', () => {
  const ff=spawnSync('ffmpeg',['-version']);
  if(ff.error) return;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-caption-silence-'));
  const made=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','1','-c:a','aac',path.join(root,'source.mp4')]);
  assert.equal(made.status,0);
  fs.writeFileSync(path.join(root,'transcript.json'),JSON.stringify({language_code:'en',words:[{text:'Fabricated',start:0,end:0.5}]}));
  const result=spawnSync(process.execPath,[new URL('../recipes/embedded-captions/scripts/transcribe.cjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),root],{encoding:'utf8'});
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/Refusing near-silent audio/);
  assert.doesNotMatch(result.stdout,/skipping/);
});

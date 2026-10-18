import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {setupCodeBits,MINIMUM_BITS} from '../../docker/full-candidate/setup-code.mjs';

// The server's entrypoint refuses a setup code a stranger could guess before the owner
// account exists (docker/full-candidate/setup-code.mjs). Until 6 October 2026 any
// non-empty text was taken.
const strong=code=>setupCodeBits(code)>=MINIMUM_BITS;

test('generated codes and long random ones pass; short, plain or repetitive ones do not',()=>{
  for(const code of ['0123456789abcdef'.repeat(4),'9f86d081884c7d659a2feaa0c55ad015','Q7xK2mP9vR4tL8nB3wZ6yH','synthetic-package-acceptance-token'])assert.ok(strong(code),code);
  for(const code of ['','hello','password123','9f86d081884c7d659a2feaa0c55ad01','a'.repeat(64),'abcabcabcabcabcabcabcabcabcabcabc','12345678901234567890123456789012'])assert.ok(!strong(code),code);
});

const script=fileURLToPath(new URL('../../docker/full-candidate/setup-code.mjs',import.meta.url));
function start(code,{owner=false}={}){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-setup-code-'));
  if(owner){fs.mkdirSync(path.join(workspace,'.godspeed'));fs.writeFileSync(path.join(workspace,'.godspeed','web-auth.json'),JSON.stringify({version:1,owner:{username:'anna'}}));}
  return spawnSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:workspace,GODSPEED_ACCESS_TOKEN:code}});
}

test('a server with no owner yet does not start with a guessable code, and says what to do',()=>{
  const result=start('hello');
  assert.equal(result.status,1);
  assert.match(result.stderr,/at least 32 random letters and digits/);
  assert.equal(start('0123456789abcdef'.repeat(4)).status,0);
});

test('a server whose owner exists keeps starting, since the code can no longer do anything',()=>{
  assert.equal(start('hello',{owner:true}).status,0);
});

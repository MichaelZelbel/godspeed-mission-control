import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
// The chat guard (assistant-files/godspeed-chat-guard): the code watch and the plain reply, against fakes.
test('godspeed-chat-guard: restarts on new code, answers a failed message or turn with one plain sentence',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const result=spawnSync(python,[path.join(here,'chat-guard-plugin.test.py'),'-v'],{encoding:'utf8',timeout:240000,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  assert.equal(result.status,0,(result.stdout||'')+(result.stderr||'')+(result.error?.message||''));
});

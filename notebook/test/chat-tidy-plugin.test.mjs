import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
// The night chat tidy-up's gateway command (assistant-files/godspeed-chat-tidy), against a fake runner.
test('godspeed-chat-tidy: refuses what is not the owner\'s idle chat, compresses the match once',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const result=spawnSync(python,[path.join(here,'chat-tidy-plugin.test.py'),'-v'],{encoding:'utf8',timeout:240000,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  assert.equal(result.status,0,(result.stdout||'')+(result.stderr||'')+(result.error?.message||''));
});

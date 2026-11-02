import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
// The reply plugin's own cases (Python, standard library only), run where the suite runs.
test('godspeed-reply: a reply goes out in the language of the message it answers',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const result=spawnSync(python,[path.join(here,'reply-language.test.py'),'-v'],{encoding:'utf8',timeout:240000,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  assert.equal(result.status,0,(result.stdout||'')+(result.stderr||'')+(result.error?.message||''));
});

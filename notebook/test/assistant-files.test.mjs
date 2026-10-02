import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const python=process.env.GODSPEED_TEST_PYTHON|| (process.platform==='win32'?'python':'python3');
test('native assistant file authority: rebuild, writes, failure, conflict and crash',()=>{
  const result=spawnSync(python,[path.join(path.dirname(fileURLToPath(import.meta.url)),'assistant-files.py')],{encoding:'utf8',timeout:240000,env:{...process.env,GODSPEED_TEST_NODE:process.execPath}});
  assert.equal(result.status,0,result.stderr||result.error?.message);
});

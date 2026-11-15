import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const python=['python3','python'].find(p=>spawnSync(p,['-c','print(1)'],{encoding:'utf8'}).stdout?.trim()==='1');
test('the shared Yes/No buttons answer once, refuse a second press, and keep each callback to its id',{skip:python?false:'no python on this computer'},()=>{
 const file=path.join(path.dirname(fileURLToPath(import.meta.url)),'godspeed-buttons.test.py');
 const r=spawnSync(python,['-I',file],{encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);
});

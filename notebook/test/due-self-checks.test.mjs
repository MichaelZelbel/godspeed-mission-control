import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CONNECTION_NAMES} from '../core/connection-names.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const listed=text=>text.match(/--self-check ((?:none|secret-changed|connection-ok|file-newer)(?:\|[a-z-]+)*)/)[1].split('|');
test('the due recipe lists exactly the self checks the tool takes, and the connections are the check\'s',()=>{
  const help=spawnSync(process.execPath,[fileURLToPath(new URL('../../tools/due.js',import.meta.url)),'--help'],{encoding:'utf8'}).stdout;
  const tool=listed(help).sort();
  for(const p of ['../recipes/due/SKILL.md','../reusable-recipes/due/SKILL.md']){
    const recipe=read(p);
    assert.deepEqual(listed(recipe).sort(),tool,p);
    for(const kind of tool)assert.match(recipe,new RegExp('^- `'+kind+'`',"m"),p+' says when to use '+kind);
    for(const c of Object.values(CONNECTION_NAMES))assert.ok(recipe.includes(c.label.replace('your ','')),p+' names '+c.label);
  }
  const source=read('../../tools/due.js');
  const map=source.match(/const CONNECTIONS = (\{[^}]*\});/)[1];
  assert.deepEqual(Object.values(eval('('+map+')')).sort(),Object.values(CONNECTION_NAMES).map(c=>c.label).sort());
  assert.deepEqual(Object.keys(eval('('+map+')')).sort(),Object.keys(CONNECTION_NAMES).sort());
});

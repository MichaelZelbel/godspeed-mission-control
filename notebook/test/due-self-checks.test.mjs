import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';
import {CONNECTION_NAMES} from '../core/connection-names.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const listed=text=>text.match(/--self-check ((?:none|secret-changed|connection-ok|file-newer)(?:\|[a-z-]+)*)/)[1].split('|');
test('the due recipe lists exactly the self checks the tool takes, and the connections are the check\'s',()=>{
  const help=spawnSync(process.execPath,[new URL('../../tools/due.js',import.meta.url).pathname,'--help'],{encoding:'utf8'}).stdout;
  const tool=listed(help).sort();
  // The connection-ok alternatives, in the help and in each recipe, are exactly the connections the daily check lists, by the name
  // Settings shows: none missing and none extra.
  const labels=Object.values(CONNECTION_NAMES).map(c=>c.label).sort();
  const helpText=help.match(/connection-ok\s+([\s\S]*?)\n\s+file-newer/)[1].replace(/\s+/g,' ');
  assert.deepEqual(helpText.match(/connection \((.*)\) working/)[1].split(', ').sort(),labels,'the --help text of connection-ok names exactly the check\'s connections');
  for(const p of ['../recipes/due/SKILL.md','../reusable-recipes/due/SKILL.md']){
    const recipe=read(p);
    assert.deepEqual(listed(recipe).sort(),tool,p);
    for(const kind of tool)assert.match(recipe,new RegExp('^- `'+kind+'`',"m"),p+' says when to use '+kind);
    for(const c of Object.values(CONNECTION_NAMES))assert.ok(recipe.includes(c.label.replace('your ','')),p+' names '+c.label);
    assert.deepEqual(recipe.match(/`connection-ok` with `--self-check-arg <([^>]*)>`/)[1].split('|').sort(),labels,p+' offers exactly the check\'s connections to connection-ok');
  }
  const source=read('../../tools/due.js');
  const map=source.match(/const CONNECTIONS = (\{[^}]*\});/)[1];
  assert.deepEqual(Object.values(eval('('+map+')')).sort(),Object.values(CONNECTION_NAMES).map(c=>c.label).sort());
  assert.deepEqual(Object.keys(eval('('+map+')')).sort(),Object.keys(CONNECTION_NAMES).sort());
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=new URL('../../',import.meta.url).pathname,readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const exists=p=>fs.existsSync(path.join(root,p));

// `skills/<name>/SKILL.md` is where a skill is installed, not a file of this tree;
// `execution` also holds prose ("Installed chat, notebook and scheduler") and bare
// names that live in notebook/core.
function missingExecutionFiles(execution){
 return execution.split(/ (?:\/|through) /).filter(p=>/^[\w./-]+\.(?:mjs|tsx?|py)$/.test(p)&&!p.startsWith('skills/')).filter(p=>!exists(p)&&!exists('notebook/core/'+p));
}

test('every file the acceptance records name exists',()=>{
 const missing=[];
 for(const name of ['acceptance-matrix','capability-matrix'])for(const i of readJson(`docs/full-version/${name}.json`).items)for(const p of missingExecutionFiles(i.execution))missing.push(`${name} ${i.key}: ${p}`);
 for(const d of readJson('docs/full-version/source-inventory.json').dependencies)if(!exists('notebook/ui/'+d.source))missing.push(`source-inventory: notebook/ui/${d.source}`);
 assert.deepEqual(missing,[]);
});

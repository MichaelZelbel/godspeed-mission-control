import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=new URL('../../',import.meta.url).pathname,readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const exists=p=>fs.existsSync(path.join(root,p));

// Files an `execution` string names: any `notebook/…` or `tools/…` path, and bare
// `name.ext` tokens, which live in notebook/core. Exempt by rule, because they are
// not files of this tree: `skills/<name>/SKILL.md` (where a skill is installed) and
// prose such as "Installed chat, notebook and scheduler".
export function namedFiles(execution){
 const tokens=execution.match(/[\w./-]+/g)??[];
 return tokens.map(t=>t.replace(/[.,;]+$/,'')).filter(t=>/^(?:notebook|tools)\//.test(t)||/^[\w-]+\.(?:mjs|js|tsx?|py)$/.test(t)).map(t=>t.includes('/')?t:'notebook/core/'+t);
}

// Inventory sources are files under notebook/ui, except `procedure_register.source`
// (an upstream document) and `skills[].source` (an install path), which are exempt by rule.
export function missingFiles({matrices,inventory}){
 const missing=[];
 for(const [name,matrix] of Object.entries(matrices))for(const i of matrix.items)for(const p of namedFiles(i.execution))if(!exists(p))missing.push(`${name} ${i.key}: ${p}`);
 for(const d of inventory.dependencies)if(!exists('notebook/ui/'+d.source))missing.push(`source-inventory: notebook/ui/${d.source}`);
 return missing;
}

const records=()=>({matrices:Object.fromEntries(['acceptance-matrix','capability-matrix'].map(n=>[n,readJson(`docs/full-version/${n}.json`)])),inventory:readJson('docs/full-version/source-inventory.json')});

test('every file the acceptance records name exists',()=>{
 assert.deepEqual(missingFiles(records()),[]);
});

test('a record that names a missing file fails, naming the entry and the path',()=>{
 const r=records();
 r.matrices['acceptance-matrix'].items.push({key:'procedure:bogus',execution:'tools/mc-decide, started by notebook/core/routine-scripts/nope.py decide; nope.mjs'});
 r.inventory.dependencies.push({source:'src/nope/Bogus.tsx'});
 assert.deepEqual(missingFiles(r),['acceptance-matrix procedure:bogus: notebook/core/routine-scripts/nope.py','acceptance-matrix procedure:bogus: notebook/core/nope.mjs','source-inventory: notebook/ui/src/nope/Bogus.tsx']);
});

test('the tables and functions of deleted pages are still read, recorded and not listed twice',async()=>{
 const deleted=readJson('notebook/data/deleted-source-inventory.json'),{inventory,matrices}=records();
 const {tables}=await import('../core/query.mjs');
 const keys=new Set(matrices['acceptance-matrix'].items.map(i=>i.key));
 for(const t of deleted.tables){assert.ok(tables.has(t),`query.mjs does not know table ${t}`);assert.ok(keys.has('domain:'+t),`acceptance-matrix has no domain:${t}`);assert.ok(!inventory.dependencies.some(d=>d.tables.includes(t)),`source-inventory lists ${t} again`);}
 for(const f of deleted.functions){assert.ok(keys.has('function:'+f),`acceptance-matrix has no function:${f}`);assert.ok(!inventory.dependencies.some(d=>d.functions.includes(f)),`source-inventory lists ${f} again`);}
});

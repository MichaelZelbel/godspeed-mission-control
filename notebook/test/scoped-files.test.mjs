import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {mcp} from '../server/mcp.mjs';
import {privateFile} from '../core/context.mjs';

const files={
 'routines/headache/entries/2026/10/01/0630.md':'---\nstart: 2026-10-01T06:30\n---\nMigraine right side. Zebrafinch marker.\n',
 'world/claims/salary.md':'Salary 2026: fictional. Zebrafinch marker.\n',
 'journal/2026-10-01.md':'Journal entry. Zebrafinch marker.\n',
 'coach/talks/health.md':'Coaching talk. Zebrafinch marker.\n',
 'profile/about-me.md':'---\nsummary: fictional\n---\nAbout me. Zebrafinch marker.\n',
 'observations/birds.md':'An observation. Zebrafinch marker.\n',
 'observations/secret.md':'---\ntitle: Kept back\nprivate: "true"\n---\nPrivate observation. Zebrafinch marker.\n',
 'rules/hidden-rule.md':"---\nai_visibility: 'hidden'  # owner only\n---\nHidden rule. Zebrafinch marker.\n",
};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-scoped-files-'));
 for(const [name,text] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),text);}
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query),index=new SearchIndex(store);index.rebuild();
 t.after(()=>{index.close();fs.rmSync(root,{recursive:true,force:true});});
 return {store,query,domains,index};
}
const call=async(env,name,args,scopes)=>{const r=await mcp({id:1,method:'tools/call',params:{name,arguments:args}},{...env,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
const all=['notes','contacts','world','collections','media','profile','actions','stats'];

test('a notes-only key finds and reads only the files its scope covers',async t=>{
 const env=fixture(t);
 const found=JSON.parse((await call(env,'search_notes',{query:'zebrafinch'},['notes'])).text).map(h=>h.id).sort();
 assert.deepEqual(found,['observations/birds.md']);
 const brain=(await call(env,'search_brain',{query:'zebrafinch'},['notes'])).text;
 for(const name of ['routines/headache','world/claims','journal/','coach/','profile/'])assert.ok(!brain.includes(name),name+' in '+brain);
 assert.ok(brain.includes('observations/birds.md'));
 for(const name of ['routines/headache/entries/2026/10/01/0630.md','world/claims/salary.md','journal/2026-10-01.md','coach/talks/health.md','profile/about-me.md']){
  const read=await call(env,'get_note',{note:name},['notes']);assert.equal(read.error,true,name+': '+read.text);assert.ok(!read.text.includes('Zebrafinch'));
 }
 assert.match((await call(env,'get_note',{note:'observations/birds.md'},['notes'])).text,/An observation/);
 // The keys that cover them read them.
 assert.match((await call(env,'get_note',{note:'routines/headache/entries/2026/10/01/0630.md'},['actions'])).text,/Migraine/);
 assert.match((await call(env,'get_note',{note:'world/claims/salary.md'},['world'])).text,/Salary/);
 assert.equal(JSON.parse((await call(env,'search_notes',{query:'zebrafinch'},all)).text).length,6);
});

test('a file marked private or hidden reaches no assistant, with or without a key',async t=>{
 const env=fixture(t);
 for(const scopes of [undefined,all]){
  const found=JSON.parse((await call(env,'search_notes',{query:'zebrafinch'},scopes)).text).map(h=>h.id);
  assert.ok(!found.includes('observations/secret.md')&&!found.includes('rules/hidden-rule.md'),found.join());
  for(const name of ['observations/secret.md','rules/hidden-rule.md'])assert.equal((await call(env,'get_note',{note:name},scopes)).error,true,name);
  assert.ok(!(await call(env,'search_brain',{query:'zebrafinch'},scopes)).text.includes('secret.md'));
 }
});

test('the private marker is read from YAML frontmatter as well as JSON',()=>{
 assert.equal(privateFile('observations/a.md','---\nprivate: true\n---\nx'),true);
 assert.equal(privateFile('observations/a.md','---\nprivate: "true"\n---\nx'),true);
 assert.equal(privateFile('observations/a.md',"---\nai_visibility: 'hidden' # owner\n---\nx"),true);
 assert.equal(privateFile('observations/a.md','---\nvisibility_scope: Private\n---\nx'),true);
 assert.equal(privateFile('observations/a.json','{"private":true}'),true);
 assert.equal(privateFile('observations/a.md','---\nprivate: false\ntitle: x\n---\nprivate thoughts'),false);
 assert.equal(privateFile('observations/a.md','Plain text'),false);
});

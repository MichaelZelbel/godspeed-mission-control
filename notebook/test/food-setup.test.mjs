import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {foodTableWanted,BLS} from '../core/food-table.mjs';
import {about} from '../core/about.mjs';
import {withTable} from './food-fixture.mjs';

// The food table at setup (D-321 step 5): the installer fetches it after init and never fails over it;
// a notebook that starts without it fetches it once in the background, but never under the test runner
// or with GODSPEED_FOOD_TABLE=off; Settings, About names the table, its licence and Open Food Facts.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');

test('the installer fetches the table after init, can skip it, and never stops over it',()=>{
 const script=read('../scripts/install-native-notebook.sh');
 const init=script.indexOf('"$node" "$version/notebook/bin/godspeed.mjs" init'),food=script.indexOf('"$node" "$version/notebook/bin/godspeed.mjs" food-table install');
 assert.ok(init>0&&food>init,'after init');
 assert.match(script,/if \[ "\$\{GODSPEED_FOOD_TABLE:-\}" != off \]; then\n  "\$node" "\$version\/notebook\/bin\/godspeed\.mjs" food-table install >\/dev\/null 2>&1 \|\| echo '[^']+' >&2\nfi/);
 assert.match(read('./native-install-linux.sh'),/install\(\) \{ GODSPEED_FOOD_TABLE=off /,'the CI install test does not depend on blsdb.de');
});

test('a starting notebook fetches the table only when it is missing, outside tests, and not switched off',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-food-setup-')),state=path.join(root,'.godspeed');
 assert.equal(foodTableWanted(state,{}),true);
 assert.equal(foodTableWanted(state,{GODSPEED_FOOD_TABLE:'off'}),false);
 assert.equal(foodTableWanted(state,{NODE_TEST_CONTEXT:'child'}),false);
 await withTable(root);
 assert.equal(foodTableWanted(state,{}),false,'installed');
 assert.match(read('../server/main.mjs'),/if \(foodTableWanted\(store\.state\)\) \{ const foodTableTimer = setTimeout\(/);
});

// Settings, About: since 18 October 2026 on the Settings page every address opens (local/Control.tsx);
// before, it sat on an older page none did. It shows what core/about.mjs hands it, made from the
// table's own constants here, so its words are always those of food-table.mjs.
test('Settings, About names the table, its licence, its citation and Open Food Facts',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-food-about-')),state=path.join(root,'.godspeed');
 const shown=async()=>(await about({store:{root,recordsRoot:path.join(root,'notebook'),state},mediaRoot:path.join(state,'media'),device:'local'})).food;
 const before=await shown();
 assert.equal(before.installed,false);assert.equal(before.notice,null);
 await withTable(root);
 const food=await shown();
 assert.equal(food.table,'Bundeslebensmittelschlüssel (BLS) 4.0');assert.equal(food.publisher,'Max Rubner-Institut');
 assert.equal(food.licence,'CC BY 4.0');assert.equal(food.licence_url,'https://creativecommons.org/licenses/by/4.0/');
 assert.equal(food.citation,BLS.citation,'the citation, word for word');
 for(const words of ['Open Food Facts','Open Database License (ODbL)'])assert.ok(food.packaged.includes(words),words);
 assert.equal(food.installed,true);assert.equal(food.notice,path.join(state,'food','bls-4.0','NOTICE.md'));
 assert.match(fs.readFileSync(food.notice,'utf8'),/CC BY 4\.0/,'the notice it names holds the licence');
 const tab=read('../ui/src/components/settings/AboutTab.tsx');
 for(const field of ['data.food.table','data.food.publisher','data.food.licence_url','data.food.licence}','data.food.citation','data.food.packaged','data.food.notice'])assert.ok(tab.includes(field),field);
 assert.doesNotMatch(tab,/[–—]/);
 assert.match(read('../ui/src/local/Control.tsx'),/<AboutTab\/>/,'shown in Settings');
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {foodTableWanted,BLS} from '../core/food-table.mjs';
import {withTable} from './food-fixture.mjs';

// The food table at setup (D-321 step 5): the installer fetches it after init and never fails over it;
// a notebook that starts without it fetches it once in the background, but never under the test runner
// or with GODSPEED_FOOD_TABLE=off; the About page names the table, its licence and Open Food Facts.
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

test('the About page names the table, its licence, its citation and Open Food Facts',()=>{
 const about=read('../ui/src/components/settings/AboutTab.tsx'),settings=read('../ui/src/pages/Settings.tsx');
 assert.ok(about.includes(BLS.citation),'the citation, word for word');
 for(const words of ['Bundeslebensmittelschlüssel (BLS) 4.0','Max Rubner-Institut','CC BY 4.0','Open Food Facts','Open Database License (ODbL)'])assert.ok(about.includes(words),words);
 assert.doesNotMatch(about,/[–—]/);
 assert.match(settings,/<TabsContent value="about">\n\s+<AboutTab \/>/);assert.match(settings,/"about", "danger"/);
});

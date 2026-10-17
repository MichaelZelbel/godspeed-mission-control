import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';

// The notebook's "Documentation" link went to /docs, which has no route in this app ("This page
// is unavailable"). The documentation is the user guide at godspeedmissioncontrol.com/guide, so
// the sidebar, and the footer, 404 and wizard pages kept from the upstream notebook, open it in a
// new tab instead.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');
const FILES=['components/layout/DashboardSidebar.tsx','components/layout/Footer.tsx','pages/NotFound.tsx','pages/Wizard.tsx'];

test('no link goes to the /docs page this app does not have',()=>{
 assert.doesNotMatch(read('../ui/src/App.tsx'),/path=["']\/docs/,'there is still no /docs route');
 for(const f of FILES)assert.doesNotMatch(read(`../ui/src/${f}`),/["'`]\/docs\b/,f);
});

test('Documentation opens the user guide in a new tab',()=>{
 assert.match(read('../ui/src/lib/brand.ts'),/^export const GUIDE_URL='https:\/\/godspeedmissioncontrol\.com\/guide';$/m);
 const sidebar=read('../ui/src/components/layout/DashboardSidebar.tsx');
 assert.match(sidebar,/\{ title: "Documentation", url: GUIDE_URL, icon: BookOpen \}/);
 assert.match(sidebar,/<NavLink to=\{item\.url\} \{\.\.\.newTab\(item\.url\)\}>/,'the System links pass the new-tab attributes');
 assert.match(sidebar,/const newTab = \(url: string\) => \(\/\^https\?:\/\.test\(url\) \? \{ target: "_blank", rel: "noopener" \} : \{\}\);/);
 assert.match(read('../ui/src/components/layout/Footer.tsx'),/\{ label: "Docs", to: GUIDE_URL, external: true \}/);
 assert.match(read('../ui/src/pages/Wizard.tsx'),/<a href=\{GUIDE_URL\} target="_blank" rel="noopener"/);
 assert.match(read('../ui/src/pages/NotFound.tsx'),/window\.open\(`\$\{GUIDE_URL\}\/search\?q=\$\{encodeURIComponent\(query\.trim\(\)\)\}`, "_blank", "noopener"\)/);
});

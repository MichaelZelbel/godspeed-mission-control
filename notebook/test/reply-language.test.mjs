import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
// The reply plugin's own cases (Python, standard library only), run where the suite runs.
test('godspeed-reply: a reply goes out in the language of the message it answers',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const result=spawnSync(python,[path.join(here,'reply-language.test.py'),'-v'],{encoding:'utf8',timeout:240000,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  assert.equal(result.status,0,(result.stdout||'')+(result.stderr||'')+(result.error?.message||''));
});

// "The language set for the person" (godspeed-reply/language.py) reads the add-ons' own settings
// files: the paths and the languages must stay the ones the add-ons write.
test('godspeed-reply reads the language from where each add-on keeps it, in the languages they allow',async()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const plugin=path.join(here,'..','assistant-files','godspeed-reply','language.py');
  const read=spawnSync(python,['-I','-c','import importlib.util as u,json,sys\ns=u.spec_from_file_location("language",sys.argv[1]);m=u.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps([m.SETTINGS,m.LANGUAGES]))',plugin],{encoding:'utf8',timeout:60000});
  assert.equal(read.status,0,read.stderr);
  const [places,languages]=JSON.parse(read.stdout);
  const root=path.resolve('/mission-control');
  const addons=['charm','journal','coach','headache'];
  const settings=await Promise.all(addons.map(a=>import(new URL(`../../third-party/addons/godspeed-${a}/lib/settings.mjs`,import.meta.url))));
  assert.deepEqual(places.map(p=>path.join(root,...p,'settings.json')),settings.map(s=>s.settingsFile(root)));
  for(const [i,s] of settings.entries()){
    assert.deepEqual(s.validateSettings({...s.DEFAULTS,language:'xx'}).filter(p=>p.startsWith('language')),[`language can be ${languages.join(' or ')}.`],addons[i]);
    assert.ok(languages.includes(s.DEFAULTS.language),addons[i]);
  }
});

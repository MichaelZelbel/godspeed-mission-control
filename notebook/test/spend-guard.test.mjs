import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';
import {runSpendGuard,saveSpendGuardSettings,spendGuardKeys} from '../core/spend-guard.mjs';

const setup=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-spend-')));
const connect=(store,key='sk-fixture-secret')=>atomic(path.join(store.state,'provider.json'),JSON.stringify({url:'https://openrouter.ai/api/v1/chat/completions',key,model:'fixture/model'}));
const reply=({daily=2.5,balance=20,fail=false,credits,calls=[]}={})=>async(url,init)=>{calls.push({url:String(url),authorization:init.headers.Authorization});if(fail)return new Response('{}',{status:503});return new Response(JSON.stringify(String(url).endsWith('/key')?{data:{usage_daily:daily,limit:100,limit_remaining:90}}:credits??{data:{balance}}),{status:200,headers:{'content-type':'application/json'}});};

test('the contract threshold examples are isolated',async()=>{
 const daily=setup();connect(daily);assert.deepEqual((await runSpendGuard({store:daily,fetcher:reply({daily:2.5,balance:20})})).notices,['daily-spend']);
 assert.equal(daily.list('notifications')[0].body,'OpenRouter has spent $2.50 today, above your $2.00 daily limit. Change this limit in Settings under Connect AI.');
 const below=setup();connect(below);assert.deepEqual((await runSpendGuard({store:below,fetcher:reply({daily:1,balance:20})})).notices,[]);
 const credit=setup();connect(credit);assert.deepEqual((await runSpendGuard({store:credit,fetcher:reply({daily:1,balance:4})})).notices,['low-balance']);
 assert.equal(credit.list('notifications')[0].body,'Your lowest remaining OpenRouter balance is $4.00, below your $5.00 limit. Change this limit in Settings under Connect AI.');
});

test('daily spending and low credit notify once per kind in six hours without retaining the key',async()=>{
 const store=setup(),key='sk-fixture-never-retain';connect(store,key);saveSpendGuardSettings(store,{enabled:true,daily_limit:2,low_balance:5});let at=Date.parse('2026-11-17T10:00:00Z'),calls=[];
 const first=await runSpendGuard({store,fetcher:reply({daily:2.5,balance:4,calls}),now:()=>at});assert.deepEqual(first.notices,['daily-spend','low-balance']);assert.equal(calls.length,2);
 const second=await runSpendGuard({store,fetcher:reply({daily:2.5,balance:4}),now:()=>at+60*60*1000});assert.deepEqual(second.notices,[]);
 const restarted=new Store(store.root),third=await runSpendGuard({store:restarted,fetcher:reply({daily:2.5,balance:4}),now:()=>at+6*60*60*1000});assert.equal(third.notices.length,2);
 const durable=fs.readdirSync(store.state).map(file=>{try{return fs.readFileSync(path.join(store.state,file),'utf8');}catch{return '';}}).join('\n');assert.equal(durable.includes(key),true);assert.equal(durable.replace(fs.readFileSync(path.join(store.state,'provider.json'),'utf8'),'' ).includes(key),false);
});

test('each notice kind has its own six-hour window',async()=>{
 const store=setup();connect(store);const at=Date.parse('2026-11-17T10:00:00Z');
 assert.deepEqual((await runSpendGuard({store,fetcher:reply({daily:1,balance:4}),now:()=>at})).notices,['low-balance']);
 assert.deepEqual((await runSpendGuard({store,fetcher:reply({daily:2.5,balance:20}),now:()=>at+3600000})).notices,['daily-spend']);
 assert.deepEqual((await runSpendGuard({store,fetcher:reply({daily:2.5,balance:4}),now:()=>at+2*3600000})).notices,[]);
});

test('thresholds, off, no key and failed complete samples are silent',async()=>{
 const store=setup();let calls=[];assert.equal((await runSpendGuard({store,fetcher:reply({calls})})).reason,'No OpenRouter key');assert.equal(calls.length,0);
 connect(store);saveSpendGuardSettings(store,{enabled:false,daily_limit:2,low_balance:5});assert.equal((await runSpendGuard({store,fetcher:reply({calls})})).reason,'Spending check is off');assert.equal(calls.length,0);
 saveSpendGuardSettings(store,{enabled:true,daily_limit:3,low_balance:3});assert.deepEqual((await runSpendGuard({store,fetcher:reply({daily:2.5,balance:4})})).notices,[]);
 const failed=await runSpendGuard({store,fetcher:reply({fail:true})});assert.equal(failed.silent,true);assert.equal(store.get('spend_guard_runs','latest').failure,'request-failed');
 const invalid=await runSpendGuard({store,fetcher:reply({credits:{data:{total_credits:null,total_usage:null}}})});assert.equal(invalid.silent,true);assert.equal(store.get('spend_guard_runs','latest').failure,'invalid-response');
});

test('mirrored OpenRouter keys are deduplicated',()=>{
 const store=setup(),home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-'));connect(store,'same-key');atomic(path.join(home,'config.yaml'),'model:\n  provider: openrouter\nfallback_providers:\n  - provider: openrouter\n    model: fixture/backup\n    key_env: OPENROUTER_BACKUP_KEY\n');atomic(path.join(home,'.env'),'OPENROUTER_API_KEY=same-key\nOPENROUTER_BACKUP_KEY=backup-key\n');assert.deepEqual(spendGuardKeys({state:store.state,hermesHome:home}),['same-key','backup-key']);
});

test('every supported Hermes fallback representation contributes its OpenRouter key',()=>{
 const forms=[
  'fallback_providers: [{"provider":"openrouter","model":"x/y","api_key":"inline-key"}]\n',
  'fallback_providers: "[{\\"provider\\":\\"openrouter\\",\\"model\\":\\"x/y\\",\\"key_env\\":\\"FLOW_KEY\\"}]"\n',
  'fallback_providers: [{provider: openrouter, model: x/y, api_key_env: YAML_KEY}]\n',
  'fallback_model:\n  provider: openrouter\n  model: x/y\n  api_key: legacy-key\n',
 ];
 for(const [index,config] of forms.entries()){
  const store=setup(),home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-'));atomic(path.join(home,'config.yaml'),config);atomic(path.join(home,'.env'),'FLOW_KEY=flow-key\nYAML_KEY=yaml-key\n');
  assert.equal(spendGuardKeys({state:store.state,hermesHome:home}).length,1,'form '+index);
 }
});

test('two held keys for the same OpenRouter model are both checked',async()=>{
 const store=setup(),home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-')),calls=[];
 atomic(path.join(home,'config.yaml'),'fallback_providers: [{"provider":"openrouter","model":"x/y","api_key":"first-key"},{"provider":"openrouter","model":"x/y","api_key":"second-key"}]\n');
 assert.deepEqual(spendGuardKeys({state:store.state,hermesHome:home}),['first-key','second-key']);
 await runSpendGuard({store,hermesHome:home,fetcher:reply({daily:1,balance:20,calls})});assert.equal(calls.length,4);
});

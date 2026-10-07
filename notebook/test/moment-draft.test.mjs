import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains,momentDraft} from '../core/domains.mjs';

// The Add Moment form's "Suggest title and other values" got "scheduled",
// "neutral", "high", a timestamp and "people"; the form reads past_fact /
// future_plan / ongoing / unknown, numbers, a date and "participants", so all
// of it fell back to defaults (6 October 2026).
test('a moment draft arrives in the form\'s own values',()=>{
  assert.deepEqual(momentDraft({title:'Knee MRI',happened_at:'2026-10-12T09:00:00Z',status:'scheduled',impact_level:'neutral',confidence_date:'high',confidence_truth:7.6,people:['Fictional Ana']}),
    {title:'Knee MRI',happened_at:'2026-10-12',happened_end:null,status:'future_plan',impact_level:2,confidence_date:8,confidence_truth:8,participants:['Fictional Ana'],people:['Fictional Ana']});
  assert.equal(momentDraft({status:'past_fact',impact_level:9}).impact_level,4);
});
test('the model is told today and the form\'s values, and its answer is normalized',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-draft-'))),domains=new Domains(new QueryService(store));let seen;
  domains.provider=async input=>{seen=input;return {draft:{title:'Knee MRI',happened_at:'2026-10-12',status:'scheduled',impact_level:'2',confidence_date:9,confidence_truth:9,participants:['Dr. Example']}};};
  const result=await domains.invoke('draft-event',{messages:[{role:'user',content:'Knee MRI on Monday'}],today:'2026-10-06',people:[]});
  assert.equal(seen.input.today,'2026-10-06');assert.match(seen.contract,/past_fact, future_plan, ongoing, unknown/);assert.match(seen.contract,/input\.today/);
  assert.equal(result.draft.status,'future_plan');assert.equal(result.draft.impact_level,2);
});

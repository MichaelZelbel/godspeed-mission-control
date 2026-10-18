import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {momentDraft} from '../core/moment-draft.mjs';
import {draftEvent} from '../core/draft-event.mjs';
import {CONTRACT,shapeProposal} from '../core/proposals.mjs';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {memoryDefinitions} from '../server/memory-tools.mjs';

test('new impact labels normalize and missing impact defaults to Everyday',()=>{
  for(const [label,level] of [['Everyday',1],['Short-term',2],['Lasting',3],['Life-defining',4]]) assert.equal(momentDraft({impact_level:label}).impact_level,level);
  assert.equal(momentDraft({}).impact_level,1);
});

test('field assistance explains all four levels and accepts mundane breakfast',async()=>{
  const result=await draftEvent(async request=>{
    for(const label of ['Everyday','Short-term','Lasting','Life-defining'])assert.ok(request.contract.includes(label));
    assert.match(request.contract,/breakfast/);assert.match(request.contract,/positive or negative/);assert.match(request.contract,/never exclude/i);
    return {draft:{title:'Breakfast',description:'I will have breakfast now',happened_at:'2026-10-17',status:'future_plan',impact_level:'Everyday',confidence_date:9,confidence_truth:9,participants:[]}};
  },{message:'I will have breakfast now',today:'2026-10-17'});
  assert.equal(result.draft.impact_level,1);assert.equal(result.draft.title,'Breakfast');
});

test('note processing permits routine moments while keeping the durable-fact requirement',()=>{
  assert.match(CONTRACT,/durable facts/);assert.match(CONTRACT,/routine|mundane/);assert.match(CONTRACT,/Everyday/);
  const result=shapeProposal({type:'add_moment',payload:{title:'Breakfast',description:'I will have breakfast now',happened_at:'2026-10-17',status:'future_plan'},evidence_quote:'I will have breakfast now'},{note:{id:'journal'},person:()=>null,today:'2026-10-17',cites:()=>true});
  assert.equal(result.payload.impact_level,1);
});

test('connected assistants see the impact scale and the valid hint range',()=>{
  const tool=memoryDefinitions.find(t=>t.name==='create_moment_with_ai'),hint=tool.inputSchema.properties.impact_level_hint;
  assert.equal(hint.type,'integer');assert.equal(hint.minimum,1);assert.equal(hint.maximum,4);
  for(const label of ['Everyday','Short-term','Lasting','Life-defining'])assert.ok(hint.description.includes(label));
});


test('keeping a processed moment retains its chosen impact level',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-impact-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store),domains=new Domains(query),note=store.save('notes',{title:'Journal',content:'Fictional event'});
  for(const impact of [1,2,3,4]){
    const proposal=shapeProposal({type:'add_moment',payload:{title:'Fictional event '+impact,happened_at:'2026-10-17',impact_level:impact},evidence_quote:'Fictional event'},{note,person:()=>null,today:'2026-10-17',cites:()=>true});
    const item=store.save('review_queue',{suggestion_type:'add_moment',status:'pending_review',payload:proposal.payload});
    const result=await domains.invoke('review-queue-bulk',{action:'keep',ids:[item.id]});
    assert.equal(result.succeeded,1,JSON.stringify(result));assert.equal(query.rows('moments').find(m=>m.title==='Fictional event '+impact).impact_level,impact);
  }
});

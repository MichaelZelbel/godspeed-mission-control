// #1040: one month of a chat is drafted into moment suggestions; nothing is saved by this.
import test from 'node:test';import assert from 'node:assert/strict';
import {draftChatMoments} from '../core/chat-moments.mjs';
import {NO_AI_CHAT,AI_UNREADABLE} from '../core/no-ai.mjs';

const lines=['2025-02-03 Mia: We are moving to Lisbon in March'];
test('suggestions are normalised and kept only when dated inside the month',async()=>{
  const seen=[];
  const provider=async request=>{seen.push(request);return JSON.stringify({moments:[
    {title:' Move   to Lisbon ',happened_at:'2025-02-03',quote:'We are moving',status:'planned',impact_level:'high',participants:['Mia']},
    {title:'Wrong month',happened_at:'2025-03-03',quote:'x'},
    {title:'Not a day',happened_at:'2025-02-31',quote:'x'},
    {title:'',happened_at:'2025-02-04'},
  ]});};
  const {moments}=await draftChatMoments(provider,{month:'2025-02',person:{name:'Mia'},lines});
  assert.equal(moments.length,1);
  assert.deepEqual(moments[0],{title:'Move to Lisbon',happened_at:'2025-02-03',status:'future_plan',impact_level:moments[0].impact_level,quote:'We are moving',participants:['Mia']});
  assert.equal(seen.length,1);
});
test('no AI, no lines, a bad month and an unreadable reply are refused plainly',async()=>{
  await assert.rejects(draftChatMoments(null,{month:'2025-02',lines}),{message:NO_AI_CHAT});
  await assert.rejects(draftChatMoments(async()=>'{}',{month:'2025-02',lines:[]}));
  await assert.rejects(draftChatMoments(async()=>'{}',{month:'February',lines}));
  await assert.rejects(draftChatMoments(async()=>'nonsense',{month:'2025-02',lines}),{message:AI_UNREADABLE});
});

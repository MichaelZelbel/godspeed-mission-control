import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {leadCommand} from '../core/lead-commands.mjs';import {lead} from '../core/lead.mjs';
function fixture(){
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-video-queue-'))),query=new QueryService(store);
 const goal=store.save('goals',{title:'Fictional public education',status:'adopted'}),position=store.save('lead_positions',{title:'Fictional source dates',status:'adopted',goal_id:goal.id});store.save('lead_examples',{status:'approved',content:'Keep the source date with the answer.'});
 const source=store.save('notes',{title:'Fictional retained experiment',content:'The fictional adapter retains the original source date.',lead_evidence:true});
 const collection=store.save('collections',{name:'Fictional video ideas',field_schema:[{key:'title',type:'text',primary:true},{key:'script',type:'longtext'}]});
 const video={enabled:true,pipeline_confirmed:true,collection_id:collection.id,title_field:'title',script_field:'script'};
 const draft={kind:'entry',shape:'video',title:'Fictional source-date explanation',position_id:position.id,script:('This fictional demonstration keeps an original source date beside the answer so a reader can inspect it before relying on a remembered statement. ').repeat(5),scenes:[{start_seconds:0,visual:'Show a fictional note and its original date.'},{start_seconds:20,visual:'Highlight the source quote beside the retained answer.'}],evidence:[{source_id:source.id,quote:'retains the original source date.'}],reader_check:{reader:'People using personal notes',venue:'A video idea queue',understands:'Answers need dated sources',feels:'Curious',takeaway:'Inspect the original date',spam_check:'A useful attributed demonstration'},reach:null};
 return {store,query,goal,position,source,collection,video,draft};
}
const configure=(f,video=f.video)=>leadCommand(f,['configure',JSON.stringify({video})]);
const provider=f=>async input=>input.kind==='lead-verification'?{passed:true,reason:'Fictional actual script claims and reader checked'}:f.draft;
test('video configuration requires confirmation, visible destination and usable distinct text fields',()=>{
 const f=fixture();assert.throws(()=>configure(f,{...f.video,pipeline_confirmed:false}),/Confirm/);assert.throws(()=>configure(f,{...f.video,script_field:'title'}),/separate/);
 f.store.save('collections',{id:f.collection.id,ai_visibility:'hidden'});assert.throws(()=>configure(f),/assistant-visible/);assert.equal(f.store.get('settings','lead'),undefined);
});
test('the actual configured collection receives one complete checked script and repeats stay quiet',async()=>{
 const f=fixture();configure(f);const result=await lead({kind:'lead',id:'fictional-video'},{...f,provider:provider(f)}),entry=f.store.get('lead_entries',result.entry_id),item=f.store.get('collection_items',entry.queue_item_id);
 assert.equal(item.collection_id,f.collection.id);assert.equal(item.data.title,f.draft.title);assert.ok(item.data.script.startsWith(f.draft.script));assert.ok(item.data.script.includes('20s: Highlight'));assert.equal(item.state,'draft');assert.equal(item.lead_entry_id,entry.id);assert.equal(f.store.list('notifications').length,1);
 const again=await lead({kind:'lead',id:'fictional-video-retry'},{...f,provider:async()=>{throw Error('A retained daily script must not run twice');}});assert.equal(again.silent,true);assert.equal(f.store.list('collection_items').length,1);
});
test('disabled video and an outline instead of a complete script fail without creating queue items',async()=>{
 const f=fixture();await assert.rejects(lead({id:'fictional-disabled-video'},{...f,provider:provider(f)}),/enabled confirmed/);assert.equal(f.store.list('collection_items').length,0);
 configure(f);f.draft.script='Record a video about the date.';await assert.rejects(lead({id:'fictional-outline'},{...f,provider:provider(f)}),/complete video script/);assert.equal(f.store.list('lead_entries').length,0);
});
test('changing the destination during the independent check prevents filing in either queue',async()=>{
 const f=fixture();configure(f);await assert.rejects(lead({id:'fictional-changed-video'},{...f,provider:async input=>{if(input.kind==='lead-verification'){configure(f,{enabled:false});return {passed:true,reason:'Fictional reviewed draft'};}return f.draft;}}),/pipeline|queue/);assert.equal(f.store.list('collection_items').length,0);assert.equal(f.store.list('notifications').length,0);
});
test('rejected script claims stay failed even though the source quote is exact',async()=>{
 const f=fixture();configure(f);await assert.rejects(lead({id:'fictional-video-claim'},{...f,provider:async input=>input.kind==='lead-verification'?{passed:false,reason:'The script invents benefits'}:f.draft}),/invents benefits/);assert.equal(f.store.list('collection_items').length,0);assert.equal(f.store.list('job_receipts').filter(r=>r.kind==='lead-verification'&&r.state==='failed').length,2);
});

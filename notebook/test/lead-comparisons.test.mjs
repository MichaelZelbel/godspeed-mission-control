import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {leadCommand} from '../core/lead-commands.mjs';import {weeklyComparison} from '../core/lead-comparisons.mjs';import {hash} from '../core/records/store.mjs';
function fixture(){const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-weekly-comparison-'))),query=new QueryService(store),goal=store.save('goals',{title:'Fictional adopted comparison',status:'adopted'}),protocol=store.save('notes',{title:'Fictional agreed protocol',content:'Fictional software acceptance: preserve both original outputs verbatim, commit the private blind key before preparing a comparison, and stop accepting late outputs after the cutoff.'}),collection=store.save('collections',{name:'Fictional actual comparison outputs',field_schema:[{key:'side',type:'text'},{key:'period',type:'text'},{key:'output',type:'longtext'}]}),starts_at=new Date(Date.now()-1000).toISOString(),config={enabled:true,adopted:true,goal_id:goal.id,protocol_note_id:protocol.id,collection_id:collection.id,side_field:'side',period_field:'period',text_field:'output',sides:['Fictional independent desk','Fictional comparison author'],starts_at,cutoff_hours:24};leadCommand({store,query},['configure',JSON.stringify({comparison:config})]);return {store,query,goal,protocol,collection,config,settings:store.get('settings','lead')};}
function output(f,side,text){return f.store.save('collection_items',{collection_id:f.collection.id,data:{side,period:f.config.starts_at,output:text}});}

test('an edit after cutoff preserves the actual output accepted before cutoff and marks only the absent side missing',async()=>{
 const f=fixture(),start=Date.now()-2*3600000;f.config.starts_at=new Date(start).toISOString();f.config.cutoff_hours=1;
 leadCommand(f,['configure',JSON.stringify({comparison:f.config})]);f.settings=f.store.get('settings','lead');
 const {atomic,encode}=await import('../core/records/store.mjs'),item=output(f,f.config.sides[0],'Fictional original output received on time. Preserve exactly.');
 const accepted={...item,updated_at:new Date(start+5*60000).toISOString()};delete accepted._hash;atomic(f.store.file(item),encode(accepted));
 const [waiting]=await weeklyComparison({...f,now:start+30*60000});assert.equal(waiting.state,'waiting');
 f.store.save('collection_items',{id:item.id,data:{...item.data,output:'Fictional edited text received after cutoff. Do not substitute it.'}});
 const [closed]=await weeklyComparison({...f,now:Date.now()});
 assert.equal(closed.state,'missing_sides');assert.equal(closed.outputs[0].content,waiting.outputs[0].content);assert.equal(closed.outputs[0].source_hash,waiting.outputs[0].source_hash);
 assert.equal(closed.outputs[0].source_version,'retained-history');assert.equal(closed.outputs[1].missing,true);assert.equal(closed.blind_key.commit,waiting.blind_key.commit);
 assert.ok(!closed.content.includes('edited text received after cutoff'));
});
test('actual comparison outputs stay verbatim and the private key has a verified real local Git commit',async()=>{
 const f=fixture(),one=output(f,f.config.sides[0],'Fictional company output: "Exact words."\nPreserve this line.'),two=output(f,f.config.sides[1],'Fictional other output, unchanged.');const [comparison]=await weeklyComparison(f);
 assert.equal(comparison.state,'ready');assert.equal(comparison.publication,'not-published');assert.ok(comparison.content.includes(one.data.output));assert.ok(comparison.content.includes(two.data.output));assert.equal(f.store.list('notifications').length,0);
 const file=path.join(f.store.root,comparison.blind_key.path),text=fs.readFileSync(file,'utf8');assert.equal(hash(text),comparison.blind_key.sha256);
 const committed=spawnSync('git',['--git-dir='+path.join(f.store.root,'.godspeed/lead-comparison-git',comparison.id+'.git'),'show',comparison.blind_key.commit+':blind-key.json'],{encoding:'utf8',windowsHide:true});assert.equal(committed.status,0);assert.equal(committed.stdout,text);
 const [again]=await weeklyComparison(f);assert.equal(again._hash,comparison._hash);assert.equal(f.store.list('lead_comparisons').length,1);
});
test('missing sides remain waiting, late output before cutoff completes the same comparison and retains the old version',async()=>{
 const f=fixture();output(f,f.config.sides[0],'Fictional first output.');const [waiting]=await weeklyComparison(f);assert.equal(waiting.state,'waiting');assert.equal(waiting.outputs.filter(o=>o.missing).length,1);
 const [quiet]=await weeklyComparison(f);assert.equal(quiet._hash,waiting._hash);output(f,f.config.sides[1],'Fictional late second output.');const [ready]=await weeklyComparison(f);assert.equal(ready.id,waiting.id);assert.equal(ready.state,'ready');assert.equal(ready.blind_key.commit,waiting.blind_key.commit);assert.ok(f.store.list('record_history').some(r=>r.source_id===ready.id&&r.snapshot.state==='waiting'));
});
test('the cutoff closes missing sides without inventing company work; later arrival does not overwrite the retained result',async()=>{
 const f=fixture();output(f,f.config.sides[0],'Fictional supplied side.');const [waiting]=await weeklyComparison(f),[closed]=await weeklyComparison({...f,now:Date.parse(waiting.cutoff_at)+1});assert.equal(closed.state,'missing_sides');assert.ok(closed.content.includes('Missing actual output'));output(f,f.config.sides[1],'Fictional after-cutoff output.');const [again]=await weeklyComparison({...f,now:Date.parse(waiting.cutoff_at)+5000});assert.equal(again._hash,closed._hash);assert.equal(f.store.list('lead_comparisons').length,1);
});
test('ambiguous actual outputs and changed agreed protocol are refused rather than smoothed or regenerated',async()=>{
 const f=fixture();output(f,f.config.sides[0],'Fictional first.');const [waiting]=await weeklyComparison(f);f.store.save('notes',{id:f.protocol.id,content:'Fictional changed protocol.'});await assert.rejects(weeklyComparison(f),/protocol changed/);assert.equal(f.store.get('lead_comparisons',waiting.id)._hash,waiting._hash);
 const other=fixture();output(other,other.config.sides[0],'Fictional one.');output(other,other.config.sides[0],'Fictional two.');await assert.rejects(weeklyComparison(other),/ambiguous/);assert.equal(other.store.list('lead_comparisons').length,0);
});
test('a paused adopted goal prevents comparison, and adoption is required explicitly',async()=>{
 const f=fixture();assert.throws(()=>leadCommand(f,['configure',JSON.stringify({comparison:{...f.config,adopted:false}})]),/actual adopted/);f.store.save('goals',{id:f.goal.id,status:'paused'});assert.deepEqual(await weeklyComparison(f),[]);
});
test('a failed local Git attempt retains its original blind key and recovery never reassigns the sides',async()=>{
 const f=fixture(),id='lead-comparison-'+hash([f.config.starts_at,hash(f.settings.comparison)]),gitDir=path.join(f.store.root,'.godspeed/lead-comparison-git',id+'.git');fs.mkdirSync(path.dirname(gitDir),{recursive:true});fs.writeFileSync(gitDir,'Fictional retained Git failure fixture',{flag:'wx'});
 await assert.rejects(weeklyComparison(f),/could not be committed/);assert.equal(f.store.list('lead_comparisons').length,0);
 const keyFile=path.join(f.store.root,'work/lead-comparisons',id,'blind-key.json'),key=fs.readFileSync(keyFile,'utf8');fs.renameSync(gitDir,gitDir+'.retained-failed-fixture');
 const [recovered]=await weeklyComparison(f);assert.equal(fs.readFileSync(keyFile,'utf8'),key);assert.deepEqual(recovered.blind_key.mapping,JSON.parse(key).mapping);assert.match(recovered.blind_key.commit,/^[0-9a-f]{40}$/);
});

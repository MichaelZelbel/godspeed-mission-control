import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {procedure} from '../core/procedures.mjs';
import {fileURLToPath} from 'node:url';
function fixture(){const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-audit-'))),query=new QueryService(store);return {store,query};}
test('scheduled audit records four evidenced structural layers and unknown external coverage',async()=>{
 const f=fixture();fs.writeFileSync(path.join(f.store.root,'AGENTS.md'),('A meaningful fictional operating manual explains the chosen workspace. ').repeat(30));fs.mkdirSync(path.join(f.store.root,'profile'));fs.writeFileSync(path.join(f.store.root,'profile','voice.md'),'Fictional voice: short and plain.');f.store.save('profiles',{name:'Fictional Tester',purpose:'Test a useful workflow'});
 for(let i=0;i<4;i++)f.store.save('notes',{title:'Fictional knowledge '+i,content:'Useful fictional evidence '+i});f.store.save('decisions',{title:'Fictional choice',reason:'The saved evidence supports this choice'});f.store.save('jobs',{id:'fictional-recurring',kind:'audit',paused:false,interval_ms:86400000});f.store.save('job_receipts',{job_id:'fictional-recurring',state:'verified',finished_at:new Date().toISOString()});
 const result=await procedure({id:'audit-test',kind:'audit'},f);assert.equal(result.verified,true);const note=f.store.get('notes',result.record_id),audit=note.audit;
 assert.equal(audit.structural_only,true);assert.deepEqual(audit.layers.map(x=>x.name),['Context','Connections','Capabilities','Cadence']);assert.equal(audit.layers[0].score,20);assert.equal(audit.layers[1].criteria.find(c=>c.key==='universal-domains').earned,0);assert.equal(audit.layers[3].score,20);assert.ok(audit.gaps.length<=3);assert.ok(audit.scope_gaps.includes('Peer reachability is unverified'));assert.match(note.content,/structural/);assert.equal(f.store.list('jobs')[0].paused,false);
 const again=await procedure({id:'audit-test',kind:'audit'},f);assert.equal(again.silent,true);assert.equal(f.store.list('notes').filter(n=>n.source_app==='audit').length,1);
 assert.ok(audit.gaps.every(g=>g.correction&&g.verification));assert.ok(audit.strengths.length);assert.match(note.content,/Correction:.*Verification:/);
 f.store.save('job_receipts',{job_id:'fictional-recurring',state:'verified',finished_at:new Date().toISOString()});const sameStructure=await procedure({id:'audit-test',kind:'audit'},f);assert.equal(sameStructure.silent,true,'A new healthy receipt is not a new structural finding');
});
test('audit connection scores require fresh observed receipts and never expose credentials',async()=>{
 const f=fixture();fs.mkdirSync(path.join(f.store.state,'connectors'));fs.writeFileSync(path.join(f.store.state,'connectors','fictional-calendar.json'),JSON.stringify({token:'never-print-this-fictional-secret',domain:'calendar',guide:'references/calendar.md',write_capable:true}));fs.mkdirSync(path.join(f.store.root,'references'));fs.writeFileSync(path.join(f.store.root,'references','calendar.md'),'Fictional connector guide.');f.store.save('connector_status',{id:'fictional-calendar',ok:true,checked_at:new Date().toISOString(),last_success:new Date().toISOString()});
 const result=await procedure({id:'audit-test',kind:'audit'},f),note=f.store.get('notes',result.record_id);assert.equal(note.audit.layers[1].criteria.find(c=>c.key==='universal-domains').earned,1.5);assert.equal(note.audit.layers[1].criteria.find(c=>c.key==='read-write').earned,2);assert.ok(!JSON.stringify(note).includes('never-print-this-fictional-secret'));assert.equal(note.audit.layers[1].criteria.find(c=>c.key==='freshness').earned,5);
 f.store.save('connector_status',{id:'fictional-calendar',ok:false,checked_at:new Date().toISOString(),last_success:'2000-01-01T00:00:00Z'});const changed=await procedure({id:'audit-test',kind:'audit'},f);assert.notEqual(changed.record_id,result.record_id);assert.equal(f.store.get('notes',changed.record_id).audit.previous_baseline.id,note.id);
});

test('the full audit judges actual message and rule excerpts with source quotes before retaining findings',async()=>{
 const f=fixture(),message=f.store.save('conversation_messages',{role:'assistant',content:'The internal decision code R6 represents the layer 2 review.'});fs.mkdirSync(path.join(f.store.root,'rules'));fs.writeFileSync(path.join(f.store.root,'rules','plain-language.md'),'Explain the actual result in plain language.');let calls=0;
 const provider=async input=>{calls++;assert.equal(input.kind,'structural-audit-review');assert.ok(input.context.messages.some(m=>m.id===message.id));return {findings:[{source_type:'message',source_id:message.id,quote:message.content,finding:'This answer exposes an unexplained internal code.',correction:'Explain the result in everyday words.'}],comparison:'No supplied comparator evidence establishes a material difference.'};};
 const result=await procedure({id:'audit-test',kind:'audit'},{...f,provider}),note=f.store.get('notes',result.record_id);assert.equal(calls,1);assert.equal(note.audit.semantic_review.findings[0].source_id,message.id);assert.match(note.content,/unexplained internal code/);assert.equal(fs.readFileSync(path.join(f.store.root,'rules','plain-language.md'),'utf8'),'Explain the actual result in plain language.');
});

test('fabricated audit findings exhaust one repair without saving an accepted report',async()=>{
 const f=fixture();let calls=0;const provider=async()=>{calls++;return {findings:[{source_type:'message',source_id:'invented-message',quote:'invented text',finding:'Fictional finding',correction:'Fictional correction'}],comparison:'No material difference.'};};
 await assert.rejects(procedure({id:'audit-test',kind:'audit'},{...f,provider}),/after one correction/);assert.equal(calls,2);assert.equal(f.store.list('notes').filter(n=>n.source_app==='audit').length,0);assert.equal(f.store.list('job_receipts').filter(r=>r.kind==='audit-source-check'&&r.state==='failed').length,2);
});

test('audit retains unresolved failed routines and distinguishes later verified recovery',async()=>{
 const f=fixture();f.store.save('job_receipts',{id:'old-failure',job_id:'fictional-job',state:'failed',error:'Fictional connector check failed',finished_at:'2026-01-01T00:00:00Z'});
 const first=await procedure({id:'audit-test',kind:'audit'},f),note=f.store.get('notes',first.record_id);assert.ok(note.audit.integrity.some(i=>i.receipt_id==='old-failure'));assert.match(note.content,/Fictional connector check failed/);
 f.store.save('job_receipts',{job_id:'fictional-job',state:'verified',finished_at:new Date().toISOString()});const next=await procedure({id:'audit-test',kind:'audit'},f);assert.ok(!f.store.get('notes',next.record_id).audit.integrity.some(i=>i.receipt_id==='old-failure'));assert.equal(f.store.get('job_receipts','old-failure').state,'failed');
});

test('unchanged shipped starter methods do not earn user-customized skill points',async()=>{
 const f=fixture(),name='morning-brief',folder=path.join(f.store.root,'skills',name);fs.mkdirSync(folder,{recursive:true});const shipped=fs.readFileSync(fileURLToPath(new URL('../../starter-godspeed/skills/morning-brief/SKILL.md',import.meta.url)),'utf8');fs.writeFileSync(path.join(folder,'SKILL.md'),shipped);
 const first=await procedure({id:'audit-test',kind:'audit'},f);assert.equal(f.store.get('notes',first.record_id).audit.layers[2].criteria.find(c=>c.key==='customised-skill').earned,0);
 fs.appendFileSync(path.join(folder,'SKILL.md'),'\nFictional user customization: compare the agreed garden readings.\n');const changed=await procedure({id:'audit-test',kind:'audit'},f);assert.equal(f.store.get('notes',changed.record_id).audit.layers[2].criteria.find(c=>c.key==='customised-skill').earned,10);
});

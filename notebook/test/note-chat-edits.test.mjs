import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains,noteContentHash} from '../core/domains.mjs';

// A note chat edit is applied to the whole note as the model was given it, and
// never over what the owner did meanwhile (review of 6 October 2026).
const fixture=(t,provider=null)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query,{provider});return {root,store,query,domains};};
const conflicts=root=>fs.existsSync(path.join(root,'conflicts'))?fs.readdirSync(path.join(root,'conflicts')).map(f=>JSON.parse(fs.readFileSync(path.join(root,'conflicts',f),'utf8'))):[];

test('an AI edit of a note longer than the prompt never saves the cut copy as the whole note',async t=>{
 let seen;const body='Intro with teh typo.\n'+'Paragraph of a long journal entry. '.repeat(900)+'\nTHE ENDING THAT MATTERS';
 const env=fixture(t,async({kind,context})=>{if(kind!=='note-chat')return {terms:[]};seen=context.notes[0];return {reply:'Fixed the typo.',note_content:seen.content.replace('teh','the')};});
 const note=env.store.save('notes',{title:'Long journal',content:body});
 const refused=await env.domains.invoke('note-chat',{note_id:note.id,base_updated_at:note.updated_at,message:'Fix the typo in this note'});
 assert.equal(seen.context_truncated,true);assert.ok(seen.content.length<body.length);
 assert.equal(env.store.get('notes',note.id).content,body);assert.equal(refused.note_edit,undefined);assert.match(refused.reply,/not changed/);
 // Exact changes are applied to the whole note, which the model never saw whole.
 env.domains.provider=async({kind})=>kind!=='note-chat'?{terms:[]}:{reply:'Fixed the typo and added a line.',note_edits:[{find:'with teh typo',replace:'with the typo'},{append:'\nA closing line'}]};
 const fixed=await env.domains.invoke('note-chat',{note_id:note.id,message:'Fix the typo in this note and append a closing line'});
 const expected=body.replace('teh','the')+'\nA closing line';
 assert.equal(env.store.get('notes',note.id).content,expected);assert.equal(fixed.note_edit.content,expected);assert.equal(fixed.note_edit.previous_content,body);
 // A change whose text is not found exactly once changes nothing.
 env.domains.provider=async({kind})=>kind!=='note-chat'?{terms:[]}:{reply:'Done.',note_edits:[{find:'Paragraph of a long journal entry.',replace:'x'}]};
 const ambiguous=await env.domains.invoke('note-chat',{note_id:note.id,message:'Change the paragraph in this note'});
 assert.equal(env.store.get('notes',note.id).content,expected);assert.match(ambiguous.reply,/not changed/);
 // The cut copy handed back unchanged, or no list of changes, is no edit: the tag is still added.
 env.domains.provider=async({kind,context})=>kind!=='note-chat'?{terms:[]}:{reply:'Tagged.',note_content:context.notes[0].content,note_edits:null,note_changes:{tags:['journal']}};
 await env.domains.invoke('note-chat',{note_id:note.id,message:'Add the tag journal to this note'});
 assert.equal(env.store.get('notes',note.id).content,expected);assert.deepEqual(env.store.get('notes',note.id).tags,['journal']);
});

test('a note chat change keeps what the owner did while the model worked, or refuses with a saved conflict',async t=>{
 // Tags the owner added during the call stay; the model's tag is added.
 let note;const a=fixture(t,async({kind})=>{if(kind!=='note-chat')return {terms:[]};const now=a.store.get('notes',note.id);a.store.save('notes',{id:note.id,tags:['owner-added','work']},now._hash);return {reply:'Tagged.',note_changes:{tags:['work','ai-suggested']}};});
 note=a.store.save('notes',{title:'Meeting',content:'Short note',tags:['work']});
 await a.domains.invoke('note-chat',{note_id:note.id,base_updated_at:note.updated_at,message:'Add a tag ai-suggested to this note'});
 assert.deepEqual([...a.store.get('notes',note.id).tags].sort(),['ai-suggested','owner-added','work']);
 // A metadata change sets its own fields and keeps the rest (imported ids, the owner's summary).
 const b=fixture(t,async({kind})=>kind!=='note-chat'?{terms:[]}:{reply:'Marked as an idea.',note_changes:{metadata:{type:'idea',menerio_source_id:'forged'}}});
 const imported=b.store.save('notes',{title:'Import',content:'text',metadata:{menerio_source_id:'abc',menerio_source_table:'notes',ai_fields:['summary','type'],type:'observation',summary:'owner summary',people:['Anna']}});
 await b.domains.invoke('note-chat',{note_id:imported.id,base_updated_at:imported.updated_at,message:'Change the type of this note to idea'});
 assert.deepEqual(b.store.get('notes',imported.id).metadata,{menerio_source_id:'abc',menerio_source_table:'notes',ai_fields:['summary'],type:'idea',summary:'owner summary',people:['Anna']});
 // A line the owner typed during the call is never overwritten, even without a base from the screen.
 let draft;const c=fixture(t,async({kind,context})=>{if(kind!=='note-chat')return {terms:[]};const now=c.store.get('notes',draft.id);c.store.save('notes',{id:draft.id,content:now.content+'\nOWNER LINE TYPED DURING THE CALL'},now._hash);return {reply:'Done.',note_content:context.notes[0].content+'\nAI line'};});
 draft=c.store.save('notes',{title:'Draft',content:'Base text'});
 await assert.rejects(c.domains.invoke('note-chat',{note_id:draft.id,message:'Append a closing line to this note'}),e=>e.code==='CONFLICT');
 assert.equal(c.store.get('notes',draft.id).content,'Base text\nOWNER LINE TYPED DURING THE CALL');
 assert.ok(conflicts(c.root).some(x=>x.local.content==='Base text\nAI line'),'the assistant version is kept for review');
 // The screen's version (its content hash) must be the version the model edited.
 const d=fixture(t,async({kind,context})=>kind!=='note-chat'?{terms:[]}:{reply:'Done.',note_content:context.notes[0].content+' and more'});
 const open=d.store.save('notes',{title:'Open',content:'Saved text'});
 await assert.rejects(d.domains.invoke('note-chat',{note_id:open.id,base_content_hash:noteContentHash('Saved text with unsaved words'),message:'Append "and more" to this note'}),e=>e.code==='CONFLICT');
 assert.equal(d.store.get('notes',open.id).content,'Saved text');
 await d.domains.invoke('note-chat',{note_id:open.id,base_content_hash:noteContentHash('Saved text'),message:'Append "and more" to this note'});
 assert.equal(d.store.get('notes',open.id).content,'Saved text and more');
});

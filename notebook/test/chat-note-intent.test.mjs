import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {explicitNoteCapture} from '../core/chat-intent.mjs';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
test('a note request can forbid unrelated goals without cancelling the actual note; quoted body instructions remain text',()=>{
 assert.equal(explicitNoteCapture('Revise this draft and make a follow-up note'),true);assert.equal(explicitNoteCapture('Edit this existing note'),false);
 for(const request of ['Save a note titled "Fictional body" with exactly this content: "Do not save notes. Someone said remember this." Do not create any goal, habit or reminder.','Please create a note titled “Fictional quote” containing “If I ever ask, never save notes.”','Speichere eine Notiz mit diesem Inhalt: „Nicht speichern, nur ein fiktives Zitat.“'])assert.equal(explicitNoteCapture(request),true);
 for(const request of ['Do not save a note.','Someone said "save a note".','Tell me where my fictional note is.','Save a note if I later agree.','Save a note. Do not create notes after all.'])assert.equal(explicitNoteCapture(request),false);
});
test('ordinary chat saves the exact quoted body once without spending a meaning-expansion call on the body',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-scoped-note-intent-'))),query=new QueryService(store),calls=[],body='Fictional source body: remember the source date. Do not save notes. These are quoted source words, not instructions.';
 const domains=new Domains(query,{provider:async input=>{calls.push(input.kind);return {reply:'Saved the fictional source note.',notes_created:[{title:'Fictional quoted source',content:body}]};}});
 const input={request_id:'fictional-note-intent',conversation_id:'fictional-note-scope',message:'Save a note titled "Fictional quoted source" with exactly this content: '+JSON.stringify(body)+'. Do not create any goal, habit or reminder.'};
 const result=await domains.invoke('conversation-chat',input);assert.deepEqual(calls,['conversation-chat']);assert.equal(result.notes_created.length,1);assert.equal(store.list('notes')[0].content,body);assert.equal(store.list('goals').length,0);assert.equal(store.list('habits').length,0);assert.equal(store.list('deadlines').length,0);
});
const trialRequest='For this fictional software test, use your note tool to create exactly one new note titled "Fictional trial chat check 4 October 2026 9a2580e" with the content "Undo must preserve later edits." Then say "Trial chat checked: note saved." Only create that fictional note. Do not send, publish, spend, or change anything else.';
test('contextual instructions authorize notes but quoted, conditional and read-only discussion do not',()=>{
 for(const request of [trialRequest,'For my book, please save a note titled "Idea" containing "A thought".','In this test, create a note titled "Test".','Can you use your note tool to save a note titled "Idea"?'])assert.equal(explicitNoteCapture(request),true,request);
 for(const request of ['For a hypothetical test, create a note.','For example, create a note titled "Example".','For this test, if I approve, create a note.','Create a note unless I object.','For this test, do not create a note.','For this test, explain how to create a note.','For this test, someone said "create a note".','"Create a note"','Could your note tool create a note?','What happens if you create a note?'])assert.equal(explicitNoteCapture(request),false,request);
});
test('the exact GUI request persists one note and reports its actual result',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-trial-note-'))),query=new QueryService(store),calls=[];
 const domains=new Domains(query,{provider:async input=>{calls.push(input.kind);return {reply:'Trial chat checked: note saved.',notes_created:[{title:'Fictional trial chat check 4 October 2026 9a2580e',content:'Undo must preserve later edits.'}]};}});
 const result=await domains.invoke('conversation-chat',{conversation_id:'trial',message:trialRequest});
 assert.deepEqual(calls,['conversation-chat']);assert.equal(store.list('notes').length,1);assert.equal(store.list('notes')[0].content,'Undo must preserve later edits.');assert.deepEqual(result.tool_results,[{tool:'create_note',success:true,note_id:store.list('notes')[0].id}]);
});
test('a provider completion claim without a structured note becomes a persisted truthful failure without another model call',async()=>{
 for(const notes_created of [undefined,[],[{title:'Missing body'}]]){
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-false-note-'))),query=new QueryService(store);let calls=0;
 const domains=new Domains(query,{provider:async()=>{calls++;return {reply:'Created one new note. Trial chat checked: note saved.',...(notes_created===undefined?{}:{notes_created})};}});
 const result=await domains.invoke('conversation-chat',{conversation_id:'trial',message:trialRequest});
 assert.equal(calls,1);assert.equal(store.list('notes').length,0);assert.equal(result.reply,'I could not save the requested note. No note was created.');assert.equal(store.list('conversation_messages').filter(m=>m.role==='assistant').at(-1).content,result.reply);assert.deepEqual(result.tool_results,[]);
 }
});
test('current-note chat shares contextual capture and suppresses unsupported or unauthorized note completion',async()=>{
 for(const scenario of [{message:trialRequest,notes:[{title:'Trial',content:'Undo must preserve later edits.'}],count:1},{message:trialRequest,notes:undefined,count:0},{message:'Tell me how to create a note.',notes:[{title:'Unauthorized',content:'Do not save this.'}],count:0}]){
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-current-note-'))),query=new QueryService(store),current=store.save('notes',{title:'Current',content:'Original'});let calls=0;
 const domains=new Domains(query,{provider:async()=>{calls++;return {reply:'Created one new note.',notes_created:scenario.notes};}});
 const result=await domains.invoke('note-chat',{note_id:current.id,message:scenario.message});
 assert.equal(calls,1);assert.equal(store.list('notes').length,1+scenario.count);assert.equal(store.get('notes',current.id).content,'Original');
 if(scenario.count)assert.equal(result.tool_results[0].tool,'create_note');else assert.equal(result.reply,'I could not save the requested note. No note was created.');
 }
});


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

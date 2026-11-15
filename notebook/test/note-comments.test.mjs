import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// Comments on notes (18 October 2026). The README lists comments among the notebook's features,
// and the notebook has stored them since version 2 began (the `comments` records), but no screen
// showed them: the one component for them was never placed on any page. A note now has a Comments
// panel (ui/src/components/notes/NoteCommentsPanel.tsx). This runs, against a real notebook, the
// requests that panel sends, and checks a comment is kept in its own file, lasts a restart and is
// deleted as a removal another computer will follow.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');

async function start(root){
 const service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
 const query=async request=>{const response=await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});const result=await response.json();assert.equal(response.status,200,result.error);return result;};
 // What the panel asks: this note's comments, oldest first.
 const list=noteId=>query({table:'comments',filters:[['eq','note_id',noteId]],orders:[['created_at',{ascending:true}]],selection:'*'});
 return {service,query,list};
}

test('a comment on a note is stored, listed with that note only, kept over a restart and deleted for good',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-comments-'));
 let running=await start(root);t.after(()=>running.service.close());
 const {query}=running;
 const note=(await query({table:'notes',operation:'insert',values:{title:'Garden plan',content:'Tomatoes by the south wall.'}})).data[0];
 const other=(await query({table:'notes',operation:'insert',values:{title:'Reading list',content:'Three books.'}})).data[0];

 const first=(await query({table:'comments',operation:'insert',values:{note_id:note.id,content:'Ask the neighbour about the hose.',author:'owner'}})).data[0];
 await new Promise(resolve=>setTimeout(resolve,15));
 const second=(await query({table:'comments',operation:'insert',values:{note_id:note.id,content:'Seeds ordered.',author:'owner'}})).data[0];
 await query({table:'comments',operation:'insert',values:{note_id:other.id,content:'Not about the garden.',author:'owner'}});
 for(const comment of [first,second]){assert.ok(comment.id);assert.ok(Number.isFinite(Date.parse(comment.created_at)),'a date the panel can show');assert.equal(comment.author,'owner');}

 assert.deepEqual((await running.list(note.id)).data.map(c=>c.content),['Ask the neighbour about the hose.','Seeds ordered.'],'this note\'s comments, oldest first');
 assert.deepEqual((await running.list(other.id)).data.map(c=>c.content),['Not about the garden.']);

 // Its own file in the notebook folder, which sync carries like every other record, linked to its note.
 const file=path.join(root,'notebook','_system','comments',first.id+'.json');
 assert.ok(fs.existsSync(file),'notebook/_system/comments/<id>.json');
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(saved.note_id,note.id);assert.equal(saved.content,'Ask the neighbour about the hose.');
 assert.ok(saved.references.some(r=>r.type==='notes'&&r.id===note.id&&r.field==='note_id'),'the comment names its note');

 // A restart reads it back from the file.
 await running.service.close();running=await start(root);
 assert.deepEqual((await running.list(note.id)).data.map(c=>c.id),[first.id,second.id],'kept over a restart');

 // Deleting, as the panel does: the comment leaves the list and its file keeps only the removal.
 const current=await running.list(note.id);
 const deleted=await running.query({table:'comments',operation:'delete',filters:[['eq','id',first.id]],expected:{[first.id]:current.data[0]._hash}});
 assert.equal(deleted.data.length,1);
 assert.deepEqual((await running.list(note.id)).data.map(c=>c.content),['Seeds ordered.']);
 assert.ok(JSON.parse(fs.readFileSync(file,'utf8')).removed_at,'a removal another computer follows');
 await running.service.close();running=await start(root);
 assert.deepEqual((await running.list(note.id)).data.map(c=>c.content),['Seeds ordered.'],'still gone after a restart');
});

test('the note page shows the Comments panel, and the panel sends those requests',()=>{
 const editor=read('../ui/src/components/notes/NoteEditor.tsx'),panel=read('../ui/src/components/notes/NoteCommentsPanel.tsx');
 assert.match(editor,/import \{ NoteCommentsPanel \} from "\.\/NoteCommentsPanel";/);
 assert.match(editor,/<NoteCommentsPanel noteId=\{note\.id\} readOnly=\{!!note\.is_trashed\} \/>/);
 assert.match(panel,/\.from\("comments"\)\s*\.select\("\*"\)\s*\.eq\("note_id", noteId\)\s*\.order\("created_at", \{ ascending: true \}\)/);
 assert.match(panel,/\.from\("comments"\)\.insert\(\{ note_id: noteId, content, author: "owner" \}\)/);
 assert.match(panel,/\.from\("comments"\)\.delete\(\)\.eq\("id", comment\.id\)/);
 assert.doesNotMatch(panel,/[–—]/,'no long dashes in what a reader sees');
 assert.ok(!fs.existsSync(new URL('../ui/src/local/NoteComments.tsx',import.meta.url)),'one comments component, the one the note page shows');
});

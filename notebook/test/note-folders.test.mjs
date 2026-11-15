import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {createService} from '../server/main.mjs';

// The Notes page makes, renames and moves a folder with four RPCs (Notes.tsx, callFolderRpc).
// The local notebook answered none of them until 27 October 2026: typing a folder name and
// creating it ended in "Unimplemented RPC: create_note_folder" and no folder, and renaming or
// moving one failed the same way, while the hosted notebook did all three (#37).
const workspace=name=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-folders-'+name+'-'));
const paths=query=>query.rows('note_folders').map(f=>f.path).sort();
const folderOf=(query,id)=>query.rows('notes').find(n=>n.id===id).folder_path;

test('folders are made, renamed and moved on the local store, with the notes and folders under them',()=>{
  const root=workspace('store'),query=new QueryService(new Store(root));

  // Create: the page's own path shape, the folders above it, and no second row for a path it has.
  assert.deepEqual(query.rpc('create_note_folder',{p_path:'/Travel//Japan/'}),{path:'Travel/Japan',created:['Travel','Travel/Japan']});
  assert.deepEqual(query.rpc('create_note_folder',{p_path:'Travel/Japan'}),{path:'Travel/Japan',created:[]});
  assert.deepEqual(paths(query),['Travel','Travel/Japan']);
  assert.throws(()=>query.rpc('create_note_folder',{p_path:'   '}),/A folder needs a name/);

  // Rename: the folder, the folder under it and the note inside it move together.
  query.rpc('create_note_folder',{p_path:'Travel/Japan/Kyoto'});
  const note=query.execute({table:'notes',operation:'insert',values:{title:'Kyoto in April',content:'Cherry trees',folder_path:'Travel/Japan/Kyoto'},single:true}).data;
  const elsewhere=query.execute({table:'notes',operation:'insert',values:{title:'Packing list',content:'Socks',folder_path:'Travel'},single:true}).data;
  assert.deepEqual(query.rpc('rename_note_folder',{p_old_path:'Travel/Japan',p_new_path:'Travel/Nippon'}),{path:'Travel/Nippon',folders:2,notes:1,created:[]});
  assert.deepEqual(paths(query),['Travel','Travel/Nippon','Travel/Nippon/Kyoto']);
  assert.equal(folderOf(query,note.id),'Travel/Nippon/Kyoto');
  assert.equal(folderOf(query,elsewhere.id),'Travel','a note outside the folder stays where it was');

  // A rename onto a folder that is already there is refused, and changes nothing.
  assert.throws(()=>query.rpc('rename_note_folder',{p_old_path:'Travel/Nippon',p_new_path:'Travel'}),/A folder called Travel already exists/);
  assert.throws(()=>query.rpc('rename_note_folder',{p_old_path:'Travel/Rails',p_new_path:'Travel/Trains'}),/There is no folder called Travel\/Rails/);
  assert.deepEqual(paths(query),['Travel','Travel/Nippon','Travel/Nippon/Kyoto']);

  // Move: an empty target parent is the top level, and the move is a rename to <parent>/<name>.
  assert.deepEqual(query.rpc('move_note_folder',{p_source_path:'Travel/Nippon',p_target_parent_path:''}),{path:'Nippon',folders:2,notes:1,created:[]});
  assert.deepEqual(paths(query),['Nippon','Nippon/Kyoto','Travel']);
  assert.equal(folderOf(query,note.id),'Nippon/Kyoto');

  // Moving a folder into itself, or into something inside it, is refused in words.
  assert.throws(()=>query.rpc('move_note_folder',{p_source_path:'Nippon',p_target_parent_path:'Nippon'}),/A folder cannot move into itself/);
  assert.throws(()=>query.rpc('move_note_folder',{p_source_path:'Nippon',p_target_parent_path:'Nippon/Kyoto'}),/A folder cannot move into itself/);
  // So is a move onto a folder that is already there.
  query.rpc('create_note_folder',{p_path:'Archive/Nippon'});
  assert.throws(()=>query.rpc('move_note_folder',{p_source_path:'Nippon',p_target_parent_path:'Archive'}),/A folder called Archive\/Nippon already exists/);
  assert.deepEqual(paths(query),['Archive','Archive/Nippon','Nippon','Nippon/Kyoto','Travel']);

  // A move under a folder that is not saved yet saves it too.
  assert.deepEqual(query.rpc('move_note_folder',{p_source_path:'Nippon',p_target_parent_path:'Trips/2026'}),{path:'Trips/2026/Nippon',folders:2,notes:1,created:['Trips','Trips/2026']});
  assert.equal(folderOf(query,note.id),'Trips/2026/Nippon/Kyoto');

  // Reconcile: a note filed straight into a folder nobody saved makes it, and its parents, folders.
  const filed=query.execute({table:'notes',operation:'insert',values:{title:'Quarter close',content:'Numbers',folder_path:'Work/2026/Q4'},single:true}).data;
  const trashed=query.execute({table:'notes',operation:'insert',values:{title:'Dropped',content:'Gone',folder_path:'Old/Ideas',is_trashed:true},single:true}).data;
  assert.deepEqual(query.rpc('reconcile_note_folders',{}),{created:['Work','Work/2026','Work/2026/Q4']});
  assert.deepEqual(query.rpc('reconcile_note_folders',{}),{created:[]});
  assert.ok(paths(query).includes('Work/2026/Q4'));
  assert.ok(!paths(query).includes('Old/Ideas'),'a note in the trash does not make a folder');
  assert.equal(folderOf(query,trashed.id),'Old/Ideas');

  // Reloaded from the same folder on disk, as the page is after a reload: all of it is still there.
  const after=new QueryService(new Store(root));
  assert.deepEqual(paths(after),['Archive','Archive/Nippon','Travel','Trips','Trips/2026','Trips/2026/Nippon','Trips/2026/Nippon/Kyoto','Work','Work/2026','Work/2026/Q4']);
  assert.equal(folderOf(after,note.id),'Trips/2026/Nippon/Kyoto');
  assert.equal(folderOf(after,filed.id),'Work/2026/Q4');
});

test('the Notes page makes, renames and moves a folder through the running notebook, and a reload still shows it',async()=>{
  const root=workspace('server');
  let service=await createService({root,port:0});
  let base='http://127.0.0.1:'+service.address.port;
  // Exactly what the page sends: supabase.rpc(fn, args) posts to /api/rpc, and its folder list is
  // .from("note_folders").select("path").order("path") on /api/query (adapters' supabase client).
  const call=async(route,input)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};};
  const rpc=async(rpcName,args)=>{const {status,body}=await call('rpc',{rpc:rpcName,args});assert.equal(status,200,JSON.stringify(body));return body.data;};
  const folders=async()=>{const {status,body}=await call('query',{table:'note_folders',selection:'path',orders:[['path',{ascending:true}]]});assert.equal(status,200,JSON.stringify(body));return body.data.map(f=>f.path);};
  const noteFolder=async id=>(await call('query',{table:'notes',selection:'id,folder_path',filters:[['eq','id',id]],single:true})).body.data.folder_path;
  try{
    assert.deepEqual(await rpc('create_note_folder',{p_path:'Reading/2026'}),{path:'Reading/2026',created:['Reading','Reading/2026']});
    assert.deepEqual(await folders(),['Reading','Reading/2026']);
    const note=(await call('query',{table:'notes',operation:'insert',values:{title:'On writing',content:'Notes on a book',folder_path:'Reading/2026'},single:true})).body.data;

    await rpc('rename_note_folder',{p_old_path:'Reading/2026',p_new_path:'Reading/This year'});
    assert.deepEqual(await folders(),['Reading','Reading/This year']);
    assert.equal(await noteFolder(note.id),'Reading/This year');

    await rpc('move_note_folder',{p_source_path:'Reading/This year',p_target_parent_path:''});
    assert.deepEqual(await folders(),['Reading','This year']);
    assert.equal(await noteFolder(note.id),'This year');

    // A refusal comes back as the message the page shows in its toast, not as a blank failure.
    const refused=await call('rpc',{rpc:'move_note_folder',args:{p_source_path:'This year',p_target_parent_path:'This year'}});
    assert.equal(refused.status,400);
    assert.match(refused.body.error,/A folder cannot move into itself/);
    const empty=await call('rpc',{rpc:'create_note_folder',args:{p_path:'  '}});
    assert.equal(empty.status,400);
    assert.match(empty.body.error,/A folder needs a name/);

    // The page reloaded, on a notebook started again from the same folder.
    await service.close();
    service=await createService({root,port:0});
    base='http://127.0.0.1:'+service.address.port;
    assert.deepEqual(await folders(),['Reading','This year']);
    assert.equal(await noteFolder(note.id),'This year');
  }finally{await service.close();}
});

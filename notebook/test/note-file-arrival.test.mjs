import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/records/store.mjs';
import { createService } from '../server/main.mjs';

// A note file that arrives in the notes folder from outside (another editor, a sync
// tool, another device) becomes a note the notebook lists and finds (#897). The
// store adopts the page in place: its words, name and folder are kept, and the
// record's frontmatter is written around them.

const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-arrival-'));
const until=async(check,ms=10000)=>{const end=Date.now()+ms;for(;;){const value=await check();if(value||Date.now()>end)return value;await new Promise(r=>setTimeout(r,50));}};
const notes=async base=>(await(await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'notes',operation:'select'})})).json()).data;
const search=async(base,q)=>(await(await fetch(base+'/api/search?'+new URLSearchParams({q,types:'notes',mode:'words',format:'notes'}))).json()).data;

test('a plain page written into a running notebook becomes a note in the list and in the search',async()=>{
  const root=temporary(),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const before=await notes(base);assert.deepEqual(before,[]);
    // Without frontmatter, at the top of the notes folder.
    fs.writeFileSync(path.join(root,'notebook','From another editor.md'),'# From another editor\n\nWritten outside the notebook.\n');
    // With frontmatter another tool wrote, in a folder of its own.
    fs.mkdirSync(path.join(root,'notebook','Notes'),{recursive:true});
    fs.writeFileSync(path.join(root,'notebook','Notes','Foreign note.md'),'---\ntitle: Foreign note\ntags: []\n---\n\nBody of the foreign note.\n');
    const listed=await until(async()=>{
      const rows=await notes(base);
      return rows.length===2?rows:null;
    });
    assert.ok(listed,'both pages are in the notes list within a few seconds');
    assert.deepEqual(listed.map(n=>n.title).sort(),['Foreign note','From another editor']);
    assert.equal(listed.find(n=>n.title==='From another editor').content,'# From another editor\n\nWritten outside the notebook.\n','the page\'s whole text is the note\'s body');
    assert.equal(listed.find(n=>n.title==='Foreign note').folder_path,'Notes','the page stays in its folder');
    const found=await until(async()=>((await search(base,'outside the notebook')).length&&((await search(base,'body of the foreign')).length))?true:null);
    assert.ok(found,'both pages are found by the notes search');
    // The file the note came from is the note's file now, with frontmatter around the words.
    const kept=fs.readFileSync(path.join(root,'notebook','From another editor.md'),'utf8');
    assert.match(kept,/---[\s\S]+type: note[\s\S]+---\n# From another editor\n\nWritten outside the notebook\.\n$/);
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a page that arrives with frontmatter of its own keeps the title, tags and favorite it carries, and the file does not end up with two frontmatter blocks',async()=>{
  const root=temporary(),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    fs.writeFileSync(path.join(root,'notebook','garden-2026.md'),'---\ntitle: Garden plans\ntags: [garden, spring]\nfavorite: true\n---\n\nRake the beds.\n');
    const listed=await until(async()=>{const rows=await notes(base);return rows.find(n=>n.title==='Garden plans')||null;});
    assert.ok(listed,'the note carries the title the page\'s frontmatter named');
    assert.deepEqual(listed.tags,['garden','spring'],'the tags the page carried are the note\'s tags');
    assert.equal(listed.is_favorite,true,'the page\'s favorite marks the note');
    assert.equal(listed.content,'Rake the beds.\n','the text below the page\'s frontmatter is the body, and the frontmatter itself is not body text');
    const kept=fs.readFileSync(path.join(root,'notebook','garden-2026.md'),'utf8');
    assert.equal((kept.match(/^---$/gm)||[]).length,2,'the file holds one frontmatter block, not two');
    assert.match(kept,/favorite: true/,'the file\'s frontmatter keeps the favorite the page carried');
    const found=await until(async()=>(await search(base,'rake the beds')).length?true:null);
    assert.ok(found,'and the search finds it');
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('an outside edit to a note that arrived reaches the list and the search while the notebook runs',async()=>{
  const root=temporary(),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    fs.writeFileSync(path.join(root,'notebook','From the sync tool.md'),'# first words\n');
    const listed=await until(async()=>{const rows=await notes(base);return rows.find(n=>n.title==='From the sync tool')||null;});
    assert.ok(listed,'the page is a note');
    const file=path.join(root,'notebook','From the sync tool.md'),text=fs.readFileSync(file,'utf8');
    fs.writeFileSync(file,text.replace('# first words','# first words quokkafern'));
    const got=await until(async()=>{const rows=await notes(base);return rows.find(n=>n.id===listed.id)?.content.includes('quokkafern')||null;});
    assert.ok(got,'the new words reach the notes list');
    const found=await until(async()=>(await search(base,'quokkafern')).length?true:null);
    assert.ok(found,'and the notes search finds them');
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a note file written while the notebook was stopped appears after the next start',async()=>{
  const root=temporary();
  let service=await createService({root,port:0});
  try{await notes('http://127.0.0.1:'+service.address.port);}finally{await service.close();}
  fs.writeFileSync(path.join(root,'notebook','Written offline.md'),'A note made while nothing ran.\n');
  service=await createService({root,port:0});
  try{
    const base='http://127.0.0.1:'+service.address.port;
    const listed=await until(async()=>{const rows=await notes(base);return rows.some(n=>n.title==='Written offline')?rows:null;});
    assert.ok(listed,'the page is a note after the next start');
    const found=await until(async()=>(await search(base,'made while nothing ran')).length?true:null);
    assert.ok(found,'and the search finds it');
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a file that is not a note never appears: temporary, swap and hidden files stay out',async()=>{
  const root=temporary(),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    fs.writeFileSync(path.join(root,'notebook','draft.md.tmp'),'half written\n');
    fs.writeFileSync(path.join(root,'notebook','.hidden.md'),'kept to itself\n');
    fs.writeFileSync(path.join(root,'notebook','.swap.swp'),'swap\n');
    fs.writeFileSync(path.join(root,'notebook','editor.md~'),'a backup copy\n');
    await new Promise(r=>setTimeout(r,2000));
    const rows=await notes(base);
    assert.deepEqual(rows.map(n=>n.title),[]);
    assert.equal(service.store.list('notes').length,0);
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a page the notebook saw before it first looked stays the owner\'s own page',async()=>{
  const root=temporary(),seed=new Store(root);seed.save('notes',{id:'seed',title:'Seed',content:'x'});
  fs.mkdirSync(path.join(root,'notebook','Ideas'),{recursive:true});
  fs.writeFileSync(path.join(root,'notebook','Ideas','Kept page.md'),'# kept as it was\n');
  const store=new Store(root,{watch:true});
  try{
    assert.equal(store.list('notes').some(n=>n.title==='Kept page'),false,'not adopted at the first look');
    assert.ok([...store.documents].some(f=>f.endsWith('Kept page.md')));
    assert.equal(fs.readFileSync(path.join(root,'notebook','Ideas','Kept page.md'),'utf8'),'# kept as it was\n','left byte for byte');
    // The decision is remembered: the next start keeps it a page too, and a
    // page that arrives later still becomes a note.
    store.unwatch();
    const again=new Store(root,{watch:true});
    try{
      assert.equal(again.list('notes').some(n=>n.title==='Kept page'),false,'still the owner\'s page after the next start');
      fs.writeFileSync(path.join(root,'notebook','Ideas','New page.md'),'# arrived later\n');
      assert.equal(await until(()=>again.list('notes').some(n=>n.title==='New page')),true,'a later page becomes a note');
    }finally{again.unwatch();}
  }finally{store.unwatch();}
});

test('a second outside edit within five seconds of the first is found by search as fast as the first',async()=>{
  const root=temporary(),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  const BOUND=5000; // the issue's window: well above the milliseconds a working edit takes
  try{
    const file=path.join(root,'notebook','Twice edited.md');
    fs.writeFileSync(file,'# Twice edited\n\nfirst words\n');
    const listed=await until(async()=>{const rows=await notes(base);return rows.find(n=>n.title==='Twice edited')||null;});
    assert.ok(listed,'the page is a note');
    // The atomic replace every save and every adoption uses: the new text is
    // written beside the file and renamed over it. An outside editor keeps
    // the file's frontmatter and adds to the body.
    const edit=(file,words)=>{fs.writeFileSync(file+'.tmp',fs.readFileSync(file,'utf8')+'\n'+words+'\n');fs.renameSync(file+'.tmp',file);};
    edit(file,'quartzforge');
    assert.ok(await until(async()=>(await search(base,'quartzforge')).length?true:null,BOUND),'the first edit is found within '+BOUND+' ms');
    await new Promise(r=>setTimeout(r,2000));
    edit(file,'emberglass');
    assert.ok(await until(async()=>(await search(base,'emberglass')).length?true:null,BOUND),'the second edit, within five seconds of the first, is found within the same bound');
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a notebook folder replaced from outside still delivers what is written into the new one',async()=>{
  const root=temporary(),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  const BOUND=5000,notebook=path.join(root,'notebook'),realWatch=fs.watch;
  try{
    fs.writeFileSync(path.join(notebook,'Before the swap.md'),'# quarrymap words\n');
    assert.ok(await until(async()=>(await search(base,'quarrymap')).length?true:null,BOUND),'the note before the replacement is found');
    // The whole folder moved away and a new folder made in its place, the way
    // a sync tool or a restore replaces a workspace folder. Holding the
    // re-watch (a watch budget that stays exhausted until the later note is
    // written) keeps that note provably inside the dark window: while the
    // watcher cannot be rebuilt, a re-armed watcher cannot exist yet, so the
    // note written here can only be reached by the recovery reading
    // everything. Letting the re-watch through before the write would let a
    // watcher that happened to exist report it and mask the recovery.
    fs.watch=(p,...rest)=>{if(String(p)===notebook){const error=new Error('the watch budget is exhausted');error.code='ENOSPC';throw error;}return realWatch(p,...rest);};
    fs.renameSync(notebook,notebook+' moved away');
    fs.mkdirSync(notebook);
    fs.writeFileSync(path.join(notebook,'After the swap.md'),'# emberlake words\n');
    assert.ok(await until(async()=>(await search(base,'emberlake')).length?true:null,BOUND),'a note written into the replaced folder is found within '+BOUND+' ms');
    // And the folder keeps delivering: a later note in it is found too, not
    // just the first one after the replacement.
    fs.writeFileSync(path.join(notebook,'After the swap 2.md'),'# mistvale words\n');
    fs.watch=realWatch;
    assert.ok(await until(async()=>(await search(base,'mistvale')).length?true:null,BOUND),'a later note in the replaced folder is found too');
  }finally{fs.watch=realWatch;await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a root watcher that cannot watch keeps retrying instead of giving up',async()=>{
  const root=temporary();
  fs.mkdirSync(path.join(root,'ideas'));
  fs.writeFileSync(path.join(root,'ideas','Kept.md'),'kept\n');
  const realWatch=fs.watch,target=path.join(root,'ideas');
  let service=null,base=null;
  const BOUND=5000;
  try{
    service=await createService({root,port:0});
    base='http://127.0.0.1:'+service.address.port;
    // From now on the ideas root itself cannot be watched (an exhausted watch
    // budget). Replacing the folder makes the running watcher notice, evict it
    // and re-arm a second later; the re-arm keeps retrying while the failure
    // lasts instead of giving up, so once watching is possible again the root
    // is watched without a restart.
    fs.watch=(p,...rest)=>{if(String(p)===target){const error=new Error('the watch budget is exhausted');error.code='ENOSPC';throw error;}return realWatch(p,...rest);};
    fs.renameSync(target,target+' was here');
    fs.mkdirSync(target);
    // The eviction's rebuild reads the replaced folder once it has settled.
    await new Promise(r=>setTimeout(r,1500));
    // A write made while the root is still unwatched is read by no watcher;
    // every retry signals the same rebuild, so what was written in the dark is
    // read even while the failure lasts. Deleting the signal leaves the note
    // to the ten-minute rebuild that re-reads everything.
    fs.writeFileSync(path.join(target,'Retry words.md'),'retry words unwatched no longer\n');
    const dark=await until(async()=>(await(await fetch(base+'/api/search?'+new URLSearchParams({q:'retry words unwatched no longer',mode:'words'}))).json()).data.some(r=>String(r.title).includes('Retry words')),BOUND);
    assert.ok(dark,'a note written while the root is unwatched is read by the retry\'s rebuild signal within '+BOUND+' ms');
    // Now let watching become possible again. The re-armed watcher starts
    // without announcing what is already there, so only what follows is its
    // proof: after this wait every retry has fired and settled, so a write now
    // is reported only by a root that is really watched again.
    fs.watch=realWatch;
    await new Promise(r=>setTimeout(r,3000));
    fs.writeFileSync(path.join(target,'Later words.md'),'retry words unwatched no longer\n');
    const found=await until(async()=>(await(await fetch(base+'/api/search?'+new URLSearchParams({q:'retry words unwatched no longer',mode:'words'}))).json()).data.some(r=>String(r.title).includes('Later words')),10000);
    assert.ok(found,'the failed root is watched again once watching is possible');
  }finally{fs.watch=realWatch;await service?.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a re-arm that outlives the service builds no watcher for the closed one',async()=>{
  const root=temporary();
  fs.mkdirSync(path.join(root,'ideas'));
  fs.writeFileSync(path.join(root,'ideas','Kept.md'),'kept\n');
  const realWatch=fs.watch,target=path.join(root,'ideas');
  let service=null,failing=true,built=null;
  try{
    service=await createService({root,port:0});
    // Replacing the folder makes the eviction and the rootWatcher re-arm the
    // same root within the same second; without cancelling the pending timer
    // the second rearm overwrites the map entry and the first chain is
    // orphaned, running on past close().
    fs.watch=(p,...rest)=>{
      if(String(p)===target){
        if(!failing){built=realWatch(p,...rest);return built;}
        const error=new Error('the watch budget is exhausted');error.code='ENOSPC';throw error;
      }
      return realWatch(p,...rest);
    };
    fs.renameSync(target,target+' was here');
    fs.mkdirSync(target);
    await new Promise(r=>setTimeout(r,1500));
    // Watching is possible again from here on; the service is closed first, so
    // only a retry chain that outlived close() can reach the watch.
    failing=false;
    await service.close();service=null;
    await new Promise(r=>setTimeout(r,2500));
    assert.equal(built,null,'no watcher is built for a closed service');
  }finally{fs.watch=realWatch;if(built)built.close();if(service)await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('an adopted note is edited like any note, in the file it came from',async()=>{
  const root=temporary(),store=new Store(root,{watch:true});
  try{
    fs.writeFileSync(path.join(root,'notebook','Adopted.md'),'first words\n');
    assert.equal(await until(()=>store.list('notes').some(n=>n.title==='Adopted')),true);
    const note=store.list('notes').find(n=>n.title==='Adopted');
    const file=store.file(note);
    assert.ok(file.endsWith('Adopted.md'),'the note keeps its file');
    store.save('notes',{id:note.id,content:'second words'},note._hash);
    assert.equal(fs.readFileSync(file,'utf8').includes('second words'),true,'the edit lands in the same file');
    assert.equal(await until(()=>store.get('notes',note.id).content==='second words'),true);
  }finally{store.unwatch();}
});

test('a note file overwritten from outside without frontmatter stays the same note and is found by its new text (#932)',async()=>{
  const root=temporary(),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const made=await(await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'notes',operation:'insert',values:{title:'Rewritten',content:'oldword here'}})})).json();
    assert.equal(made.error??null,null);
    const [note]=await notes(base);
    const file=path.join(root,'notebook',fs.readdirSync(path.join(root,'notebook')).find(n=>n.endsWith('.md')));
    fs.writeFileSync(file+'.tmp','newword only\n');fs.renameSync(file+'.tmp',file);
    assert.ok(await until(async()=>(await search(base,'newword')).length?true:null),'the new text is found without a verify');
    assert.equal((await search(base,'newword')).length,1,'one hit');
    assert.equal((await search(base,'oldword')).length,0,'the old text is gone');
    const rows=await notes(base);
    assert.equal(rows.length,1);assert.equal(rows[0].id,note.id);assert.equal(rows[0].content,'newword only\n');
    assert.match(fs.readFileSync(file,'utf8'),new RegExp('^---[\\s\\S]+uid: '+note.uid+'[\\s\\S]+---\\nnewword only\\n$'));
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a contact file that lost its frontmatter is still reported as lost and not made a note (#932)',async()=>{
  const root=temporary(),writer=new Store(root),person=writer.save('contacts',{name:'Anna'}),file=writer.file(person),store=new Store(root,{watch:true});
  try{
    fs.writeFileSync(file+'.tmp','plain words\n');fs.renameSync(file+'.tmp',file);
    assert.equal(await until(()=>{store.scan();return store.problems.some(p=>p.file===file);}),true);
    assert.equal(store.list('notes').length,0);
    assert.equal(store.problems.some(p=>p.file===file),true);
  }finally{store.unwatch();}
});

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
const until=async(check,ms=10000)=>{const end=Date.now()+ms;for(;;){const value=check();if(value||Date.now()>end)return value;await new Promise(r=>setTimeout(r,50));}};
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

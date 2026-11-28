import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {readSection,writeSection} from '../core/addon-fields.mjs';
// An add-on's pages in the notebook (#1182), against a local test add-on: nothing reaches GitHub.
const program=`import fs from 'node:fs';
const w=process.env.GODSPEED_WORKSPACE,[,,verb,...rest]=process.argv;
if(verb==='pages'){const m=JSON.parse(fs.readFileSync(w+'/model.json','utf8'));if(m==='bad'){process.stdout.write('not json');process.exit(0)}if(m==='fail')process.exit(2);console.log(JSON.stringify(m));}
else if(verb==='changed')fs.appendFileSync(w+'/changed.txt',rest.join(' ')+'\\n');
else if(verb==='action'){const input=fs.readFileSync(0,'utf8');console.log(JSON.stringify({state:'done',message:'Did '+rest[0]+' with '+input,refresh:true,html:'<b>x</b>'}))}
else if(verb==='job')console.log(JSON.stringify({state:'working',message:'Halfway',progress:0.5}));`;
const model=bind=>({format:1,menu:{title:'Dating',icon:'heart'},pages:[{id:'profile',title:'Profile',parts:[
  {kind:'text',id:'about',title:'About',bind},{kind:'list',id:'likes',title:'Likes',bind:{...bind,section:'Likes'}},
  {kind:'people',id:'dates',title:'Dates',filter:{property:'relationship',value:'date'}},{kind:'action',id:'go',title:'Go',action:'refresh',label:'Go'},{kind:'blink',id:'x'}]}]});
async function world(modelValue){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-addon-pages-')),copy=path.join(root,'.godspeed','addons','teston'),catalog=path.join(root,'catalog.json');
  fs.mkdirSync(copy,{recursive:true});fs.writeFileSync(path.join(copy,'teston.mjs'),program);
  fs.writeFileSync(path.join(root,'.godspeed','addons','added.json'),JSON.stringify({teston:{commit:'c1',checked_at:'2026-11-28T00:00:00Z'}}));
  fs.writeFileSync(catalog,JSON.stringify([{id:'teston',name:'the Teston',repository:'acme/teston',description:'Test.',setup:['teston.mjs','setup'],check:['teston.mjs','check'],remove:['teston.mjs','remove'],pages:['teston.mjs','pages'],changed:['teston.mjs','changed']}]));
  fs.writeFileSync(path.join(root,'model.json'),JSON.stringify(modelValue??model({note:'Dating Profile.md',section:'About'})));
  const previous=process.env.GODSPEED_ADDON_CATALOG;process.env.GODSPEED_ADDON_CATALOG=catalog;
  const service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  const get=async route=>{const r=await fetch(base+route);return {status:r.status,body:await r.json()};};
  const post=async(route,value)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
  const close=async()=>{await service.close();if(previous===undefined)delete process.env.GODSPEED_ADDON_CATALOG;else process.env.GODSPEED_ADDON_CATALOG=previous;};
  return {root,service,get,post,close};
}
const NOTE='# Dating\n\n## About\n\nOld words.\n\n## Likes\n\n- tea\n\n## Other\n\nKeep me.\n';

test('sections are read and replaced without touching the rest of the note',()=>{
  assert.equal(readSection(NOTE,'About'),'Old words.');assert.equal(readSection(NOTE,'Missing'),'');
  assert.equal(writeSection(NOTE,'About','New.'),'# Dating\n\n## About\n\nNew.\n\n## Likes\n\n- tea\n\n## Other\n\nKeep me.\n');
  assert.match(writeSection('Intro','Likes','- a'),/Intro\n\n## Likes\n\n- a\n$/);
});

test('an add-on that answers pages gets a menu entry, a page with its values, writes through the note, and loses both when removed',async()=>{
  const w=await world();
  try{
    const note=w.service.store.save('notes',{title:'Dating Profile',content:NOTE});
    const listed=(await w.get('/api/addons')).body.addons.find(a=>a.id==='teston');
    assert.deepEqual(listed.pages,{title:'Dating',icon:'heart',pages:[{id:'profile',title:'Profile'}]});
    const page=(await w.get('/api/addons/teston/pages/profile')).body;
    assert.equal(page.parts[0].value,'Old words.');assert.deepEqual(page.parts[1].items,['tea']);assert.equal(page.parts[0].bind,undefined);
    assert.deepEqual(page.parts[4],{kind:'blink'});
    const saved=await w.post('/api/addons/teston/field',{page:'profile',part:'about',value:'New words.',base:'Old words.'});
    assert.equal(saved.status,200);assert.equal(saved.body.changed,true);
    const after=w.service.store.get('notes',note.id);
    assert.equal(after.content,NOTE.replace('Old words.','New words.'));assert.equal(after.revision,note.revision+1);
    assert.equal(fs.readFileSync(path.join(w.root,'changed.txt'),'utf8'),'--field about\n');
    assert.ok(w.service.store.list('record_history').length>0);
    const list=await w.post('/api/addons/teston/field',{page:'profile',part:'likes',value:['tea','jam'],base:['tea']});
    assert.deepEqual(list.body.value,['tea','jam']);assert.match(w.service.store.get('notes',note.id).content,/- tea\n- jam\n/);
    const action=await w.post('/api/addons/teston/action',{page:'profile',part:'go',input:{a:1}});
    assert.deepEqual(action.body,{state:'done',message:'Did refresh with {"a":1}',refresh:true});
    assert.deepEqual((await w.get('/api/addons/teston/job/j-1')).body,{state:'working',message:'Halfway',refresh:false,progress:0.5});
    fs.rmSync(path.join(w.root,'.godspeed','addons','teston'),{recursive:true});fs.writeFileSync(path.join(w.root,'.godspeed','addons','added.json'),'{}');
    assert.equal((await w.get('/api/addons')).body.addons.find(a=>a.id==='teston').pages,undefined);
    assert.equal((await w.get('/api/addons/teston/pages/profile')).status,404);
  }finally{await w.close();}
});

test('a section changed since the page loaded it is not overwritten: nothing is written and both texts are kept',async()=>{
  const w=await world();
  try{
    const note=w.service.store.save('notes',{title:'Dating Profile',content:NOTE});
    w.service.store.save('notes',{id:note.id,content:NOTE.replace('Old words.','Someone else.')});
    const stale=await w.post('/api/addons/teston/field',{page:'profile',part:'about',value:'Mine.',base:'Old words.'});
    assert.equal(stale.status,409);assert.equal(stale.body.current,'Someone else.');
    assert.match(w.service.store.get('notes',note.id).content,/Someone else\./);assert.doesNotMatch(w.service.store.get('notes',note.id).content,/Mine\./);
    const kept=fs.readdirSync(path.join(w.root,'conflicts')).map(f=>JSON.parse(fs.readFileSync(path.join(w.root,'conflicts',f),'utf8')));
    assert.ok(kept.some(c=>c.local.content.includes('Mine.')&&c.remote.content.includes('Someone else.')));
    assert.equal(fs.existsSync(path.join(w.root,'changed.txt')),false);
    // A change elsewhere in the note is not a conflict.
    w.service.store.save('notes',{id:note.id,content:w.service.store.get('notes',note.id).content.replace('Keep me.','Elsewhere.')});
    const fine=await w.post('/api/addons/teston/field',{page:'profile',part:'about',value:'Mine.',base:'Someone else.'});
    assert.equal(fine.status,200);assert.match(w.service.store.get('notes',note.id).content,/Elsewhere\.[\s\S]*$/);
  }finally{await w.close();}
});

test('bad ids, unknown parts and a bind outside the notebook are refused',async()=>{
  for(const note of ['../outside.md','/etc/passwd','sub\\\\x.md','Link.md']){
    const w=await world(model({note,section:'About'}));
    try{
      fs.writeFileSync(path.join(w.root,'secret.md'),'## About\n\nsecret\n');
      if(note==='Link.md')fs.symlinkSync(path.join(w.root,'secret.md'),path.join(w.service.store.recordsRoot,'Link.md'));
      const written=await w.post('/api/addons/teston/field',{page:'profile',part:'about',value:'x',base:''});
      assert.ok([400,404].includes(written.status),note+' '+written.status);
      assert.equal(fs.readFileSync(path.join(w.root,'secret.md'),'utf8'),'## About\n\nsecret\n');
      assert.equal((await w.get('/api/addons/teston/pages/profile')).body.parts[0].value,'');
    }finally{await w.close();}
  }
  const w=await world();
  try{
    for(const route of ['/api/addons/nope/pages/profile','/api/addons/teston/pages/missing','/api/addons/teston/job/..%2Fx'])assert.equal((await w.get(route)).status,404,route);
    assert.equal((await w.post('/api/addons/teston/field',{page:'profile',part:'dates',value:'x',base:''})).status,404);
    assert.equal((await w.post('/api/addons/teston/action',{page:'profile',part:'about',input:{}})).status,404);
  }finally{await w.close();}
});

test('an add-on whose pages fail has no entry and one plain line',async()=>{
  for(const bad of ['bad','fail',{format:1,pages:[]}]){
    const w=await world(bad);
    try{
      const listed=(await w.get('/api/addons')).body.addons.find(a=>a.id==='teston');
      assert.equal(listed.pages,undefined);assert.match(listed.pagesError,/did not say what its pages are/);
    }finally{await w.close();}
  }
});

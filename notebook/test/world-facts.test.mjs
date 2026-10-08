import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {queryTerms} from '../core/index/search.mjs';
import {nativeAgent,homeHasModel} from '../core/native-agent.mjs';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';

// The notebook as it really was on 8 October 2026, not as it should be: his
// wife kept as three cards, none saying she is his wife; four old online
// girlfriends whose cards still say "partner"; a test card among them; the
// marriage only as a link between people and as a Mission Control world file.
// Asked "What's my wife's name?" the chat was handed the four "partners".
async function setup(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-world-facts-'));
  const service=await createService({root,port:0,provider:async()=>({})});
  const base='http://127.0.0.1:'+service.address.port;
  const call=async(name,args={})=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const result=(await r.json()).result;assert.equal(result.isError,undefined,result.content[0].text);const text=result.content[0].text;try{return JSON.parse(text);}catch{return text;}};
  const s=service.store;
  s.save('settings',{id:'installation',owner:'local',timezone:'Europe/Berlin'});
  const wife=s.save('contacts',{name:'Fictional Mei'}),copy1=s.save('contacts',{name:'Fictional Mei'}),copy2=s.save('contacts',{name:'Fictional Mei'});
  const exes=['Fictional Ann','Fictional Rae','Fictional Sol'].map(name=>s.save('contacts',{name,relationship:'partner'}));
  const girlfriend=s.save('contacts',{name:'Fictional Yu',relationship:'partner'}),lover=s.save('contacts',{name:'Fictional Rik'});
  const ex=s.save('contacts',{name:'Fictional Lea'}),hidden=s.save('contacts',{name:'Fictional Secret',ai_visibility:'hidden'});
  const link=(source,target,label)=>s.save('contact_relationships',{source_type:source?'contact':'self',source_id:source?.id||null,target_type:target?'contact':'self',target_id:target?.id||null,label});
  link(null,wife,'spouse');link(girlfriend,null,'partner');link(wife,lover,'lover');link(null,ex,'partner');
  const world=path.join(root,'world');fs.mkdirSync(path.join(world,'claims'),{recursive:true});fs.mkdirSync(path.join(world,'entities'),{recursive:true});
  const file=(folder,name,fields,body='')=>fs.writeFileSync(path.join(world,folder,name),'---\n'+Object.entries(fields).map(([k,v])=>k+': '+(Array.isArray(v)?'['+v.join(', ')+']':v)).join('\n')+'\n---\n\n'+body+'\n');
  file('entities','owner.md',{slug:'owner',name:'Fictional Owner',type:'person',self:'true'});
  file('entities','mei.md',{slug:'mei',name:'Fictional Mei',type:'real_person',aliases:['Fictional Mei','Fictional Emmy'],menerio_id:wife.id});
  file('entities','lea.md',{slug:'lea',name:'Fictional Lea',type:'real_person'});
  file('entities','secret.md',{slug:'secret',name:'Fictional Secret',type:'real_person',menerio_id:hidden.id});
  file('claims','mei--relationship--2026-07-19.md',{subject:'mei',attribute:'relationship',value:'wife',valid_from:'2026-07-19',confidence:'likely',origin:'godspeed'},'He said: "in the evening with my wife Mei."');
  file('claims','owner--relationship--undated.md',{subject:'owner',attribute:'relationship',value:'spouse',object:'mei',cardinality:'many',origin:'menerio'});
  file('claims','lea--relationship-to-michael--2026-10-03.md',{subject:'lea',attribute:'relationship-to-michael',value:'ex-girlfriend',valid_from:'2026-10-03',origin:'godspeed'});
  file('claims','secret--relationship--2026-09-01.md',{subject:'secret',attribute:'relationship',value:'girlfriend',valid_from:'2026-09-01',origin:'godspeed'});
  file('entities','rik.md',{slug:'rik',name:'Fictional Rik',type:'real_person',menerio_id:lover.id});
  file('claims','rik--relationship-to-mei--2026-10-08.md',{subject:'rik',attribute:'relationship-to-mei',value:'lover',valid_from:'2026-10-08',origin:'godspeed'});
  file('claims','mei--hobbies--2026-08-01.md',{subject:'mei',attribute:'hobbies',value:'fictional pottery',valid_from:'2026-08-01',origin:'godspeed'});
  s.save('notes',{title:'Names',content:'Full name of the fictional neighbour is Fictional Karl. His name day is in May.'});
  service.index.rebuild();
  return {service,call,wife,copy1,copy2,exes,girlfriend,lover,ex,hidden};
}

test('asked for his wife\'s name, the wife comes first, from the link and the world file, whatever the cards say',async()=>{
  const {service,call,wife}=await setup();
  try{
    const text=await call('search_brain',{query:'What\'s my wife\'s name?'});
    const claims=text.split('\n\n').filter(b=>b.startsWith('[claim]'));
    assert.ok(claims.length>=1,text);
    assert.match(claims[0],/Fictional Mei/,'the first fact names her: '+claims[0]);
    assert.doesNotMatch(claims.slice(0,2).join('\n'),/Full name/,'"name" no longer fills the facts');
    const german=await call('search_brain',{query:'Wie heißt meine Frau?',include:['claim']});
    assert.match(german.split('\n\n').find(b=>b.startsWith('[claim]'))||'',/Fictional Mei/);
    const profile=await call('get_user_profile',{});
    assert.equal(profile.relationships.structured[0].name,'Fictional Mei');
    assert.equal(profile.relationships.structured[0].contact_id,wife.id);
    assert.match(profile.relationships.structured[0].relationship,/spouse/);
    assert.match(profile.relationships.structured[0].relationship,/wife/);
    assert.equal(profile.relationships.structured[1].name,'Fictional Yu','the partner the links name comes before the cards');
  }finally{await service.close();}
});

test('a newer "ex" ends an older "partner", a card alone is listed last, and a hidden person never appears',async()=>{
  const {service,call,exes}=await setup();
  try{
    const profile=await call('get_user_profile',{});
    const names=profile.relationships.structured.map(r=>r.name);
    assert.ok(!names.includes('Fictional Lea'),'Lea is a former girlfriend');
    assert.deepEqual(profile.relationships.former.map(r=>r.name),['Fictional Lea']);
    assert.deepEqual(names.slice(-3).sort(),exes.map(e=>e.name).sort(),'cards only speak for people nothing else speaks about, after them');
    assert.doesNotMatch(JSON.stringify(profile),/Fictional Secret/);
    assert.doesNotMatch(JSON.stringify(profile.relationships),/Fictional Rik/,'her lover is hers, not the owner\'s');
    assert.match(await call('search_brain',{query:'Who is Fictional Mei\'s lover?',include:['claim']}),/Fictional Rik/);
    assert.doesNotMatch(await call('search_brain',{query:'girlfriend',include:['claim']}),/Fictional Secret/);
  }finally{await service.close();}
});

test('world claims are facts: by name, without a type, with every card of that name, never twice',async()=>{
  const {service,call,wife,copy1}=await setup();
  try{
    service.store.save('claims',{subject_type:'contact',subject_id:copy1.id,attribute:'job-title',value:'Fictional engineer',confidence:'likely',valid_from:'2026-06-21'});
    const facts=await call('get_claims',{subject_name:'Fictional Mei'});
    const values=facts.claims.map(c=>c.value);
    assert.ok(values.includes('fictional pottery'),'a world file about her is one of her facts');
    assert.ok(values.includes('Fictional engineer'),'so is a fact kept on another card with her name');
    assert.ok(values.includes('lover: Fictional Rik'),'and the link from her');
    assert.ok(facts.claims.every(c=>c.subject==='Fictional Mei'),'only hers: '+facts.claims.map(c=>c.subject).join(', '));
    assert.equal(values.filter(v=>v==='wife').length,1);
    // A world file that copies a notebook claim (the import kept Menerio's id) is not a second fact.
    const kept=service.store.save('claims',{subject_type:'contact',subject_id:wife.id,attribute:'favourite-tea',value:'fictional jasmine',confidence:'likely'});
    fs.writeFileSync(path.join(service.store.root,'world','claims','mei--favourite-tea--undated.md'),'---\nsubject: mei\nattribute: favourite-tea\nvalue: fictional jasmine tea\nmenerio_id: '+kept.id+'\n---\n');
    assert.equal((await call('get_claims',{subject_name:'Fictional Mei',attribute:'favourite-tea'})).claims.length,1);
    assert.equal((await call('get_claims',{subject_name:'Nobody Fictional'})).count,0,'a name nothing has finds nothing, not everything');
  }finally{await service.close();}
});

test('a possessive is its word',()=>{
  assert.deepEqual(queryTerms('What\'s my wife\'s name?'),[['What'],['my'],['wife'],['name']]);
  assert.deepEqual(queryTerms('Michael’s parents\' house'),[['Michael'],['parents'],['house']]);
  assert.deepEqual(queryTerms('excluded-marker v2.18'),[['excluded','marker'],['v2','18']]);
});

test('the chat answers with the assistant home\'s own model; the notebook\'s model only when picked or when the home has none',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-home-model-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const home=path.join(dir,'home'),bare=path.join(dir,'bare'),providerFile=path.join(dir,'provider.json');
  fs.mkdirSync(home);fs.mkdirSync(bare);
  fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openai-codex\n  default: fictional-model\nfallback_providers:\n  - model: other\n');
  fs.writeFileSync(path.join(bare,'config.yaml'),'agent:\n  max_turns: 3\nmodel: {}\n');
  fs.writeFileSync(providerFile,JSON.stringify({url:'https://fictional.example/v1/chat/completions',key:'fictional-key',model:'fictional/small'}));
  assert.equal(homeHasModel(home),true);assert.equal(homeHasModel(bare),false);assert.equal(homeHasModel(path.join(dir,'none')),false);
  const run=async(h,input)=>{let captured;const agent=nativeAgent({executable:'hermes',home:h,cwd:dir,providerFile,spawnProcess:(exe,args,options)=>{captured={args,env:options.env};const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin.on('data',()=>queueMicrotask(()=>{child.stdout.write('Fictional reply');child.emit('close',0);}));return child;}});await agent({message:'Fictional question',...input});return captured;};
  const own=await run(home,{});
  assert.equal(own.args.includes('--provider'),false);assert.equal(own.args.includes('--model'),false);assert.equal(own.env.OPENAI_API_KEY,undefined);
  const picked=await run(home,{model:'fictional/large'});
  assert.deepEqual(picked.args.slice(picked.args.indexOf('--model'),picked.args.indexOf('--model')+2),['--model','fictional/large']);assert.ok(picked.args.includes('--provider'));
  const none=await run(bare,{});
  assert.deepEqual(none.args.slice(none.args.indexOf('--model'),none.args.indexOf('--model')+2),['--model','fictional/small']);assert.equal(none.env.OPENAI_API_KEY,'fictional-key');
});

test('one fixed name per kind of fact: the newest value of a one-at-a-time fact is its value, under any name and from either store',async()=>{
  const {service,call}=await setup();
  try{
    const root=service.store.root,world=path.join(root,'world');
    fs.writeFileSync(path.join(world,'fields.json'),JSON.stringify({fields:[
      {name:'lives-in',one:true,aliases:['location','current-city','city']},
      {name:'hobbies',one:false,aliases:['hobby']}]}));
    const file=(name,fields)=>fs.writeFileSync(path.join(world,'claims',name),'---\n'+Object.entries(fields).map(([k,v])=>k+': '+v).join('\n')+'\n---\n');
    file('owner--location--undated.md',{subject:'owner',attribute:'location',value:'Fictional Old Town',origin:'menerio'});
    file('owner--current-city--2026-03-01.md',{subject:'owner',attribute:'current-city',value:'Fictional Middle Town',valid_from:'2026-03-01'});
    service.store.save('claims',{subject_type:'self',attribute:'city',value:'Fictional New Town',confidence:'likely',valid_from:'2026-09-30'});
    file('owner--hobby--2026-01-01.md',{subject:'owner',attribute:'hobby',value:'fictional chess',valid_from:'2026-01-01'});
    file('owner--hobbies--2026-09-01.md',{subject:'owner',attribute:'hobbies',value:'fictional go',valid_from:'2026-09-01'});
    service.index.rebuild();
    const now=await call('get_claims',{subject_type:'self',attribute:'lives-in'});
    assert.deepEqual(now.claims.map(c=>c.value),['Fictional New Town'],'asked by its fixed name, the newest value under any name');
    assert.equal(now.claims[0].two_answers,undefined);
    const all=await call('get_claims',{subject_type:'self',attribute:'location',mode:'history'});
    assert.deepEqual(all.claims.map(c=>c.value).sort(),['Fictional Middle Town','Fictional New Town','Fictional Old Town'],'asked by an old name, every value it ever had');
    file('owner--app-usage--2026-09-01.md',{subject:'owner',attribute:'app-usage',value:'fictional dating app',valid_from:'2026-09-01'});
    fs.writeFileSync(path.join(world,'fields.json'),JSON.stringify({fields:[
      {name:'lives-in',one:true,aliases:['location','current-city','city']},{name:'age',one:true,aliases:['age']},
      {name:'hobbies',one:false,aliases:['hobby']}]}));
    file('owner--age--2026-09-11.md',{subject:'owner',attribute:'age',value:'55',valid_from:'2026-09-11'});
    assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'age'})).claims.map(c=>c.value),['55'],'a listed kind is found by its names only, not inside app-usage');
    const hobbies=await call('get_claims',{subject_type:'self',attribute:'hobbies'});
    assert.deepEqual(hobbies.claims.map(c=>c.value).sort(),['fictional chess','fictional go'],'a many-at-a-time fact keeps every value');
    service.store.save('claims',{subject_type:'self',attribute:'location',value:'Fictional Other Town',confidence:'likely',valid_from:'2026-09-30'});
    const tie=await call('get_claims',{subject_type:'self',attribute:'lives-in'});
    assert.deepEqual(tie.claims.map(c=>c.value).sort(),['Fictional New Town','Fictional Other Town'],'two values the same day both stay');
    assert.ok(tie.claims.every(c=>c.two_answers?.length===2),'and are shown as two answers');
  }finally{await service.close();}
});

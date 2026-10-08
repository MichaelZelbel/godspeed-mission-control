import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {linkTargets} from '../core/graph.mjs';

// The note graph is worked out from the notes when asked: their [[links]],
// their closest notes and the people they name (8 October 2026). Until then
// the screen said "not available" and a note's Local graph showed an error.
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-graph-'))),query=new QueryService(store),domains=new Domains(query);
  store.save('user_self_aliases',{alias:'Fictional Owner',is_active:true});
  const ana=store.save('contacts',{name:'Fictional Ana',aliases:['Ana F']}),ben=store.save('contacts',{name:'Fictional Ben'});
  store.save('contacts',{name:'Sam Twin'});store.save('contacts',{name:'Sam Other',aliases:['Sam Twin']});
  const plan=store.save('notes',{title:'Knee rehabilitation plan',content:'Fictional Owner talked with Fictional Ana about knee rehabilitation. See [[Physiotherapy exercises for the knee|the exercises]] and [[Fictional Ben]]. Sam Twin was there.',metadata:{type:'project',topics:['health']}});
  const exercises=store.save('notes',{title:'Physiotherapy exercises for the knee',content:'Knee rehabilitation: physiotherapy exercises three times a week with Fictional Ana.'});
  const diary=store.save('notes',{title:'Diary',content:'Back to [[knee rehabilitation plan#Week 2]]. [[Nothing by this name]]. [[{"node": "Config"}]]'});
  const groceries=store.save('notes',{title:'Groceries',content:'milk and bread'});
  const log=store.save('notes',{title:'Exercise log',content:'Physiotherapy exercises for the knee rehabilitation, done twice today.'});
  const hidden=store.save('notes',{title:'Private knee worries',content:'knee rehabilitation physiotherapy worries [[Diary]]',ai_visibility:'hidden'});
  const trashed=store.save('notes',{title:'Old knee note',content:'knee rehabilitation physiotherapy',is_trashed:true});
  const mirrored=store.save('notes',{title:'mc-knee-observation',content:'knee rehabilitation physiotherapy exercises',source_app:'godspeed'});
  return {store,query,domains,ana,ben,plan,exercises,diary,groceries,log,hidden,trashed,mirrored};};
const edge=(graph,type,a,b)=>graph.edges.some(e=>e.type===type&&(e.source===a&&e.target===b||e.source===b&&e.target===a));

test('a [[link]] names its target; shown words, headings and code in brackets do not',()=>{
  assert.deepEqual(linkTargets('[[A]] [[B|shown]] [[C#part]] [[A]] [[{"node": 1}]] [[x<y]]'),['A','B','C']);
});

test('the whole graph: links, closest notes and the people several notes name, without hidden, trashed or mirrored notes',async()=>{
  for(const withIndex of [false,true]){
    const s=setup();let index=null;if(withIndex){index=new SearchIndex(s.store);s.domains.index=index;}
    try{
      const graph=await s.domains.invoke('get-graph-data',{limit:200});
      const ids=new Set(graph.nodes.map(n=>n.id));
      for(const n of [s.plan,s.exercises,s.diary,s.groceries])assert.ok(ids.has(n.id),n.title+' is drawn');
      for(const n of [s.hidden,s.trashed,s.mirrored])assert.ok(!ids.has(n.id),n.title+' is left out');
      assert.ok(edge(graph,'manual_link',s.plan.id,s.exercises.id),'a link with shown words');
      assert.ok(edge(graph,'manual_link',s.diary.id,s.plan.id),'a link to a heading, matched without regard to case');
      assert.ok(edge(graph,'manual_link',s.plan.id,'contact:'+s.ben.id),'a link to a person by name');
      assert.ok(!edge(graph,'semantic',s.plan.id,s.exercises.id),'no related edge beside a link');
      assert.ok(edge(graph,'semantic',s.log.id,s.exercises.id),'two unlinked notes with the same telling words are similar');
      assert.ok(!graph.edges.some(e=>e.type==='semantic'&&(e.source===s.groceries.id||e.target===s.groceries.id)),'an unrelated note has no similar notes');
      assert.ok(edge(graph,'mentions_person',s.exercises.id,'contact:'+s.ana.id)&&edge(graph,'mentions_person',s.plan.id,'contact:'+s.ana.id),'two notes name Ana ('+(withIndex?'index':'no index')+')');
      assert.ok(!graph.nodes.some(n=>n.title==='Fictional Owner'),'never the owner');
      assert.ok(!graph.nodes.some(n=>/^Sam /.test(n.title)),'a name two people share names neither');
      const person=graph.nodes.find(n=>n.id==='contact:'+s.ana.id);assert.equal(person.type,'person_note');assert.equal(person.title,'Fictional Ana');
      assert.equal(graph.nodes.find(n=>n.id===s.plan.id).type,'project');assert.deepEqual(graph.nodes.find(n=>n.id===s.plan.id).topics,['health']);
      for(const e of graph.edges){assert.ok(ids.has(e.source)&&ids.has(e.target),'every edge joins drawn nodes');assert.ok(e.strength>0&&e.strength<=1);}
      const all=await s.domains.invoke('get-graph-data',{limit:200,include_hidden:true,include_godspeed:true});
      assert.ok(all.nodes.some(n=>n.id===s.hidden.id)&&all.nodes.some(n=>n.id===s.mirrored.id),'asked for, hidden and mirrored notes are drawn');
      assert.ok(!all.nodes.some(n=>n.id===s.trashed.id),'a trashed note never');
      const one=await s.domains.invoke('get-graph-data',{limit:1});
      assert.deepEqual(one.nodes.filter(n=>!n.id.startsWith('contact:')).map(n=>n.id),[s.plan.id],'the most linked note comes first');
    }finally{index?.close();}
  }
});

test('a note\'s neighbourhood: what it links, what links it, its closest notes and the people it names',async()=>{
  const s=setup(),index=new SearchIndex(s.store);s.domains.index=index;
  try{
    const graph=await s.domains.invoke('get-graph-data',{note_id:s.exercises.id,hops:2});
    const ids=new Set(graph.nodes.map(n=>n.id));
    assert.ok(ids.has(s.exercises.id)&&ids.has(s.plan.id),'the note and the note linking it');
    assert.ok(ids.has(s.diary.id),'a second step reaches the note linking that one');
    assert.ok(ids.has('contact:'+s.ana.id),'the person this note names');
    assert.ok(!ids.has(s.groceries.id),'an unrelated note stays out');
    const hidden=await s.domains.invoke('get-graph-data',{note_id:s.hidden.id,hops:1});
    assert.ok(hidden.nodes.some(n=>n.id===s.diary.id),'a note hidden from the assistant still shows its own links to its owner');
    await assert.rejects(s.domains.invoke('get-graph-data',{note_id:s.trashed.id}),/not available for the graph/);
  }finally{index.close();}
});

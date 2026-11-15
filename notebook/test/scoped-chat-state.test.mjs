import test from 'node:test';
import assert from 'node:assert/strict';
import {readScopedChat,updateScopedChat,persistScopedChat} from '../ui/src/local/scoped-chat-state.mjs';

test('navigation cannot copy a person conversation into existing general history before hydration',()=>{
 const person={messages:[{role:'user',content:'Fictional person-only question'}]},general={messages:[{role:'user',content:'Separate general question'}]};
 const saved=new Map([['owner|person:fictional',person],['owner|general',general]]);
 let binding={key:'owner|person:fictional',state:person};
 const newKey='owner|general',load=()=>saved.get(newKey);
 assert.deepEqual(readScopedChat(binding,newKey,load),general);
 assert.equal(persistScopedChat(binding,newKey,state=>saved.set(newKey,state)),false);
 assert.deepEqual(saved.get(newKey),general);
 binding=updateScopedChat(binding,newKey,load(),load);
 assert.equal(persistScopedChat(binding,newKey,state=>saved.set(newKey,state)),true);
 binding=updateScopedChat(binding,newKey,previous=>({...previous,messages:[...previous.messages,{role:'assistant',content:'General reply'}]}),load);
 persistScopedChat(binding,newKey,state=>saved.set(newKey,state));
 assert.equal(saved.get(newKey).messages.length,2);assert.deepEqual(saved.get('owner|person:fictional'),person);
});
test('an open-panel hydration or summary update uses its own context rather than an old binding',()=>{
 const old={key:'owner|note:old',state:{messages:[{content:'Old note question'}],summary:'Old note'}};
 const selected={messages:[{content:'New note question'}],summary:''};
 const binding=updateScopedChat(old,'owner|note:new',previous=>({...previous,summary:'New note summary'}),()=>selected);
 assert.deepEqual(binding.state.messages,selected.messages);assert.equal(binding.state.summary,'New note summary');
 assert.equal(old.state.summary,'Old note');
 assert.equal(persistScopedChat(binding,'other-user|note:new',()=>assert.fail('Cross-user save')),false);
});

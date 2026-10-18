import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {validateConversationOperations} from '../core/personal-operations.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-negation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root);return new Domains(new QueryService(store));};
const refused=(domains,message,operation)=>{try{validateConversationOperations(domains,{message},[{...operation,source_quote:operation.source_quote}]);return false;}catch(error){return error.code==='UNAUTHORIZED_OPERATION';}};

// A change runs only when the person asked for it. The check for a refusal
// knew a few verbs (remember, save, add...), so "Don't remind me", "Do not
// complete" and "Please don't pause" were taken as requests to do exactly
// that (7 October 2026). A refusal of the very thing an operation does now
// stops it, in English and in German.
test('a request that says not to do something never authorises doing it',t=>{
  const domains=fixture(t);
  for(const [message,operation] of [
    ['Don\'t remind me to call Anna tomorrow',{type:'obligation-add',title:'Call Anna',source_quote:'remind me to call Anna tomorrow'}],
    ['Do not complete the tax return yet',{type:'obligation-complete',id:'tax',source_quote:'complete the tax return'}],
    ['Please don\'t pause my morning brief',{type:'routine-change',id:'brief',source_quote:'pause my morning brief'}],
    ['Never snooze the dentist reminder',{type:'obligation-snooze',id:'dentist',source_quote:'snooze the dentist reminder'}],
    ['Don\'t start a coaching talk now',{type:'coach-open',source_quote:'start a coaching talk now'}],
    ['Erinnere mich nicht an den Zahnarzt',{type:'obligation-add',title:'Zahnarzt',source_quote:'Erinnere mich'}],
  ])assert.ok(refused(domains,message,operation),message);
});

// A refusal of something else in the same message is no refusal of this.
test('an unrelated "never" does not stop what was asked',t=>{
  const domains=fixture(t);
  assert.equal(refused(domains,'I never finish on time, so remind me to call Anna tomorrow at 9',{type:'obligation-add',title:'Call Anna',source_quote:'remind me to call Anna tomorrow at 9'}),false);
  assert.equal(refused(domains,"Don't forget to remind me to call Anna tomorrow at 9",{type:'obligation-add',title:'Call Anna',source_quote:'remind me to call Anna tomorrow at 9'}),false);
  assert.equal(refused(domains,'Notiere: Kopfheben heute nicht geschafft',{type:'habit-observe',id:'h1',answer:'no',source_quote:'Notiere'}),false);
});

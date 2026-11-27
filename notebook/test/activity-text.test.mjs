import test from 'node:test';import assert from 'node:assert/strict';
import {formatAction} from '../ui/src/lib/activity-text.mjs';
test('activity rows read as English',()=>{
  assert.equal(formatAction('create','action'),'Created an action');assert.equal(formatAction('create','event'),'Created an event');
  assert.equal(formatAction('update','note'),'Updated a note');assert.equal(formatAction('delete','world entity'),'Deleted a world entity');
});
test('activity rows name the record when it has a name',()=>{
  assert.equal(formatAction('create','profile category',undefined,'Hobbies'),'Created a profile category: Hobbies');
  assert.equal(formatAction('update','note',undefined,' Plan '),'Updated a note: Plan');
  assert.equal(formatAction('delete','note',undefined,'Plan'),'Deleted a note: Plan');
  for(const none of [undefined,null,'','  '])assert.equal(formatAction('create','note',undefined,none),'Created a note');
  assert.equal(formatAction('create','person',{}, 'Anna Lindqvist'),'Created a person: Anna Lindqvist');
  assert.equal(formatAction('update','note',{},'  '),'Updated a note');
  assert.equal(formatAction('update','note',{change:'trash'},'X'),'Moved a note to the trash: X');
  assert.equal(formatAction('update','note',{change:'restore'},'X'),'Restored a note: X');
  assert.equal(formatAction('update','person',{previous_name:'Anna Lindqvist'},'Anna Berg'),'Updated a person: Anna Berg (was Anna Lindqvist)');
  assert.equal(formatAction('delete','moment',{},'Dinner'),'Deleted a moment: Dinner');
});

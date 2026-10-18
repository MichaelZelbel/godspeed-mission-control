import test from 'node:test';import assert from 'node:assert/strict';
import {formatAction} from '../ui/src/lib/activity-text.mjs';
test('activity rows read as English',()=>{
  assert.equal(formatAction('create','action'),'Created an action');assert.equal(formatAction('create','event'),'Created an event');
  assert.equal(formatAction('update','note'),'Updated a note');assert.equal(formatAction('delete','world entity'),'Deleted a world entity');
});

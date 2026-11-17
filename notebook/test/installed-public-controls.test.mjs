import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(new URL(file,import.meta.url),'utf8');

// port-ui.py reapplies the adapter tree after importing the UI. A control present only in
// ui/src is therefore not necessarily present in the clean-installed frontend.
test('the installed Settings adapter exposes the public AI service selector',()=>{
  const settings=read('../adapters/src/local/Control.tsx');
  assert.match(settings,/import ConnectAI from '@\/local\/ConnectAI'/);
  assert.match(settings,/<section id="connect-ai"[^>]*><ConnectAI\/><\/section>/);
  assert.doesNotMatch(settings,/>Model endpoint</);
});

test('the installed Timeline source exposes Add Moment and its People control',()=>{
  const timeline=read('../ui/src/pages/TimelinePage.tsx');
  const dialog=read('../ui/src/components/timeline/AddEventDialog.tsx');
  assert.match(timeline,/<AddEventDialog people=\{people\} onCreated=\{fetchData\} \/>/);
  assert.match(dialog,/> Add Moment<\/Button>/);
  assert.match(dialog,/<Label className="text-xs">People<\/Label><PeopleMultiSelect/);
});

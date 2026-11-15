// The sentence that tells a person to tick a box in Settings must name the box as Settings labels it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NO_MODEL_IN_HOME} from '../core/native-agent.mjs';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');

function boxLabel(){
 const tsx=fs.readFileSync(path.join(root,'ui/src/local/ConnectAI.tsx'),'utf8');
 const line=tsx.split('\n').find(l=>l.includes('useForRoutines')&&l.includes('<span>'));
 assert.ok(line,'the checkbox label was not found in ConnectAI.tsx');
 return line.split('<span>')[1].split('{')[0].trim();
}

test('NO_MODEL_IN_HOME quotes the Settings box by the label ConnectAI.tsx shows',()=>{
 const label=boxLabel();
 assert.ok(label.length>0);
 const quoted=(NO_MODEL_IN_HOME.match(/"([^"]+)"/)||[])[1];
 assert.ok(quoted,'the sentence quotes no box name');
 assert.equal(quoted,label);
});

test('nothing in core or ui/src quotes the box by its old name',()=>{
 const hits=[];
 const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
  if(e.name==='node_modules')continue;
  const p=path.join(d,e.name);
  if(e.isDirectory())walk(p);
  else if(fs.readFileSync(p,'utf8').includes('Use it for the routines too'))hits.push(p);
 }};
 walk(path.join(root,'core'));walk(path.join(root,'ui/src'));
 assert.deepEqual(hits,[]);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createService} from '../server/main.mjs';
import {transcribeRecording} from '../core/dictation.mjs';

test('dictation rejects unsupported, empty and oversized recordings before starting Hermes',async()=>{
  await assert.rejects(transcribeRecording(null,'',Buffer.from('x'),'text/plain'),/format/);
  await assert.rejects(transcribeRecording(null,'',Buffer.alloc(0),'audio/webm'),/one minute/);
  await assert.rejects(transcribeRecording(null,'',Buffer.alloc(8*1024*1024+1),'audio/webm'),/one minute/);
  await assert.rejects(transcribeRecording(null,'',Buffer.from('x'),'audio/webm;codecs=opus'),/Connect Hermes/);
});
test('dictation follows a native wrapper descriptor to its source venv',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-dictation-wrapper-')),source=path.join(root,'opt','hermes-src'),executable=path.join(root,'.godspeed','native-hermes','hermes'),python=process.platform==='win32'?path.join(source,'venv','Scripts','python.exe'):path.join(source,'venv','bin','python3');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.dirname(python),{recursive:true});fs.mkdirSync(path.dirname(executable),{recursive:true});fs.mkdirSync(path.join(source,'hermes_cli'),{recursive:true});fs.writeFileSync(python,'');fs.writeFileSync(executable,'');fs.writeFileSync(path.join(source,'hermes_cli','__init__.py'),'');
  let started;
  const spawnProcess=(command,args,options)=>{
    started={command,args,options};const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    setImmediate(()=>{child.stdout.end('{"ok":true,"text":"recorded"}\n');child.emit('close',0);});return child;
  };
  assert.deepEqual(await transcribeRecording({verified:true,executable,sourceRoot:source,home:path.join(root,'home')},root,Buffer.from('audio'),'audio/webm',{spawnProcess}),{ok:true,text:'recorded'});
  assert.equal(started.command,python);assert.equal(started.options.cwd,source);
});
test('dictation endpoint refuses cross-site audio and recovers after an invalid recording',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-dictation-test-'));
  const service=await createService({root,port:0,provider:async()=>''});
  const url='http://127.0.0.1:'+service.address.port+'/api/chat/transcribe';
  try{
    const denied=await fetch(url,{method:'POST',headers:{Origin:'https://other.example','Content-Type':'audio/webm'},body:'audio'});
    assert.equal(denied.status,403);
    for(let i=0;i<2;i++){
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:'audio'});
      assert.equal(response.status,400);assert.match((await response.json()).error,/format/);
    }
  }finally{await service.close();}
});

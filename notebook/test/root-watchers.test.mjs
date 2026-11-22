import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';

const BOUND=5000;
const until=async(check,ms=BOUND)=>{const end=Date.now()+ms;for(;;){const value=check();if(value||Date.now()>end)return value;await new Promise(r=>setTimeout(r,50));}};
const write=(root,relative,word)=>{fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.writeFileSync(path.join(root,relative),'# '+word+'\n\n'+word+' body\n');};
const found=(service,word)=>{try{return service.index.search(word).length>0;}catch{return false;}};
const workspace=async(prepare=()=>{})=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-root-watchers-')),root=path.join(tmp,'ws');
  fs.mkdirSync(path.join(root,'work'),{recursive:true});prepare(root);
  const service=await createService({root,port:0,token:'t'});
  await service.index.initialPublication;
  return {tmp,root,service,done:async()=>{try{fs.chmodSync(path.join(root,'goals'),0o755);}catch{}await service.close();fs.rmSync(tmp,{recursive:true,force:true});}};
};
const captured=()=>{const lines=[],original=console.error;console.error=(...args)=>lines.push(args.join(' '));return {lines,restore:()=>{console.error=original;}};};

test('after the workspace folder is replaced, a note written into the new folder is found within 5 s, and so is a second',async()=>{
  const {tmp,root,service,done}=await workspace();
  try{
    fs.renameSync(root,root+'.old');fs.mkdirSync(path.join(root,'work'),{recursive:true});
    write(root,'work/a.md','zebraalpha');
    assert.equal(await until(()=>found(service,'zebraalpha')),true,'the first note is found');
    write(root,'work/b.md','zebrabeta');
    assert.equal(await until(()=>found(service,'zebrabeta')),true,'the second note is found');
  }finally{await done();}
});

test('durable folders created after start are watched, at the top and under routines/',async()=>{
  const {root,service,done}=await workspace();
  try{
    write(root,'due/a.md','lateone');
    assert.equal(await until(()=>found(service,'lateone')),true,'a top-level folder');
    write(root,'routines/headache/a.md','nestedone');
    assert.equal(await until(()=>found(service,'nestedone')),true,'a nested folder');
    write(root,'routines/headache/b.md','nestedtwo');
    assert.equal(await until(()=>found(service,'nestedtwo')),true,'a note written into it afterwards');
  }finally{await done();}
});

test('an unreadable root does not stop the others: they are indexed within 5 s and the folder is named once per change of state',{skip:process.getuid?.()===0||process.platform==='win32'},async()=>{
  const log=captured();
  const {root,service,done}=await workspace(r=>{fs.mkdirSync(path.join(r,'goals'));fs.writeFileSync(path.join(r,'goals','x.md'),'x');});
  try{
    fs.chmodSync(path.join(root,'goals'),0);
    write(root,'work/ok.md','readableone');
    assert.equal(await until(()=>found(service,'readableone')),true,'a note in a readable root is found');
    await service.index.rebuildBackground();await service.index.rebuildBackground();
    assert.equal(log.lines.filter(line=>line.includes('cannot read goals')).length,1,'named once, not once per rebuild');
    fs.chmodSync(path.join(root,'goals'),0o755);
    await service.index.rebuildBackground();
    assert.equal(log.lines.filter(line=>line.includes('can read goals again')).length,1);
  }finally{log.restore();await done();}
});

test('a root unreadable at start does not stop the notebook: it starts, names the folder and indexes the others',{skip:process.getuid?.()===0||process.platform==='win32'},async()=>{
  const log=captured();
  let dir;
  const prepare=r=>{dir=path.join(r,'goals');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'x.md'),'x');fs.chmodSync(dir,0);write(r,'work/ok.md','startone');};
  const {service,done}=await workspace(prepare);
  try{
    assert.equal(found(service,'startone'),true);
    assert.equal(log.lines.filter(line=>line.includes('cannot read goals')).length,1);
  }finally{log.restore();await done();}
});

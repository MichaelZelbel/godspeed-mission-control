import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {watchTree} from '../core/watch-tree.mjs';

const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-watch-tree-'));
const until=async(check,ms=5000)=>{const end=Date.now()+ms;for(;;){const value=check();if(value||Date.now()>end)return value;await new Promise(r=>setTimeout(r,25));}};
const record=events=>(event,name)=>{if(name!=null)events.push(String(name).replaceAll('\\','/'));};

test('a folder that arrives while watching is watched: its arrival and a later write inside it are reported',async()=>{
  const dir=root(),events=[];
  const watcher=watchTree(dir,record(events));
  try{
    fs.mkdirSync(path.join(dir,'Arrived'));
    assert.equal(await until(()=>events.includes('Arrived')),true,'the folder\'s arrival is reported');
    events.length=0;
    fs.writeFileSync(path.join(dir,'Arrived','note.md'),'# hello\n');
    assert.equal(await until(()=>events.includes('Arrived/note.md')),true,'a write inside the arrived folder is reported');
  }finally{watcher.close();}
});

test('a folder removed and remade while watching is watched again: a write inside the remade folder is reported',async()=>{
  const dir=root(),events=[];
  const watcher=watchTree(dir,record(events));
  try{
    fs.mkdirSync(path.join(dir,'Remade'));
    assert.equal(await until(()=>events.includes('Remade')),true,'the folder is watched before it is replaced');
    events.length=0;
    fs.rmSync(path.join(dir,'Remade'),{recursive:true});
    fs.mkdirSync(path.join(dir,'Remade'));
    fs.writeFileSync(path.join(dir,'Remade','note.md'),'# hello\n');
    assert.equal(await until(()=>events.includes('Remade/note.md')),true,'a write inside the remade folder is reported');
  }finally{watcher.close();}
});

test('a folder that cannot be watched is skipped: the rest of the tree keeps watching and no error is reported',{skip:process.platform==='darwin'||process.platform==='win32'||process.getuid?.()===0},async()=>{
  const dir=root(),events=[],errors=[];
  fs.mkdirSync(path.join(dir,'Locked'),0o000);
  fs.mkdirSync(path.join(dir,'Open'));
  const watcher=watchTree(dir,record(events));
  try {
    watcher.on('error',error=>errors.push(error.code));
    fs.writeFileSync(path.join(dir,'Open','note.md'),'# hello\n');
    assert.equal(await until(()=>events.includes('Open/note.md')),true,'the rest of the tree keeps watching');
    fs.writeFileSync(path.join(dir,'note.md'),'# root\n');
    assert.equal(await until(()=>events.includes('note.md')),true,'the root itself keeps watching');
    assert.deepEqual(errors,[],'the locked folder does not fail the tree');
  } finally { watcher.close(); fs.chmodSync(path.join(dir,'Locked'),0o700); }
});

test('a folder replaced by rename over itself is watched again: a write inside it is reported',async()=>{
  const dir=root(),events=[];
  const watcher=watchTree(dir,record(events));
  try{
    fs.mkdirSync(path.join(dir,'Swapped'));
    assert.equal(await until(()=>events.includes('Swapped')),true,'the folder is watched before it is replaced');
    events.length=0;
    fs.mkdirSync(path.join(dir,'Fresh'));
    fs.renameSync(path.join(dir,'Fresh'),path.join(dir,'Swapped'));
    fs.writeFileSync(path.join(dir,'Swapped','note.md'),'# hello\n');
    assert.equal(await until(()=>events.includes('Swapped/note.md')),true,'a write inside the replaced folder is reported');
  }finally{watcher.close();}
});

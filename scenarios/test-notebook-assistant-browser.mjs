import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const here=path.dirname(new URL(import.meta.url).pathname);

test('a fixture bind failure stops the browser it started',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-assistant-cleanup-'));
  const evidence=path.join(folder,'evidence');
  const fakeChrome=path.join(folder,'fake-chromium');
  fs.writeFileSync(fakeChrome,'#!/usr/bin/env node\nsetInterval(()=>{},1000);\n');
  fs.chmodSync(fakeChrome,0o755);
  const occupied=http.createServer();
  await new Promise((resolve,reject)=>occupied.once('error',reject).listen(48763,'127.0.0.1',resolve));
  try{
    const child=spawn(process.execPath,[path.join(here,'notebook-assistant-browser.mjs'),'--base','http://127.0.0.1:1','--evidence',evidence],{
      env:{...process.env,CHROME_PATH:fakeChrome},stdio:['ignore','ignore','pipe']
    });
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.notEqual(code,0);
    const browserPid=Number(fs.readFileSync(path.join(evidence,'browser.pid'),'utf8'));
    assert.throws(()=>process.kill(browserPid,0),error=>error?.code==='ESRCH');
    assert.equal(fs.existsSync(path.join(evidence,'cleanup.txt')),true,stderr);
    assert.equal(fs.readFileSync(path.join(evidence,'cleanup.txt'),'utf8'),'browser=stopped\nfixture=stopped\n');
  } finally {
    await new Promise(resolve=>occupied.close(resolve));
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const here=path.dirname(new URL(import.meta.url).pathname);

test('a missing browser is retained as one contained failure',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-assistant-no-browser-'));
  const evidence=path.join(folder,'evidence');
  try{
    const child=spawn(process.execPath,[path.join(here,'notebook-assistant-browser.mjs'),'--base','http://127.0.0.1:1','--evidence',evidence],{
      env:{...process.env,CHROME_PATH:path.join(folder,'not-installed')},stdio:['ignore','ignore','pipe']
    });
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.notEqual(code,0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(evidence,'failure.json'),'utf8')),{
      phase:'',message:'Chromium is not installed at a documented executable name; set CHROME_PATH'
    });
    assert.equal(fs.readFileSync(path.join(evidence,'cleanup.txt'),'utf8'),'browser=stopped\nfixture=stopped\n');
    assert.equal(stderr,'FAIL notebook-assistant-browser: Chromium is not installed at a documented executable name; set CHROME_PATH\n');
    assert.doesNotMatch(stderr,/notebook-assistant-browser\.mjs:\d+|\n\s+at /);
  } finally {
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

test('a fixture bind failure stops the browser it started',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-assistant-cleanup-'));
  const evidence=path.join(folder,'evidence');
  const fakeChrome=path.join(folder,'fake-chromium');
  const ready=path.join(folder,'browser-ready');
  const term=path.join(folder,'browser-got-term');
  fs.writeFileSync(fakeChrome,`#!/usr/bin/env node\nimport fs from 'node:fs';\nprocess.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(term)},'yes\\n'));\nfs.writeFileSync(${JSON.stringify(ready)},'yes\\n');\nsetInterval(()=>{},1000);\n`);
  fs.chmodSync(fakeChrome,0o755);
  const occupied=http.createServer();
  await new Promise((resolve,reject)=>occupied.once('error',reject).listen(48763,'127.0.0.1',resolve));
  try{
    const child=spawn(process.execPath,[path.join(here,'notebook-assistant-browser.mjs'),'--base','http://127.0.0.1:1','--evidence',evidence],{
      env:{...process.env,CHROME_PATH:fakeChrome,BROWSER_TEST_READY_FILE:ready},stdio:['ignore','ignore','pipe']
    });
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.notEqual(code,0);
    const browserPid=Number(fs.readFileSync(path.join(evidence,'browser.pid'),'utf8'));
    assert.equal(fs.readFileSync(term,'utf8'),'yes\n');
    assert.throws(()=>process.kill(browserPid,0),error=>error?.code==='ESRCH');
    assert.equal(fs.existsSync(path.join(evidence,'cleanup.txt')),true,stderr);
    assert.equal(fs.readFileSync(path.join(evidence,'cleanup.txt'),'utf8'),'browser=stopped\nfixture=stopped\n');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(evidence,'failure.json'),'utf8')),{
      phase:'',message:'listen EADDRINUSE: address already in use 127.0.0.1:48763'
    });
    assert.match(stderr,/^FAIL notebook-assistant-browser: listen EADDRINUSE:/);
    assert.doesNotMatch(stderr,/notebook-assistant-browser\.mjs:\d+|\n\s+at /);
  } finally {
    await new Promise(resolve=>occupied.close(resolve));
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

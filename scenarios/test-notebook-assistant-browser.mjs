import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const here=path.dirname(new URL(import.meta.url).pathname);

test('the maintained route accepts browser-runner Chrome executable variables',()=>{
  const source=fs.readFileSync(path.join(here,'notebook-assistant-browser.mjs'),'utf8');
  assert.match(source,/process\.env\.CHROME_BIN/);
  assert.match(source,/process\.env\.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH/);
  assert.match(source,/\/usr\/bin\/google-chrome-stable/);
  assert.match(source,/\/opt\/google\/chrome\/chrome/);
});

test('a fixture bind failure stops the browser it started',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-assistant-cleanup-'));
  const evidence=path.join(folder,'evidence');
  const fakeChrome=path.join(folder,'fake-chromium');
  const ready=path.join(folder,'browser-ready');
  const term=path.join(folder,'browser-got-term');
  const descendantPidFile=path.join(folder,'descendant.pid');
  fs.writeFileSync(fakeChrome,`#!/usr/bin/env node\nimport fs from 'node:fs';\nimport {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});\nfs.writeFileSync(${JSON.stringify(descendantPidFile)},String(child.pid)+'\\n');\nprocess.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(term)},'yes\\n'));\nfs.writeFileSync(${JSON.stringify(ready)},'yes\\n');\nsetInterval(()=>{},1000);\n`);
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
    const descendantPid=Number(fs.readFileSync(descendantPidFile,'utf8'));
    assert.equal(fs.readFileSync(term,'utf8'),'yes\n');
    assert.throws(()=>process.kill(browserPid,0),error=>error?.code==='ESRCH');
    assert.throws(()=>process.kill(descendantPid,0),error=>error?.code==='ESRCH');
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

test('an unexpected browser exit is retained without leaking the process',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-assistant-browser-exit-'));
  const evidence=path.join(folder,'evidence');
  const fakeChrome=path.join(folder,'fake-chromium');
  const ready=path.join(folder,'browser-ready');
  fs.writeFileSync(fakeChrome,`#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(ready)},'yes\\n');\nsetTimeout(()=>process.exit(23),25);\n`);
  fs.chmodSync(fakeChrome,0o755);
  try{
    const child=spawn(process.execPath,[path.join(here,'notebook-assistant-browser.mjs'),'--base','http://127.0.0.1:1','--evidence',evidence],{
      env:{...process.env,CHROME_PATH:fakeChrome,BROWSER_TEST_READY_FILE:ready},stdio:['ignore','ignore','pipe']
    });
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.notEqual(code,0);
    const browserPid=Number(fs.readFileSync(path.join(evidence,'browser.pid'),'utf8'));
    assert.throws(()=>process.kill(browserPid,0),error=>error?.code==='ESRCH');
    const failure=JSON.parse(fs.readFileSync(path.join(evidence,'failure.json'),'utf8'));
    assert.equal(typeof failure.phase,'string');
    assert.equal(failure.message,'Chromium exited before exposing its debugging page');
    assert.equal(stderr.trim().split('\n').length,1);
    assert.equal(stderr.trim(),'FAIL notebook-assistant-browser: Chromium exited before exposing its debugging page');
    assert.doesNotMatch(stderr,/notebook-assistant-browser\.mjs:\d+|\n\s+at /);
    assert.equal(fs.readFileSync(path.join(evidence,'cleanup.txt'),'utf8'),'browser=stopped\nfixture=stopped\n');
  } finally {
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

test('an unavailable service-control executable is contained after startup',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-assistant-service-control-'));
  const evidence=path.join(folder,'evidence'),fakeChrome=path.join(folder,'fake-chromium'),ready=path.join(folder,'ready');
  fs.writeFileSync(fakeChrome,`#!/usr/bin/env node\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(ready)},'yes\\n');setInterval(()=>{},1000);\n`);
  fs.chmodSync(fakeChrome,0o755);
  try{
    const child=spawn(process.execPath,[path.join(here,'notebook-assistant-browser.mjs'),'--base','http://127.0.0.1:1','--evidence',evidence],{env:{...process.env,CHROME_PATH:fakeChrome,BROWSER_TEST_READY_FILE:ready,BROWSER_TEST_SERVICE_CONTROL:path.join(folder,'missing-systemctl')},stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.notEqual(code,0);
    assert.match(JSON.parse(fs.readFileSync(path.join(evidence,'failure.json'),'utf8')).message,/ENOENT/);
    assert.equal(fs.readFileSync(path.join(evidence,'cleanup.txt'),'utf8'),'browser=stopped\nfixture=stopped\n');
    assert.throws(()=>process.kill(Number(fs.readFileSync(path.join(evidence,'browser.pid'),'utf8')),0),error=>error?.code==='ESRCH');
    assert.equal(stderr.trim().split('\n').length,1);
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});

test('a partial debugging response body is bounded and cleaned up',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-assistant-debug-timeout-'));
  const evidence=path.join(folder,'evidence'),fakeChrome=path.join(folder,'fake-chromium'),ready=path.join(folder,'ready');
  fs.writeFileSync(fakeChrome,`#!/usr/bin/env node\nimport fs from 'node:fs';import http from 'node:http';const server=http.createServer((request,response)=>{response.writeHead(200,{'content-type':'application/json'});response.write('[');});server.listen(48764,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(ready)},'yes\\n'));setInterval(()=>{},1000);\n`);
  fs.chmodSync(fakeChrome,0o755);
  try{
    const child=spawn(process.execPath,[path.join(here,'notebook-assistant-browser.mjs'),'--base','http://127.0.0.1:1','--evidence',evidence],{env:{...process.env,CHROME_PATH:fakeChrome,BROWSER_TEST_READY_FILE:ready,BROWSER_TEST_TIMEOUT_MS:'250'},stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.notEqual(code,0);
    assert.match(JSON.parse(fs.readFileSync(path.join(evidence,'failure.json'),'utf8')).message,/debugging-page request did not finish/);
    assert.equal(fs.readFileSync(path.join(evidence,'cleanup.txt'),'utf8'),'browser=stopped\nfixture=stopped\n');
    assert.throws(()=>process.kill(Number(fs.readFileSync(path.join(evidence,'browser.pid'),'utf8')),0),error=>error?.code==='ESRCH');
    assert.equal(stderr.trim().split('\n').length,1);
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});

test('an invalid Chromium path retains a concise failure and cleanup evidence',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'notebook-assistant-invalid-chrome-'));
  const evidence=path.join(folder,'evidence');
  try{
    const child=spawn(process.execPath,[path.join(here,'notebook-assistant-browser.mjs'),'--base','http://127.0.0.1:1','--evidence',evidence],{
      env:{...process.env,CHROME_PATH:path.join(folder,'missing-chromium')},stdio:['ignore','ignore','pipe']
    });
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.notEqual(code,0);
    assert.match(JSON.parse(fs.readFileSync(path.join(evidence,'failure.json'),'utf8')).message,/ENOENT/);
    assert.equal(fs.readFileSync(path.join(evidence,'cleanup.txt'),'utf8'),'browser=stopped\nfixture=stopped\n');
    assert.equal(stderr.trim().split('\n').length,1);
    assert.match(stderr,/^FAIL notebook-assistant-browser: spawn .* ENOENT/);
    assert.doesNotMatch(stderr,/notebook-assistant-browser\.mjs:\d+|\n\s+at /);
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});

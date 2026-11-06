import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';

// The image's server-test step (docker/full-candidate/test.sh) shows each failure at the moment it is printed, so a test that
// fails and is followed by a hang still names itself. A stand-in for `docker exec` prints a TAP failure and then hangs.
const bash=process.env.GODSPEED_TEST_BASH||'bash',helper=fileURLToPath(new URL('../../docker/full-candidate/test-progress.sh',import.meta.url)).split(path.sep).join('/');
const run=(producer,log,{limitMs})=>new Promise(resolve=>{
 const started=Date.now(),seen=[];
 // stdout is a pipe here, as it is when CI captures the step.
 const child=spawn(bash,['-c','set -o pipefail; . "$1"; fake_docker_exec() { '+producer+' ; }; fake_docker_exec 2>&1 | server_test_progress "$2"','x',helper,log],{stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{for(const line of chunk.toString().split('\n').filter(Boolean))seen.push({line,at:Date.now()-started});});
 const timer=setTimeout(()=>child.kill('SIGKILL'),limitMs);
 child.on('close',code=>{clearTimeout(timer);resolve({code,seen,ended:Date.now()-started});});
});

test('a failure printed before a hang is shown within a second and stays in the evidence log',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-image-progress-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const log=path.join(dir,'server-tests.log').split(path.sep).join('/');
 // Prints a passing test, a failing one, then hangs; the surrounding timeout (short, test-only) ends it at 4 s.
 const result=await run("timeout 4 sh -c \"echo 'ok 1 - fine'; echo 'not ok 2 - the early failure'; echo '# a comment'; sleep 30\"",log,{limitMs:15000});
 const failure=result.seen.find(s=>/^not ok 2 - the early failure/.test(s.line));
 assert.ok(failure,'the failing test is shown: '+JSON.stringify(result.seen));
 assert.ok(failure.at<2000,'shown at '+failure.at+' ms, long before the hang ended at '+result.ended+' ms');
 assert.ok(result.ended>=3500,'the producer really did hang until its timeout');
 assert.equal(result.seen.some(s=>/^ok 1/.test(s.line)),false,'passing tests are not shown');
 const kept=fs.readFileSync(log,'utf8');
 assert.match(kept,/ok 1 - fine/);assert.match(kept,/not ok 2 - the early failure/);assert.match(kept,/# a comment/,'the whole output is kept, not just the shown lines');
 assert.notEqual(result.code,0,'a timed-out producer fails the pipeline');
});

test('a clean run shows the summary and exits 0',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-image-progress-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const log=path.join(dir,'server-tests.log').split(path.sep).join('/');
 const result=await run("echo 'ok 1 - fine'; echo '# tests 1'; echo '# pass 1'; echo '# fail 0'; echo '# cancelled 0'",log,{limitMs:15000});
 assert.deepEqual(result.seen.map(s=>s.line),['# tests 1','# pass 1','# fail 0','# cancelled 0']);
 assert.equal(result.code,0);
});

test('the failure summary of the fallback shows a non-zero cancelled count, the failures and their error lines, from the kept log',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-image-progress-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const log=path.join(dir,'server-tests.log').split(path.sep).join('/');
 fs.writeFileSync(log,['ok 1 - fine','not ok 2 - test/some.test.mjs','  ---','  error: |-','    expected 1 but got 2','  ...','# tests 3','# pass 1','# fail 1','# cancelled 1',''].join(String.fromCharCode(10)));
 const out=await new Promise(resolve=>{const child=spawn(bash,['-c','. "$1"; server_test_failure_summary "$2"','x',helper,log],{stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',c=>{text+=c;});child.on('close',code=>resolve({text,code}));});
 assert.equal(out.code,0);
 for(const line of ['not ok 2 - test/some.test.mjs','# cancelled 1','# fail 1','# tests 3','error: |-','expected 1 but got 2'])assert.ok(out.text.includes(line),line+' in '+JSON.stringify(out.text));
 assert.ok(!out.text.includes('ok 1 - fine'),'passing tests are not repeated');
 // One selector for both stages: the live stage shows exactly what the fallback selects.
 const live=await run("cat "+log,path.join(dir,'copy.log').split(path.sep).join('/'),{limitMs:15000});
 assert.deepEqual(live.seen.map(s=>s.line),['not ok 2 - test/some.test.mjs','# tests 3','# pass 1','# fail 1','# cancelled 1']);
});

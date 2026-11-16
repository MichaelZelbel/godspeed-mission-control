import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const here=path.dirname(new URL(import.meta.url).pathname);

test('the scenario fixture gives every adopted goal its public card ID',()=>{
  const scenario=fs.readFileSync(path.join(here,'talk-prep-honest.sh'),'utf8');
  for(const id of ['lower-ldl','sleep-better','visible-abs']){
    assert.match(scenario,new RegExp(`printf 'ID: ${id}\\\\nGOAL: ${id}\\\\n`));
  }
  assert.match(scenario,/SERVES: lower-ldl, sleep-better, visible-abs/);
  assert.match(scenario,/write_area\n  run_installed_preparation\n[\s\S]*write_area\n  add_research_domains/);
  assert.doesNotMatch(scenario,/write_installed_fixture_area|TALK_PREP_SUPPORTED_FIXTURE/);
});

const runRoute=async(createFresh,{busyOnce=false,failed=false}={})=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'talk-prep-run-now-'));
  const root=path.join(folder,'root');
  const work=path.join(folder,'work');
  const prep=path.join(root,'coach','health','prep');
  fs.mkdirSync(prep,{recursive:true});
  const old=path.join(prep,'old.md');
  fs.writeFileSync(old,'old preparation\n');
  fs.utimesSync(old,new Date('2020-01-01T00:00:00Z'),new Date('2020-01-01T00:00:00Z'));
  let queried=0,runRequests=0;
  const server=http.createServer((request,response)=>{
    let body='';
    request.on('data',chunk=>body+=chunk);
    request.on('end',()=>{
      response.setHeader('content-type','application/json');
      if(request.url==='/api/query'){
        queried++;
        response.end(JSON.stringify({
          data:[{id:'prep-job',name:'Coaching talk preparation',last_run_at:queried===1?'before':'after',last_status:queried===1?'':failed?'failed':'ok',last_error:failed?'fixture preparation failed':''}],
          count:1,
          error:null
        }));
      }else if(request.url==='/api/jobs/run'){
        assert.deepEqual(JSON.parse(body),{id:'prep-job'});
        runRequests++;
        if(busyOnce&&runRequests===1){
          response.statusCode=400;
          response.end('{"error":"The assistant is updating or another routine is already running."}');
          return;
        }
        if(createFresh){
          const fresh=path.join(prep,'fresh.md');
          fs.writeFileSync(fresh,'fresh preparation\n');
          fs.utimesSync(fresh,new Date('2030-01-01T00:00:00Z'),new Date('2030-01-01T00:00:00Z'));
        }
        if(failed){
          const run=path.join(root,'routines','coach-prep','2030-01-01');
          fs.mkdirSync(run,{recursive:true});
          fs.writeFileSync(path.join(run,'summary.txt'),'health 2030-01-02: fixture review did not pass\n');
        }
        response.statusCode=202;
        response.end('{"started":true}');
      }else{
        response.statusCode=404;
        response.end('{}');
      }
    });
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try{
    const child=spawn('bash',[path.join(here,'talk-prep-honest.sh'),'candidate/test'],{
      env:{...process.env,TALK_PREP_RUN_NOW_TEST_ONLY:'1',GODSPEED_SCENARIO_ROOT:root,GODSPEED_SCENARIO_WORK:work,GODSPEED_PORT:String(port)},
      stdio:['ignore','pipe','pipe']
    });
    let output='';
    child.stdout.on('data',chunk=>output+=chunk);
    child.stderr.on('data',chunk=>output+=chunk);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    return {code,output,evidence:path.join(work,'talk-prep-honest'),folder,runRequests:()=>runRequests};
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
};

test('the public Run now caller refuses stale-only output',async()=>{
  const result=await runRoute(false);
  try{
    assert.notEqual(result.code,0);
    assert.match(result.output,/produced no preparation attributable to that run/);
    assert.equal(fs.existsSync(path.join(result.evidence,'routine-preparation.md')),false);
  }finally{fs.rmSync(result.folder,{recursive:true,force:true});}
});

test('the public Run now caller retains the preparation created by that run',async()=>{
  const result=await runRoute(true);
  try{
    assert.equal(result.code,0,result.output);
    assert.equal(fs.readFileSync(path.join(result.evidence,'routine-preparation.md'),'utf8'),'fresh preparation\n');
    assert.equal(fs.readFileSync(path.join(result.evidence,'routine-preparation-source.txt'),'utf8'),'coach/health/prep/fresh.md\n');
    assert.equal(fs.existsSync(path.join(result.folder,'root','coach','health','prep','fresh.md')),false);
    const jobs=JSON.parse(fs.readFileSync(path.join(result.evidence,'prep-jobs-after.json'),'utf8'));
    assert.deepEqual(jobs,{
      data:[{id:'prep-job',name:'Coaching talk preparation',last_run_at:'after',last_status:'ok',last_error:''}],
      count:1,
      error:null
    });
  }finally{fs.rmSync(result.folder,{recursive:true,force:true});}
});

test('the public Run now caller waits for routine creation to release the installed assistant',async()=>{
  const result=await runRoute(true,{busyOnce:true});
  try{
    assert.equal(result.code,0,result.output);
    assert.equal(result.runRequests(),2);
    assert.match(fs.readFileSync(path.join(result.evidence,'prep-run-requests.txt'),'utf8'),/attempt=1 http=400 .*another routine is already running[\s\S]*attempt=2 http=202 .*"started":true/);
  }finally{fs.rmSync(result.folder,{recursive:true,force:true});}
});

test('a failed installed preparation retains its product-owned summary',async()=>{
  const result=await runRoute(false,{failed:true});
  try{
    assert.notEqual(result.code,0);
    assert.match(result.output,/retained summary: health 2030-01-02: fixture review did not pass/);
    assert.equal(fs.readFileSync(path.join(result.evidence,'prep-run-summary.txt'),'utf8'),'health 2030-01-02: fixture review did not pass\n');
    assert.match(fs.readFileSync(path.join(result.evidence,'prep-run-after.txt'),'utf8'),/status=failed/);
  }finally{fs.rmSync(result.folder,{recursive:true,force:true});}
});

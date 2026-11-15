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
});

const runRoute=async createFresh=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'talk-prep-run-now-'));
  const root=path.join(folder,'root');
  const work=path.join(folder,'work');
  const prep=path.join(root,'coach','health','prep');
  fs.mkdirSync(prep,{recursive:true});
  const old=path.join(prep,'old.md');
  fs.writeFileSync(old,'old preparation\n');
  fs.utimesSync(old,new Date('2020-01-01T00:00:00Z'),new Date('2020-01-01T00:00:00Z'));
  let queried=0;
  const server=http.createServer((request,response)=>{
    let body='';
    request.on('data',chunk=>body+=chunk);
    request.on('end',()=>{
      response.setHeader('content-type','application/json');
      if(request.url==='/api/query'){
        queried++;
        response.end(JSON.stringify({
          data:[{id:'prep-job',name:'Coaching talk preparation',last_run_at:queried===1?'before':'after',last_status:queried===1?'':'ok'}],
          count:1,
          error:null
        }));
      }else if(request.url==='/api/jobs/run'){
        assert.deepEqual(JSON.parse(body),{id:'prep-job'});
        if(createFresh){
          const fresh=path.join(prep,'fresh.md');
          fs.writeFileSync(fresh,'fresh preparation\n');
          fs.utimesSync(fresh,new Date('2030-01-01T00:00:00Z'),new Date('2030-01-01T00:00:00Z'));
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
    return {code,output,evidence:path.join(work,'talk-prep-honest'),folder};
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
    const jobs=JSON.parse(fs.readFileSync(path.join(result.evidence,'prep-jobs-after.json'),'utf8'));
    assert.deepEqual(jobs,{
      data:[{id:'prep-job',name:'Coaching talk preparation',last_run_at:'after',last_status:'ok'}],
      count:1,
      error:null
    });
  }finally{fs.rmSync(result.folder,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {dockerModelArgs,INNER_WORKSPACE} from '../bin/godspeed-docker-model.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-docker-model-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'.godspeed'));fs.writeFileSync(path.join(root,'compose.yaml'),'services:\n  godspeed: {}\n');fs.writeFileSync(path.join(root,'.godspeed','model-host.json'),JSON.stringify({format:1,kind:'godspeed-docker',service:'godspeed',workspace:INNER_WORKSPACE}));return root;}
test('a host add-on reaches only its installed Godspeed service through stdin, with the real container workspace',t=>{
 const root=fixture(t),args=dockerModelArgs(root,['--workspace',root,'--check']);
 assert.deepEqual(args,['compose','-p','godspeed-mission-control','--project-directory',root,'-f',path.join(root,'compose.yaml'),'--env-file',path.join(root,'.env'),'exec','-T','--user','hermes','godspeed','timeout','245','node','/opt/godspeed/kit/notebook/bin/godspeed-model.mjs','--workspace',INNER_WORKSPACE,'--check']);
 assert.ok(!args.some(x=>/docker.sock|api_key|token|--privileged/.test(x)));
});
test('a host caller cannot choose another container, command, provider or workspace',t=>{
 const root=fixture(t),other=fixture(t);
 for(const args of [['--workspace',other],['--service','other'],['--provider','other'],['--command','bash'],['--workspace',root,'--workspace',root]])assert.throws(()=>dockerModelArgs(root,args));
 const file=path.join(root,'.godspeed','model-host.json'),marker=JSON.parse(fs.readFileSync(file));marker.service='unrelated';fs.writeFileSync(file,JSON.stringify(marker));assert.throws(()=>dockerModelArgs(root,[]));
});

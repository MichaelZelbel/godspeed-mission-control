import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-portable-visuals-'));process.env.GODSPEED_WORKSPACE=root;
const render=await import('../reusable-recipes/social-visuals/scripts/render.mjs'),pixels=await import('../reusable-recipes/social-visuals/scripts/vendor/imagescript/ImageScript.js'),stamping=await import('../reusable-recipes/social-visuals/scripts/stamp.mjs'),round=await import('../reusable-recipes/social-visuals/scripts/round.mjs'),visual=await import('../reusable-recipes/social-visuals/scripts/visual.mjs'),spend=await import('../reusable-recipes/social-visuals/scripts/spend-permission.mjs');
const style={profile:'selected',the_one_rule:'The object makes the exact fictional sentence tangible.',output:{resolution:'ultra_high',aspect_ratio:'4:5'},api_parameters:{resolution:'2K'},lighting:{key:'side light',reason:'texture'},strict_negatives:['no watermark'],composition_defaults:{framing:'portrait'}};
const styles=path.join(root,'skills/social-visuals/brand/visual-style');fs.mkdirSync(styles,{recursive:true});fs.writeFileSync(path.join(styles,'selected.json'),JSON.stringify(style));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('portable image helpers retain recipe/style boundaries and resume an actual saved fixture task without another creation',async()=>{
 const merged=render.mergeRecipe({subject:{object:'Fictional source object'},lighting:{key:'noon'},strict_negatives:['no added logo']},style),payload=render.toPayload(merged);
 assert.equal(merged.lighting.reason,'texture');assert.equal(merged.lighting.key,'noon');assert.deepEqual(merged.strict_negatives,['no watermark','no added logo']);assert.equal(payload.resolution,'2K');assert.equal(JSON.parse(payload.prompt).output.resolution,'ultra_high');assert.equal(payload.prompt.includes('api_parameters'),false);
 assert.throws(()=>render.loadStyle('../another-installation'),/named style/);
 let created=0,collected=0;const bytes=await new pixels.default.Image(800,1000).fill(0x223344ff).encodeJPEG(80),out=path.join(root,'work/visuals/fictional-resume/raw.jpg');
 render.PROVIDERS.fixture={id:'fixture',defaultModel:'fictional-model',toImageUrl:async file=>file,createTask:async()=>{created++;assert.equal(render.readSidecar(out).state,'preparing');return {taskId:'fictional-task'};},waitForTask:async()=>{collected++;if(collected===1){const error=Error('Fictional interrupted wait');error.resumable=true;throw error;}return 'http://127.0.0.1/fictional-image';},download:async()=>bytes};
 await assert.rejects(render.renderRecipe({subject:{object:'Fictional source object'}},out,{provider:'fixture',quiet:true}),/interrupted/);
 assert.equal(render.readSidecar(out).task_id,'fictional-task');await assert.rejects(render.renderRecipe({subject:{}},out,{provider:'fixture'}),/retained/);
 await render.resume(out,{quiet:true});assert.equal(created,1);assert.equal(render.readSidecar(out).image_sha256,hash(bytes));assert.equal((await render.resume(out)).alreadyDone,true);
 const feed=await round.feedCopy(out),decoded=await pixels.default.Image.decode(fs.readFileSync(feed));assert.equal(decoded.width,400);
 const raw=path.join(path.dirname(out),'finished.raw.jpg'),final=path.join(path.dirname(out),'finished.jpg');fs.copyFileSync(out,raw);fs.copyFileSync(out,final);assert.equal(visual.sourceForEdit(final),raw);
 const roundFinal=path.join(path.dirname(out),'round-final.jpg'),roundStamped=path.join(path.dirname(out),'round-final.stamped-instagram.jpg');fs.copyFileSync(out,roundFinal);fs.copyFileSync(out,roundStamped);assert.equal(visual.sourceForEdit(roundStamped),roundFinal);
 assert.throws(()=>visual.sourceForEdit(path.join(path.dirname(out),'missing.stamped.jpg')),/no retained raw source/);
});

test('bundled MIT pixel helpers stamp only a supplied fictional mark without changing the raw source',async()=>{
 const raw=await new pixels.default.Image(800,1000).fill(0x223344ff).encodeJPEG(80),mark=path.join(root,'fictional-mark.png');fs.writeFileSync(mark,await new pixels.default.Image(240,50).fill(0xff8800ff).encode());
 const original=hash(raw),result=await stamping.stamp(raw,{mark});assert.equal(hash(raw),original);assert.deepEqual(result.base,{w:800,h:1000});assert.ok(result.at.w>0);assert.ok(result.at.y<1000);assert.notEqual(hash(result.bytes),original);
 const decoded=await pixels.default.Image.decode(result.bytes);assert.equal(decoded.width,800);assert.equal(decoded.height,1000);
 const input=path.join(root,'fictional-cli-source.jpg'),output=path.join(root,'fictional-cli-stamped.jpg');fs.writeFileSync(input,raw);
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../reusable-recipes/social-visuals/scripts/stamp.mjs',import.meta.url)),input,output,'--mark',mark],{windowsHide:true,env:{...process.env,GODSPEED_WORKSPACE:root}});
 assert.equal(hash(fs.readFileSync(input)),original);assert.equal((await pixels.default.Image.decode(fs.readFileSync(output))).width,800);
});

test('an uncertain fixture creation is retained without a task ID and cannot buy a replacement silently',async()=>{
 const out=path.join(root,'work/visuals/fictional-uncertain/raw.jpg');let attempts=0;
 render.PROVIDERS.uncertain={id:'uncertain',defaultModel:'fictional',createTask:async()=>{attempts++;throw Error('Fictional lost create response');}};
 await assert.rejects(render.renderRecipe({subject:{}},out,{provider:'uncertain'}),/lost create/);assert.equal(render.readSidecar(out).state,'preparing');
 await assert.rejects(render.renderRecipe({subject:{}},out,{provider:'uncertain'}),/retained/);await assert.rejects(render.resume(out),/no task id/);assert.equal(attempts,1);
});

test('paid image and upload permission rejects missing, stale or changed scope and retains reservations against the approved cap',()=>{
 const project=path.join(root,'work/visuals/fictional-approved'),folder=path.join(root,'.godspeed/approvals');fs.mkdirSync(project,{recursive:true});fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,'fictional-software-test.json'),reference=path.join(project,'fictional-reference.bin');fs.writeFileSync(reference,'Fictional reference bytes, not a personal photograph.');
 delete process.env.GODSPEED_SOCIAL_VISUALS_APPROVAL;assert.throws(()=>spend.reserveGeneration({model:'nano-banana-2',resolution:'1K',prompt:'fictional'}),/Approve/);
 const approval={status:'approved',approved_by:'user',user_quote:'Fictional software permission fixture only; no real provider call is authorized by this test.',provider:'kie',approved_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),price_checked_at:new Date().toISOString(),price_source_url:'https://example.invalid/fictional-price-fixture',project_directory:project,models:['nano-banana-2'],max_credits:10,max_tasks:2,task_credits:{'1K':5},reference_files:[{path:reference,sha256:hash(fs.readFileSync(reference))}]};
 fs.writeFileSync(file,JSON.stringify(approval));process.env.GODSPEED_SOCIAL_VISUALS_APPROVAL=file;
 assert.equal(spend.requireUploadPermission(reference),true);assert.throws(()=>spend.requireOutputPermission(path.join(root,'outside.jpg')),/outside/);
 for(let i=0;i<2;i++){const reserved=spend.reserveGeneration({model:'nano-banana-2',resolution:'1K',prompt:'fictional '+i,imageUrls:[]});assert.equal(reserved.state,'reserved');if(i===0){spend.retainSubmittedTask(reserved,'fictional-existing-provider-task');assert.equal(JSON.parse(fs.readFileSync(file+'.submitted-'+reserved.id+'.json','utf8')).task_id,'fictional-existing-provider-task');}}
 assert.throws(()=>spend.reserveGeneration({model:'nano-banana-2',resolution:'1K',prompt:'third fictional request'}),/exhausted/);assert.equal(JSON.parse(fs.readFileSync(file+'.tasks.json','utf8')).length,2);
 fs.writeFileSync(reference,'Changed fictional reference');assert.throws(()=>spend.requireUploadPermission(reference),/no upload permission/);
 fs.writeFileSync(file,JSON.stringify({...approval,expires_at:new Date(0).toISOString()}));assert.throws(()=>spend.requireUploadPermission(reference),/expired/);
});

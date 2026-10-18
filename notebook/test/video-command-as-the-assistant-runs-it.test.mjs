import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync,spawnSync} from 'node:child_process';
import {installStarter} from '../core/starter-workspace.mjs';

// ASKING THE ASSISTANT TO CAPTION A VIDEO FAILED EVERY TIME, until 18 October 2026. The assistant's
// own mc-video (written by wire-assistant.mjs, first on its PATH) adds `--godspeed <its mission
// control>` after whatever it is asked to run, and `mc-video captions` and `vertical` handed that on
// to burn.py, whose argument parser refused it: "unrecognized arguments: --godspeed ...". The
// add-on's own tests ran the commands as a person types them, without the option, so they passed.
// These run the very files the wiring writes, as the assistant's terminal runs them: the shell
// form everywhere (Git Bash on Windows) and the .cmd on Windows.
const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
const windows=process.platform==='win32';
const shell=spawnSync('sh',['-c','exit 0'],{windowsHide:true}).status===0;

function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-video-wired-')),root=path.join(base,'workspace'),home=path.join(base,'assistant'),video=path.join(base,'video-home');
  installStarter(root);fs.mkdirSync(home,{recursive:true});
  fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: auto\nterminal:\n  backend: local\n');
  execFileSync(process.execPath,[script,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41992',GODSPEED_DEVICE:'local',GODSPEED_COMPUTER:'off'},windowsHide:true});
  // The mission control's own caption look; setup recorded another folder, which has none.
  fs.mkdirSync(path.join(root,'video'),{recursive:true});fs.writeFileSync(path.join(root,'video','caption-style.json'),'{}\n');
  const elsewhere=path.join(base,'recorded-by-setup');fs.mkdirSync(elsewhere);fs.writeFileSync(path.join(elsewhere,'AGENTS.md'),'# other\n');
  // What mc-video runs, replaced by a recorder: "python" is this Node, which a preloaded file
  // stops before it reads burn.py, and HyperFrames is a file that only writes down its arguments.
  const record=path.join(base,'record.json'),recorder=path.join(base,'recorder.cjs');
  fs.writeFileSync(recorder,"const p=require('path');const main=process.argv[1]||'';if(p.basename(main)==='burn.py'){require('fs').writeFileSync(process.env.MC_VIDEO_TEST_RECORD,JSON.stringify({ran:'burn.py',args:process.argv.slice(2),style:process.env.GODSPEED_VIDEO_STYLE||null}));process.exit(0);}\n");
  const hf=path.join(video,'hyperframes','node_modules','hyperframes');fs.mkdirSync(path.join(hf,'bin'),{recursive:true});
  fs.writeFileSync(path.join(hf,'package.json'),JSON.stringify({name:'hyperframes',version:'0.8.43'}));
  fs.writeFileSync(path.join(hf,'bin','hyperframes.mjs'),"import fs from 'node:fs';fs.writeFileSync(process.env.MC_VIDEO_TEST_RECORD,JSON.stringify({ran:'hyperframes',args:process.argv.slice(2)}));\n");
  fs.writeFileSync(path.join(video,'config.json'),JSON.stringify({godspeed:elsewhere,ffmpeg:'ffmpeg',python:process.execPath}));
  const clip=path.join(base,'Sam\'s clips','talk 1.mp4');fs.mkdirSync(path.dirname(clip));fs.writeFileSync(clip,'');
  const env={...process.env,GODSPEED_VIDEO_HOME:video,MC_VIDEO_TEST_RECORD:record,NODE_OPTIONS:'--require '+JSON.stringify(recorder)};
  return {root,home,clip,record,env};
}
const recorded=f=>{const r=JSON.parse(fs.readFileSync(f.record,'utf8'));fs.rmSync(f.record);return r;};

// The shell form, the way the assistant's terminal starts it.
function viaShell(f,args){
  const r=spawnSync('sh',[path.join(f.home,'bin','mc-video'),...args],{env:f.env,encoding:'utf8',windowsHide:true});
  return {status:r.status,out:r.stdout+r.stderr};
}
// The .cmd, quoted the way Node's own shell:true starts it.
function viaCmd(f,args){
  const line=[path.join(f.home,'bin','mc-video.cmd'),...args].map(a=>'"'+a+'"').join(' ');
  const r=spawnSync('cmd.exe',['/d','/s','/c','"'+line+'"'],{env:f.env,encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true});
  return {status:r.status,out:r.stdout+r.stderr};
}

for(const [form,run,skip] of [['the shell form',viaShell,!shell&&'no sh on this computer'],['the Windows command file',viaCmd,!windows&&'cmd.exe is Windows only']]){
  test(`"caption this clip" through ${form}: burn.py gets the clip and no --godspeed, and the mission control's own look`,{skip},()=>{
    const f=fixture();
    for(const word of ['captions','caption']){
      const r=run(f,[word,f.clip]);
      assert.equal(r.status,0,r.out);
      assert.deepEqual(recorded(f),{ran:'burn.py',args:['captions',f.clip],style:path.join(f.root,'video','caption-style.json')},word);
    }
    const r=run(f,['captions',f.clip,'--language','de']);
    assert.equal(r.status,0,r.out);
    assert.deepEqual(recorded(f).args,['captions',f.clip,'--language','de']);
  });
  test(`"make the vertical cut with captions" through ${form}`,{skip},()=>{
    const f=fixture(),r=run(f,['vertical',f.clip,'--captions']);
    assert.equal(r.status,0,r.out);
    assert.deepEqual(recorded(f).args,['vertical',f.clip,'--captions']);
  });
  test(`a HyperFrames command through ${form} reaches HyperFrames without --godspeed`,{skip},()=>{
    const f=fixture(),r=run(f,['hyperframes','render','-o','card.mp4']);
    assert.equal(r.status,0,r.out);
    assert.deepEqual(recorded(f),{ran:'hyperframes',args:['render','-o','card.mp4']});
  });
  test(`mc-video check through ${form} looks at the assistant's own mission control`,{skip},()=>{
    const f=fixture(),r=run(f,['check']);
    assert.match(r.out,new RegExp('ok: godspeed '+f.root.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&')),r.out);
    assert.match(r.out,/ok: caption look /,r.out);
  });
}

test('the wiring still adds --godspeed, so the add-on is what must take it',()=>{
  const f=fixture(),text=fs.readFileSync(path.join(f.home,'bin','mc-video'),'utf8');
  assert.match(text,/third-party\/addons\/mc-video\/bin\/mc-video\.mjs' "\$@" --godspeed '/);
});

import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {HYPERFRAMES_VERSION} from "../../third-party/addons/mc-video/bin/lib.mjs";

const video=fileURLToPath(new URL("../../third-party/addons/mc-video/bin/mc-video.mjs",import.meta.url));

test("setup retries a zero-status HyperFrames install until the package is ready",t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"godspeed-mc-video-setup-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const godspeed=path.join(root,"godspeed"),home=path.join(root,"mc-video"),calls=path.join(root,"npm-calls"),preload=path.join(root,"setup-stand-ins.cjs");
 fs.mkdirSync(godspeed);fs.writeFileSync(path.join(godspeed,"AGENTS.md"),"# godspeed\n");
 fs.writeFileSync(preload,`
const child=require("node:child_process");
const fs=require("node:fs");
const path=require("node:path");
child.spawnSync=(cmd,args=[],opts={})=>{
 if(args.includes("hyperframes@${HYPERFRAMES_VERSION}")){
  fs.appendFileSync(process.env.MC_VIDEO_NPM_CALLS,"attempt\\n");
  if(fs.readFileSync(process.env.MC_VIDEO_NPM_CALLS,"utf8").trim().split("\\n").length===2){
   const pkg=path.join(opts.cwd,"node_modules","hyperframes");
   fs.mkdirSync(path.join(pkg,"bin"),{recursive:true});
   fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({version:"${HYPERFRAMES_VERSION}"}));
   fs.writeFileSync(path.join(pkg,"bin","hyperframes.mjs"),"");
  }
  return {status:0};
 }
 if(cmd==="tar"){fs.mkdirSync(path.join(opts.cwd,"hyperframes","skills"),{recursive:true});return {status:0};}
 if(cmd==="sh"&&args[0]==="-c")return {status:0,stdout:"/stand-in/command\\n",stderr:""};
 if(args.includes("-hide_banner"))return {status:0,stdout:" V....D libx264 H.264\\n ... subtitles Render text subtitles\\n",stderr:""};
 if(args[0]==="venv"){const python=path.join(args[1],"bin","python");fs.mkdirSync(path.dirname(python),{recursive:true});fs.writeFileSync(python,"");return {status:0};}
 if(args[0]==="pip"||args[0]==="-c")return {status:0};
 throw new Error("unexpected command: "+cmd+" "+args.join(" "));
};
global.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
`);
 const result=spawnSync(process.execPath,["--require",preload,video,"setup","--skip-proof","--godspeed",godspeed],{encoding:"utf8",env:{...process.env,HOME:root,GODSPEED_VIDEO_HOME:home,MC_VIDEO_NPM_CALLS:calls}});
 const output=result.stdout+result.stderr;
 assert.equal(result.status,0,output);
 assert.equal(fs.readFileSync(calls,"utf8").trim().split("\n").length,2);
 assert.match(output,/Retrying the pinned HyperFrames/);
 assert.match(output,/Done\. Tell your assistant/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(home,"hyperframes","node_modules","hyperframes","package.json"),"utf8")).version,HYPERFRAMES_VERSION);
});

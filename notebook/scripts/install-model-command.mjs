import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {commandFile} from './windows-command-file.mjs';

// Every platform's assistant wiring calls this. A background add-on can use the
// workspace launcher even when its service does not inherit the assistant PATH.
export function installModelCommand({root,home,node=process.execPath,platform=process.platform}={}){
 const script=fileURLToPath(new URL('../bin/godspeed-model.mjs',import.meta.url));
 const state=path.join(root,'.godspeed'),bin=path.join(home,'bin');fs.mkdirSync(state,{recursive:true});fs.mkdirSync(bin,{recursive:true});
 const launcher=path.join(state,'model.mjs');fs.writeFileSync(launcher,'import '+JSON.stringify(pathToFileURL(script).href)+';\n',{mode:0o600});
 const quote=value=>"'"+String(value).replaceAll('\\','/').replaceAll("'","'\\''")+"'";
 const shell=path.join(bin,'godspeed-model');fs.writeFileSync(shell,'#!/bin/sh\nGODSPEED_MODEL_WORKSPACE='+quote(root)+'; export GODSPEED_MODEL_WORKSPACE\nexec '+quote(node)+' '+quote(launcher)+' "$@"\n',{mode:0o700});if(platform!=='win32')fs.chmodSync(shell,0o700);
 if(platform==='win32')fs.writeFileSync(shell+'.cmd',commandFile(at=>'set "GODSPEED_MODEL_WORKSPACE='+at(root)+'"\r\n"'+at(node)+'" "'+at(launcher)+'" %*\r\n',{folder:bin}));
 return {launcher,command:shell};
}

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Version 2 extends the complete main-branch starter. Existing user files win.
export function installStarter(root, starter=fileURLToPath(new URL('../../starter-godspeed/',import.meta.url))) {
  const copyMissing=(source,destination)=>{
    const stat=fs.lstatSync(source);
    if(stat.isSymbolicLink()){
      if(!fs.existsSync(destination))fs.symlinkSync(fs.readlinkSync(source),destination);
    }else if(stat.isDirectory()){
      if(fs.existsSync(destination)&&!fs.statSync(destination).isDirectory())throw Error('Starter folder conflicts with an existing file: '+destination);
      fs.mkdirSync(destination,{recursive:true});
      for(const name of fs.readdirSync(source))copyMissing(path.join(source,name),path.join(destination,name));
    }else if(!fs.existsSync(destination))fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
  };
  copyMissing(starter,root);
}

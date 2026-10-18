import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {slug} from './records/store.mjs';

// Which machine this is. One machine runs the routines (settings/installation
// owner), and every check of that rule compares the owner with this name.
// Until 6 October 2026 every computer was called 'local' unless its launcher
// said otherwise, and no Windows launcher did: two PCs sharing one notebook
// both ran the routines, processed the same notes and made the same backups.
// Now each machine names itself once, on first start, in its own .godspeed/
// folder, which is never synced: the computer's name and a random suffix
// ("desktop-3f9a1c2e"), so Settings can still say which machine is which.
export const LEGACY_DEVICE='local';
const valid=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)&&id!==LEGACY_DEVICE;
export function deviceId(state){
 const file=path.join(state,'device.json');
 const read=()=>{try{const id=JSON.parse(fs.readFileSync(file,'utf8')).id;return valid(id)?id:null;}catch{return null;}};
 const existing=read();if(existing)return existing;
 fs.mkdirSync(state,{recursive:true});
 const id=(slug(os.hostname()).slice(0,24).replace(/-+$/,'')||'computer')+'-'+randomBytes(4).toString('hex');
 // The server and its supervisor may both start first: the name is linked
 // into place only if none is there yet, and whoever lost reads the winner's.
 const temporary=file+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';
 fs.writeFileSync(temporary,JSON.stringify({id,created_at:new Date().toISOString()})+'\n',{mode:0o600});
 // A drive without links (FAT) or a damaged name file gets the new one moved into place.
 try{fs.linkSync(temporary,file);}catch{if(!read())fs.renameSync(temporary,file);}
 finally{try{fs.unlinkSync(temporary);}catch{}}
 return read()||id;
}
// GODSPEED_DEVICE still names a machine (the server says 'vps'); 'local', the
// old shared name, counts as unnamed.
export function machineDevice(root,env=process.env){
 const named=String(env.GODSPEED_DEVICE||'').trim();
 return named&&named!==LEGACY_DEVICE?{id:named,generated:false}:{id:deviceId(path.join(path.resolve(root),'.godspeed')),generated:true};
}
// A notebook set up before 6 October 2026 names 'local' as the machine that
// runs routines, and after the upgrade no machine is called that. The first
// machine that starts and named itself takes the routines over, under the
// workspace lock, so exactly one does; the others then see an owner that is
// not theirs. A real name ('vps', 'production', anything chosen in Settings)
// is never touched, and a machine named by GODSPEED_DEVICE never claims.
export async function claimLegacyOwner(store,{id,generated}){
 if(!generated||!valid(id))return false;
 const settings=store.get('settings','installation');if(settings?.owner!==LEGACY_DEVICE)return false;
 return store.withLockAsync(()=>{
  const current=store.get('settings','installation');if(current?.owner!==LEGACY_DEVICE)return false;
  store.commit([store.prepare('settings',{owner:id},current),...store.list('jobs').filter(j=>j.owner===LEGACY_DEVICE).map(j=>store.prepare('jobs',{owner:id},j))]);
  return true;
 });
}

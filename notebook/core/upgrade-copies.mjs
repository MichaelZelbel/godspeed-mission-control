import fs from 'node:fs';
import path from 'node:path';

// The full copy of the notebook an installer makes before it updates it (knowledge and media,
// about 250 MB on a grown notebook). Until 15 October 2026 none was ever removed: Michael's
// server had 35 of them, 7.2 GB, after eight days of updates, and its disk was 97% full. Now an
// installer calls this once its update worked (the new notebook answers), and only the newest
// three stay. During an update, and after one that failed, nothing calls it, so every copy stays.
//
// Only what an installer made is touched, known by its name and its backup.json:
//   20261015-093000-<commit>        the Linux and Mac installer (scripts/install-native-notebook.sh)
//   20261015-093000-123             the Windows setup (kit-bootstrap's windows/setup-full-alpha.ps1)
//   before-update-20261015-093000   the server package (docker/full-candidate/install.sh)
// and, named .partial-<one of those>, what a copy that stopped part-way left (archives.mjs backup).
// Anything else in the folder is left as it is: the nightly backups (backup-schedule.mjs, which
// keeps its own seven), a backup the owner asked for by name, a folder of their own.
export const upgradeCopiesKept=3;
const shapes=[/^(\d{8})-(\d{6})-[0-9a-f]{7,64}$/,/^(\d{8})-(\d{6})-(\d{3})$/,/^before-update-(\d{8})-(\d{6})$/];
// When a copy was made, as digits that sort in time order.
function stampOf(name){
  for(const shape of shapes){const match=shape.exec(name);if(match)return match[1]+match[2]+(match[3]||'000');}
  return null;
}
const isFile=file=>{try{return fs.lstatSync(file).isFile();}catch{return false;}};
// A whole copy: a real folder (never a link) with its manifest, which backup() writes last.
const isCopy=(folder,name)=>{try{return fs.lstatSync(path.join(folder,name)).isDirectory()&&isFile(path.join(folder,name,'backup.json'));}catch{return false;}};

// made: the copy this update just made, by name or by its path in the folder. It always stays,
// and with it the newest others up to keep. Without a whole copy just made nothing is removed.
export function pruneUpgradeCopies(folder,{made,keep=upgradeCopiesKept}={}){
  if(!Number.isInteger(keep)||keep<1)throw Error('Keep at least one copy');
  folder=path.resolve(folder);
  const target=made?path.resolve(folder,made):null;
  if(!target||path.relative(folder,path.dirname(target))!=='')throw Error('Name the copy this update just made, in '+folder+'. Nothing was removed.');
  const madeName=path.basename(target),madeStamp=stampOf(madeName);
  if(!madeStamp||!isCopy(folder,madeName))throw Error('The copy this update just made ('+madeName+') is not a whole update copy in '+folder+'. Nothing was removed.');
  const copies=[],partials=[],ignored=[];
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const name=entry.name,partial=name.startsWith('.partial-'),stamp=stampOf(partial?name.slice('.partial-'.length):name);
    if(!stamp||!entry.isDirectory())ignored.push(name);
    else if(partial)partials.push({name,stamp});
    else if(isCopy(folder,name))copies.push({name,stamp});
    else ignored.push(name);
  }
  copies.sort((a,b)=>b.stamp.localeCompare(a.stamp)||b.name.localeCompare(a.name));
  const kept=[madeName,...copies.map(copy=>copy.name).filter(name=>name!==madeName)].slice(0,keep);
  // A part-way copy older than the one just made was left by a copy that stopped; a newer one
  // could still be in the making, so it stays.
  const going=[...copies.filter(copy=>!kept.includes(copy.name)),...partials.filter(partial=>partial.stamp<madeStamp)].map(entry=>entry.name);
  const removed=[],failed=[];
  for(const name of going){
    try{fs.rmSync(path.join(folder,name),{recursive:true,force:true,maxRetries:3});removed.push(name);}
    catch(error){failed.push({name,error:String(error.message||error)});}
  }
  return {folder,keep,made:madeName,kept,removed,failed,ignored:ignored.sort()};
}

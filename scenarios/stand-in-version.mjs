// The version of update-keeps-everything's stand-in release for Update now: one the notebook's own
// update check (notebook/core/update.mjs, compareVersions) takes as newer than both the stage it
// stands in for and the version the machine runs.
//
//   node scenarios/stand-in-version.mjs <stage version> <installed version>
//
// Until #490 the stand-in was the stage's version with ".handover" after it. A night's stage is named
// after the PUBLIC stage (stage-for-run.sh: 2.0.0-beta.20.commit.690266d), while the notebook says it
// runs the version in its own notebook/package.json, which a release step raises before the public
// stage follows (2.0.0-beta.23). Then 2.0.0-beta.20.commit.690266d.handover is older than what runs,
// and Update now answered "You have the newest version". The stand-in now builds on the higher of
// the two, so it is newer than whatever the install runs, also right after a release step.
import {fileURLToPath} from 'node:url';
import {compareVersions} from '../notebook/core/update.mjs';

export function standInVersion(stage,installed){
  const base=compareVersions(stage,installed)>=0?stage:installed;
  const found=/^(\d+)\.(\d+)\.(\d+)(-[^+]*)?(?:\+.*)?$/.exec(base);
  if(!found)throw Error(JSON.stringify(base)+' is not a version number Godspeed can compare.');
  // A prerelease one part longer is newer; a plain release gets a prerelease of the next patch.
  const version=found[4]?found[1]+'.'+found[2]+'.'+found[3]+found[4]+'.handover'
    :found[1]+'.'+found[2]+'.'+(Number(found[3])+1)+'-handover';
  if(compareVersions(version,stage)<=0||compareVersions(version,installed)<=0)
    throw Error('The stand-in version '+version+' is not newer than '+stage+' and '+installed+'.');
  return version;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [stage,installed]=process.argv.slice(2);
  if(!stage||!installed){console.error('usage: node scenarios/stand-in-version.mjs <stage version> <installed version>');process.exit(2);}
  try{process.stdout.write(standInVersion(stage,installed)+'\n');}
  catch(error){console.error(error.message);process.exit(1);}
}

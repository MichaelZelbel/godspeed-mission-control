import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions} from '../notebook/core/update.mjs';
import {standInVersion} from './stand-in-version.mjs';

const newerThanBoth=(stage,installed)=>{
  const version=standInVersion(stage,installed);
  assert.equal(compareVersions(version,stage),1,version+' is not newer than the stage '+stage);
  assert.equal(compareVersions(version,installed),1,version+' is not newer than the installed '+installed);
  return version;
};

// The night of 2026-11-13 (#490): the stage named after the public beta.20, main's notebook at beta.23.
test('right after a release step the stand-in is newer than the version the notebook runs',()=>{
  assert.equal(newerThanBoth('2.0.0-beta.20.commit.690266d','2.0.0-beta.23'),'2.0.0-beta.23.handover');
});

test('when the stage is the newer one the stand-in builds on the stage, as before',()=>{
  assert.equal(newerThanBoth('2.0.0-beta.23.commit.690266d','2.0.0-beta.23'),'2.0.0-beta.23.commit.690266d.handover');
  assert.equal(newerThanBoth('2.0.0-beta.8','2.0.0-beta.8'),'2.0.0-beta.8.handover');
});

test('a plain release gets a prerelease of the next patch, which is newer',()=>{
  assert.equal(newerThanBoth('2.0.0','2.0.0'),'2.0.1-handover');
  assert.equal(newerThanBoth('2.0.0-beta.30','2.0.0'),'2.0.1-handover');
});

test('a version Godspeed cannot compare is refused',()=>{
  assert.throws(()=>standInVersion('main','2.0.0-beta.23'),/not a version number/);
});

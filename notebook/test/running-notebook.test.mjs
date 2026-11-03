import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {recordRunningNotebook, RUNNING_NOTEBOOK_FILE} from '../core/running-notebook.mjs';

const setup = t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-running-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const root = path.join(base, 'mission-control');
  fs.mkdirSync(path.join(root, '.godspeed'), {recursive: true});
  const record = () => JSON.parse(fs.readFileSync(path.join(root, '.godspeed', RUNNING_NOTEBOOK_FILE), 'utf8'));
  return {base, root, record, config: name => path.join(base, 'local', name, 'assistant.json')};
};

test('fresh install: the record names the folder the notebook runs from', t => {
  const {root, record, config} = setup(t);
  assert.equal(recordRunningNotebook({root, assistantConfig: config('New State'), platform: 'win32'}).written, true);
  assert.equal(record().stateFolder, path.dirname(config('New State')));
  assert.equal(record().assistantConfig, config('New State'));
  assert.equal(record().workspace, root);
});

test('finished move: the next start rewrites the record to the new folder', t => {
  const {root, record, config} = setup(t);
  recordRunningNotebook({root, assistantConfig: config('Old State'), platform: 'win32'});
  recordRunningNotebook({root, assistantConfig: config('New State'), platform: 'win32'});
  assert.equal(record().stateFolder, path.dirname(config('New State')));
});

test('waiting move: the record names the old folder, where the notebook really runs', t => {
  const {root, record, config} = setup(t);
  recordRunningNotebook({root, assistantConfig: config('Old State'), platform: 'win32'});
  assert.equal(record().stateFolder, path.dirname(config('Old State')));
});

test('a second start with the same folder leaves the file alone', t => {
  const {root, config} = setup(t);
  recordRunningNotebook({root, assistantConfig: config('S'), platform: 'win32'});
  const file = path.join(root, '.godspeed', RUNNING_NOTEBOOK_FILE), before = fs.statSync(file).mtimeMs;
  assert.equal(recordRunningNotebook({root, assistantConfig: config('S'), platform: 'win32'}).written, false);
  assert.equal(fs.statSync(file).mtimeMs, before);
});

test('Mac, Linux and servers: nothing is written', t => {
  const {root, config} = setup(t);
  for (const platform of ['linux', 'darwin']) recordRunningNotebook({root, assistantConfig: config('S'), platform});
  assert.equal(fs.existsSync(path.join(root, '.godspeed', RUNNING_NOTEBOOK_FILE)), false);
});

test('on Windows without a state folder of its own, an old record is removed', t => {
  const {root, config} = setup(t);
  recordRunningNotebook({root, assistantConfig: config('S'), platform: 'win32'});
  recordRunningNotebook({root, assistantConfig: path.join(root, '.godspeed', 'assistant.json'), platform: 'win32'});
  assert.equal(fs.existsSync(path.join(root, '.godspeed', RUNNING_NOTEBOOK_FILE)), false);
});

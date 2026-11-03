// WHERE THE RUNNING NOTEBOOK LIVES, written into the mission control (ticket 07, 2.0.0-beta.16).
// On Windows the setup keeps the notebook's state and its assistant in a folder of its own, and
// the notebook is started with GODSPEED_ASSISTANT_CONFIG naming the assistant.json in it. The
// tools (mc-mail, mc-prompt-archive, prompt-harvest) used to guess that folder from two names.
// Now the notebook writes, once at start, a small pointer in the mission control:
// .godspeed/running-notebook.json. It names the folder the notebook really runs from, so a
// computer whose folder move is waiting (a file held open) is found as well as a moved one, and
// no tool needs to know a folder name. It is a pointer, not a copy of assistant.json: the add-ons
// read .godspeed/assistant.json directly, and a copy there would change what they connect to.
// Only Windows writes it. Mac, Linux and servers keep their assistant.json in .godspeed already.
import fs from 'node:fs';
import path from 'node:path';

export const RUNNING_NOTEBOOK_FILE = 'running-notebook.json';

export function recordRunningNotebook({root, assistantConfig, platform = process.platform}) {
  if (platform !== 'win32') return {written: false, reason: 'not windows'};
  const dir = path.join(path.resolve(root), '.godspeed');
  const file = path.join(dir, RUNNING_NOTEBOOK_FILE);
  const outside = assistantConfig && path.resolve(path.dirname(assistantConfig)).toLowerCase() !== dir.toLowerCase();
  if (!outside) {
    // Nothing to point at: a record left from an earlier start would point at a folder not in use.
    if (fs.existsSync(file)) { fs.rmSync(file, {force: true}); return {written: false, removed: true}; }
    return {written: false, reason: 'no state folder'};
  }
  const config = path.resolve(assistantConfig);
  const text = JSON.stringify({format: 1, assistantConfig: config, stateFolder: path.dirname(config), workspace: path.resolve(root)}) + '\n';
  try { if (fs.readFileSync(file, 'utf8') === text) return {written: false, reason: 'unchanged'}; } catch {}
  fs.mkdirSync(dir, {recursive: true});
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
  return {written: true, file};
}

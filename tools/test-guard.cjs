// test-guard.cjs - required first by every Node test in tools/: a test never reaches a real
// mission control. The same as test-guard.bash (which says why, 9 October 2026): every variable
// that names a mission control, an assistant, a notebook or a device is dropped, and the home
// folders point at an empty throwaway folder, removed when the test ends. Git keeps the person's
// own settings, read only.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
for (const name of Object.keys(process.env)) {
  if (/^(GODSPEED_|HERMES_|MENERIO_|KB_|MC_)/i.test(name) || /^(CODEX_HOME|CLAUDE_CONFIG_DIR)$/i.test(name)) delete process.env[name];
}
const realHome = os.homedir();
if (!process.env.GIT_CONFIG_GLOBAL && realHome && fs.existsSync(path.join(realHome, '.gitconfig'))) process.env.GIT_CONFIG_GLOBAL = path.join(realHome, '.gitconfig');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-test-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
if (process.platform === 'win32') {
  for (const [name, sub] of [['LOCALAPPDATA', 'AppData/Local'], ['APPDATA', 'AppData/Roaming']]) {
    process.env[name] = path.join(home, sub);
    fs.mkdirSync(process.env[name], { recursive: true });
  }
}
process.on('exit', () => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
module.exports = { home };

'use strict';
// The pairing key, kept in the computer's own password store:
//   Windows  a file sealed with the user's Windows login (DPAPI, through PowerShell 5.1)
//   Mac      the login Keychain (security)
//   Linux    a file only the user can read
// GODSPEED_COMPUTER_SECRET=file forces the plain file (tests).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SERVICE = 'Godspeed Mission Control computer';
const ACCOUNT = 'godspeed-computer';

function mode() {
  if (process.env.GODSPEED_COMPUTER_SECRET === 'file') return 'file';
  if (process.platform === 'win32') return 'dpapi';
  if (process.platform === 'darwin') return 'keychain';
  return 'file';
}

function ps(script, input) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { input, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('PowerShell: ' + (r.stderr || r.error || '').toString().trim());
  return r.stdout;
}

function store(dir, key) {
  fs.mkdirSync(dir, { recursive: true });
  const m = mode();
  if (m === 'dpapi') {
    const file = path.join(dir, 'key.dpapi').replace(/'/g, "''");
    ps(`$k = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString $k -AsPlainText -Force; `
      + `[IO.File]::WriteAllText('${file}', (ConvertFrom-SecureString $s))`, key);
  } else if (m === 'keychain') {
    const r = spawnSync('security', ['add-generic-password', '-U', '-a', ACCOUNT, '-s', SERVICE, '-w', key], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('Keychain: ' + (r.stderr || '').trim());
  } else {
    fs.writeFileSync(path.join(dir, 'key'), key, { mode: 0o600 });
  }
}

function load(dir) {
  const m = mode();
  try {
    if (m === 'dpapi') {
      const file = path.join(dir, 'key.dpapi');
      if (!fs.existsSync(file)) return null;
      const f = file.replace(/'/g, "''");
      return ps(`$s = ConvertTo-SecureString ([IO.File]::ReadAllText('${f}').Trim()); `
        + `[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`).trim() || null;
    }
    if (m === 'keychain') {
      const r = spawnSync('security', ['find-generic-password', '-a', ACCOUNT, '-s', SERVICE, '-w'], { encoding: 'utf8' });
      return r.status === 0 ? r.stdout.trim() || null : null;
    }
    return fs.readFileSync(path.join(dir, 'key'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function remove(dir) {
  const m = mode();
  if (m === 'keychain') spawnSync('security', ['delete-generic-password', '-a', ACCOUNT, '-s', SERVICE], { encoding: 'utf8' });
  for (const f of ['key', 'key.dpapi']) fs.rmSync(path.join(dir, f), { force: true });
}

module.exports = { store, load, remove, mode };

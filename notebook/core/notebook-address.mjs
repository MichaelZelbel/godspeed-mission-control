import fs from 'node:fs';

// The address where the owner opens this notebook in a browser, so an
// assistant asked "send me the link to my notebook" can answer (Teach It Once,
// Chapters 4 and 13). Until 8 October 2026 no assistant knew it.
//
// Each machine's notebook knows its own:
// - a server installed with the Linux installer: GODSPEED_WEB_ADDRESS, the
//   https address the installer made and printed (install-native-notebook.sh,
//   kept in start.mjs), port included when it is not 443;
// - the Hostinger one-click server: its name, srvNNNNNN.hstgr.cloud, which the
//   VPS's /etc/hostname gives the container at /run/godspeed-vps-hostname
//   (docker/hostinger/installer/compose.mjs reads the same file the same way);
// - a computer: the local address the notebook listens on, which opens on that
//   computer only.
// Inside a container with no address of its own, 127.0.0.1 would be the
// container's, so there is no link to give and the answer says so.
export const HOSTINGER_HOSTNAME_FILE = '/run/godspeed-vps-hostname';

export function hostingerAddress(text) {
  let host = String(text || '').trim().toLowerCase();
  if (/^srv[0-9]+$/.test(host)) host += '.hstgr.cloud';
  return /^srv[0-9]+\.hstgr\.cloud$/.test(host) ? 'https://' + host : null;
}

function webAddress(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['https:', 'http:'].includes(url.protocol) && url.hostname ? url.origin : null;
  } catch { return null; }
}

// How the owner gets in at a web address, said beside it. Until 16 October 2026 this said "signs
// in with their notebook account", so an assistant asked how to open the notebook told its owner
// to use a "notebook account" nobody ever made: they chose a username and password on the setup
// page (web-auth.mjs; no email address, so no reset by email: the recovery code saved at that
// setup is the way back in, and the sign-in page asks for it).
export const SIGN_IN = 'The owner signs in there with the username and password they chose when they first set up this server. ' +
  'Forgotten? "Forgot your username or password?" on the sign-in page takes the recovery code they saved during that setup. ' +
  'There is no reset by email; without that code, getting back in needs access to the server itself.';

export function notebookAddress({env = process.env, port = Number(env.GODSPEED_PORT) || 47831, hostnameFile = HOSTINGER_HOSTNAME_FILE,
  read = file => fs.readFileSync(file, 'utf8'), inContainer = () => fs.existsSync('/.dockerenv')} = {}) {
  let web = webAddress(env.GODSPEED_WEB_ADDRESS);
  if (!web) { try { web = hostingerAddress(read(hostnameFile)); } catch {} }
  if (web) return {link: web + '/dashboard', opens: 'on any computer or phone. ' + SIGN_IN, sign_in: SIGN_IN};
  if (inContainer()) return {link: null, opens: 'This notebook runs in a container that does not know its own web address. It is the address the owner opens the notebook at in a browser, the same address where they set up this server. ' + SIGN_IN, sign_in: SIGN_IN};
  return {link: 'http://127.0.0.1:' + port + '/dashboard', opens: 'only on the computer this notebook runs on'};
}

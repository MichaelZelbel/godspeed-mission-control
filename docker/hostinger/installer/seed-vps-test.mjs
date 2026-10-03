// Creates one synthetic test installation using the real coordinator privately.
import fs from 'node:fs';

const address = process.env.GODSPEED_INSTALL_BIND || '10.0.0.1';
if (!address) throw Error('Docker network address could not be detected');
const base = `http://${address}:8794/godspeed-install`;
const request = await fetch(base + '/api/start', { method: 'POST', headers: { origin: 'https://srv1069233.hstgr.cloud', 'content-type': 'application/json' }, body: '{}' });
if (request.status !== 201) throw Error('Could not prepare the VPS test installation');
const ticket = await request.json();
const publicConfig = new URL(new URL(ticket.checkout).searchParams.get('compose_url'));
const config = await fetch(base + publicConfig.pathname.slice('/godspeed-install'.length));
if (!config.ok) throw Error('Could not load the VPS test configuration');
const directory = '/opt/godspeed-hostinger-test'; fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.writeFileSync(directory + '/ticket.json', JSON.stringify(ticket), { mode: 0o600 });
fs.writeFileSync(directory + '/compose.yaml', await config.text(), { mode: 0o600 });
console.log('Private test configuration prepared. No installation fields supplied.');

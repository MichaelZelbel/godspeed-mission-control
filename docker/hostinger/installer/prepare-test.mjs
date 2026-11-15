import fs from 'node:fs';
const directory = process.env.GODSPEED_TEST_INSTALL_STATE;
const response = await fetch('http://localhost:8794/godspeed-install/api/start', { method: 'POST', headers: { origin: 'http://localhost:8794', 'content-type': 'application/json' }, body: '{}' });
if (response.status !== 201) throw Error('Fixture did not start');
const ticket = await response.json();
fs.writeFileSync(directory + '/ticket.json', JSON.stringify(ticket), { mode: 0o600 });
const configURL = new URL(new URL(ticket.checkout).searchParams.get('compose_url')); configURL.hostname = 'localhost';
const config = await fetch(configURL); if (!config.ok) throw Error('Private configuration could not be loaded');
fs.writeFileSync(directory + '/compose.yaml', await config.text(), { mode: 0o600 });

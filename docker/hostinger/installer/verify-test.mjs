import fs from 'node:fs';
const directory = process.env.GODSPEED_TEST_INSTALL_STATE, ticket = JSON.parse(fs.readFileSync(directory + '/ticket.json', 'utf8'));
const response = await fetch(`http://localhost:8794/godspeed-install/api/status/${ticket.id}`, { headers: { authorization: 'Bearer ' + ticket.key } });
if (!response.ok) throw Error('Installation progress could not be read');
const status = await response.json();
if (status.state !== 'ready' || !/^https:\/\/localhost\/setup#invite=[a-f0-9]{64}$/.test(status.url)) throw Error('Automatic private owner handoff is not ready');
fs.writeFileSync(directory + '/invitation.txt', status.url, { mode: 0o600 });
console.log('Automatic server detection, authenticated callback and private account-creation handoff passed.');

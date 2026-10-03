// Disposable CI only: local certificates, synthetic keys and a local hostname.
import fs from 'node:fs';
import https from 'node:https';
import { createInstaller } from './server.mjs';
const directory = process.env.GODSPEED_TEST_INSTALL_STATE;
if (!directory || process.env.GITHUB_ACTIONS !== 'true') throw new Error('This helper is only for disposable GitHub runners');
fs.mkdirSync(directory, { recursive: true });
const hostnameFile = directory + '/hostname'; fs.writeFileSync(hostnameFile, 'localhost\n');
const fetcher = async (url, init) => {
  if (url !== 'https://localhost/api/auth/bootstrap') throw Error('Unrecognized fixture server');
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: init.method, headers: init.headers, rejectUnauthorized: false, timeout: 10000 }, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(new Response(body, { status: res.statusCode })));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('Fixture timed out'))); req.end(init.body);
  });
};
createInstaller({ directory: directory + '/jobs', origin: 'http://host.docker.internal:8794/godspeed-install', testing: true, hostnameFile, fetcher, allowedOrigins: ['http://localhost:8794'] }).server.listen(8794, '0.0.0.0');

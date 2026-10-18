// Sanitized, read-only diagnostics. Never output callback secrets, owner links or bodies.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
const directory = process.env.GODSPEED_TEST_INSTALL_STATE;
if (!directory || process.env.GITHUB_ACTIONS !== 'true') throw Error('Disposable GitHub fixture only');
const states = [];
for (const name of fs.readdirSync(path.join(directory, 'jobs'))) {
  if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
  const job = JSON.parse(fs.readFileSync(path.join(directory, 'jobs', name), 'utf8'));
  states.push({ state: job.state, hostname: job.hostname || null, callbackReceived: !!job.bootstrap, ownerLinkProduced: !!job.url });
}
async function probe(hostname, family) {
  return new Promise(resolve => {
    const request = https.request({ hostname, port: 443, path: '/health', servername: 'localhost', rejectUnauthorized: false, family, timeout: 5000 }, response => {
      let text = ''; response.on('data', data => { if (text.length < 4096) text += data; });
      response.on('end', () => {
        let health = null; try { const value = JSON.parse(text); health = { ok: value.ok, format: value.format, version: value.version }; } catch { /* only selected health fields are allowed */ }
        resolve({ hostname, family: family || 'default', httpStatus: response.statusCode, health });
      });
    });
    request.on('error', error => resolve({ hostname, family: family || 'default', errorCode: error.code || error.name, causes: error.errors?.map(cause => cause.code) }));
    request.on('timeout', () => request.destroy(Object.assign(Error('Timed out'), { code: 'PROBE_TIMEOUT' })));
    request.end();
  });
}
console.log(JSON.stringify({ coordinatorJobs: states, httpsProbes: await Promise.all([probe('localhost'), probe('localhost', 4), probe('127.0.0.1', 4)]) }, null, 2));

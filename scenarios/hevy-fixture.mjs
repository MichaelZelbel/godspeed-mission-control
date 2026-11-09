#!/usr/bin/env node
// A loopback-only stand-in for the small public Hevy surface the proving scenario uses.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';

const acceptedKey = process.env.GODSPEED_HEVY_FIXTURE_KEY || '00000000-0000-4000-8000-000000000001';
const initial = [
  { id: 'harbor-strength', title: 'Harbor Strength', exercises: [{ title: 'Scenario Squat', sets: [{ weight_kg: 42, reps: 8 }] }] },
  { id: 'canal-pull', title: 'Canal Pull', exercises: [{ title: 'Scenario Row', sets: [{ weight_kg: 31, reps: 10 }] }] },
];
const changed = [
  { id: 'harbor-strength', title: 'Harbor Strength', exercises: [{ title: 'Scenario Squat', sets: [{ weight_kg: 45, reps: 8 }] }] },
];

const option = name => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const stateFile = option('--state');
const logFile = option('--log');
const port = Number(option('--port') || 0);
if (!stateFile || !logFile) throw new Error('usage: hevy-fixture.mjs --state <file> --log <file> [--port <port>]');

if (process.argv.includes('--mutate')) {
  await writeFile(stateFile, JSON.stringify({ changed: true }) + '\n');
  process.exit(0);
}

const readState = async () => {
  try { return JSON.parse(await readFile(stateFile, 'utf8')); }
  catch { return { changed: false }; }
};
const workouts = async () => (await readState()).changed ? changed : initial;
const record = async (req, status, accepted) => {
  await writeFile(logFile, `${JSON.stringify({ method: req.method, path: new URL(req.url, 'http://fixture').pathname, status, accepted })}\n`, { flag: 'a' });
};
const json = async (req, res, status, body, accepted = true) => {
  await record(req, status, accepted);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname === '/health') return json(req, res, 200, { ok: true });
  const accepted = req.headers['api-key'] === acceptedKey;
  if (!accepted) return json(req, res, 401, { error: 'refused' }, false);
  const rows = await workouts();
  if (url.pathname === '/v1/user/info') return json(req, res, 200, { id: 'scenario-owner', name: 'Scenario Owner' });
  if (url.pathname === '/v1/workouts/count') return json(req, res, 200, { count: rows.length });
  if (url.pathname === '/v1/workouts/events') return json(req, res, 200, { events: (await readState()).changed ? [{ type: 'updated', workout_id: 'harbor-strength' }, { type: 'deleted', workout_id: 'canal-pull' }] : [] });
  if (url.pathname === '/v1/workouts') return json(req, res, 200, { page: 1, page_count: 1, workouts: rows });
  if (url.pathname.startsWith('/v1/workouts/')) {
    const workout = rows.find(row => row.id === url.pathname.split('/').at(-1));
    return json(req, res, workout ? 200 : 404, workout || { error: 'missing' });
  }
  if (url.pathname === '/v1/exercise_templates') return json(req, res, 200, { page: 1, page_count: 1, exercise_templates: [{ id: 'scenario-squat', title: 'Scenario Squat' }, { id: 'scenario-row', title: 'Scenario Row' }] });
  return json(req, res, 404, { error: 'missing' });
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`${server.address().port}\n`));
process.on('SIGTERM', () => server.close());

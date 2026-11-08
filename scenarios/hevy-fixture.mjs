#!/usr/bin/env node
// A loopback-only stand-in for the small public Hevy surface the proving scenario uses.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';

const acceptedKey = '00000000-0000-4000-8000-000000000001';
const workout = (id, title, exercise, weight_kg, reps, start) => ({
  id, title, description: '', start_time: start, end_time: new Date(Date.parse(start) + 3600000).toISOString(),
  exercises: [{ index: 0, title: exercise, notes: null, superset_id: null, sets: [{ index: 0, type: 'normal', weight_kg, reps, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null }] }],
});
const initial = [
  workout('harbor-strength', 'Harbor Strength', 'Scenario Squat', 42, 8, '2026-11-01T09:00:00Z'),
  workout('canal-pull', 'Canal Pull', 'Scenario Row', 31, 10, '2026-11-02T09:00:00Z'),
];
const changed = [
  workout('harbor-strength', 'Harbor Strength', 'Scenario Squat', 45, 8, '2026-11-01T09:00:00Z'),
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
  if (url.pathname === '/v1/workouts/count') return json(req, res, 200, { workout_count: rows.length });
  if (url.pathname === '/v1/workouts/events') return json(req, res, 200, (await readState()).changed ? { page: 1, page_count: 1, events: [{ type: 'updated', workout: rows[0] }, { type: 'deleted', id: 'canal-pull' }] } : { page: 1, page_count: 1, workouts: [] });
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

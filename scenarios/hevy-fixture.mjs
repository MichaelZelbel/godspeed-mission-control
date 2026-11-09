#!/usr/bin/env node
// A loopback-only stand-in for the small public Hevy surface the proving scenario uses.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';

const acceptedKey = process.env.GODSPEED_HEVY_FIXTURE_KEY || '00000000-0000-4000-8000-000000000001';
// The workouts in the shape Hevy's API gives them (https://api.hevyapp.com/docs), which the carried
// add-on checks before it writes anything (third-party/addons/godspeed-workouts/lib/hevy.mjs).
const set = (weight_kg, reps) => ({ index: 0, type: 'normal', weight_kg, reps, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null });
const workout = (id, title, day, exercise, weight_kg, reps) => ({
  id, title, description: null, start_time: `${day}T07:00:00Z`, end_time: `${day}T08:00:00Z`, updated_at: `${day}T08:00:00Z`, created_at: `${day}T08:00:00Z`,
  exercises: [{ index: 0, title: exercise, notes: null, superset_id: null, sets: [set(weight_kg, reps)] }],
});
const initial = [
  workout('harbor-strength', 'Harbor Strength', '2026-11-02', 'Scenario Squat', 42, 8),
  workout('canal-pull', 'Canal Pull', '2026-11-01', 'Scenario Row', 31, 10),
];
const changed = [
  workout('harbor-strength', 'Harbor Strength', '2026-11-02', 'Scenario Squat', 45, 8),
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
  if (url.pathname === '/v1/user/info') return json(req, res, 200, { data: { id: 'scenario-owner', name: 'Scenario Owner' } });
  if (url.pathname === '/v1/workouts/count') return json(req, res, 200, { workout_count: rows.length });
  if (url.pathname === '/v1/workouts/events') {
    const events = (await readState()).changed ? [{ type: 'updated', workout: changed[0] }, { type: 'deleted', id: 'canal-pull', deleted_at: '2026-11-03T08:00:00Z' }] : [];
    return json(req, res, 200, { page: 1, page_count: 1, events });
  }
  if (url.pathname === '/v1/workouts') {
    if (Number(url.searchParams.get('page') || 1) > 1) return json(req, res, 404, { error: 'Page not found' });
    return json(req, res, 200, { page: 1, page_count: 1, workouts: rows });
  }
  if (url.pathname.startsWith('/v1/workouts/')) {
    const found = rows.find(row => row.id === url.pathname.split('/').at(-1));
    return json(req, res, found ? 200 : 404, found || { error: 'missing' });
  }
  if (url.pathname === '/v1/exercise_templates') return json(req, res, 200, { page: 1, page_count: 1, exercise_templates: [{ id: 'scenario-squat', title: 'Scenario Squat' }, { id: 'scenario-row', title: 'Scenario Row' }] });
  return json(req, res, 404, { error: 'missing' });
});
// Loopback unless the scenario names another address: its Docker server reaches the host through
// host.docker.internal, the bridge's address, which a loopback-only listener never answers.
server.listen(port, process.env.GODSPEED_HEVY_FIXTURE_HOST || '127.0.0.1', () => process.stdout.write(`${server.address().port}\n`));
process.on('SIGTERM', () => server.close());

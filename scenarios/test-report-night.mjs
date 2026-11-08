// node --test scenarios/test-report-night.mjs
// report-night.mjs against a stand-in for GitHub: a local server that keeps the calls it receives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./report-night.mjs', import.meta.url));
const WORKFLOW = fileURLToPath(new URL('../.github/workflows/scenarios.yml', import.meta.url));

// state: { openIssues: [{number,title}], labelExists, logs: {jobName: text}, jobs: [{id,name,conclusion}] }
async function night(results, state = {}, extra = {}) {
  const calls = [];
  const st = { openIssues: [], labelExists: true, jobs: [], logs: {}, ...state };
  let next = 100;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace('/repos/o/r', '');
      calls.push({ method: req.method, path: p, body });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      if (req.method === 'GET' && p === '/labels/scenario-failure') return send(st.labelExists ? 200 : 404, {});
      if (req.method === 'POST' && p === '/labels') return send(201, {});
      if (req.method === 'GET' && p === '/issues') return send(200, url.searchParams.get('page') === '1' ? st.openIssues : []);
      if (req.method === 'POST' && p === '/issues') return send(201, { number: next++ });
      if (req.method === 'POST' && /^\/issues\/\d+\/comments$/.test(p)) return send(201, {});
      if (req.method === 'PATCH' && /^\/issues\/\d+$/.test(p)) return send(200, {});
      if (req.method === 'GET' && p === '/actions/runs/77/jobs') return send(200, { jobs: st.jobs });
      const m = p.match(/^\/actions\/jobs\/(\d+)\/logs$/);
      if (m) { const j = st.jobs.find((x) => String(x.id) === m[1]); return send(200, st.logs[j.name] ?? ''); }
      send(404, { message: 'not stubbed' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = {
    PATH: process.env.PATH, GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '77',
    GITHUB_SERVER_URL: 'https://github.example', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    NIGHT: '2026-11-03', WORKFLOW_FILE: WORKFLOW, RESULTS: results, ...extra,
  };
  const out = await new Promise((resolve) => {
    const c = spawn(process.execPath, [SCRIPT], { env });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.stderr.on('data', (d) => (stderr += d));
    c.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  server.close();
  const where = (method, re) => calls.filter((c) => c.method === method && re.test(c.path));
  return { ...out, calls, created: where('POST', /^\/issues$/), comments: where('POST', /comments$/), patches: where('PATCH', /^\/issues\//), labelsMade: where('POST', /^\/labels$/) };
}

const T = (name) => `Nightly scenario failed: ${name}`;

test('a failed scenario with no issue opens one', async () => {
  const r = await night('voice=failure', {
    jobs: [{ id: 5, name: 'a voice note, with the permission and without it', conclusion: 'failure' }],
    logs: { 'a voice note, with the permission and without it': '2026-11-03T02:40:00.1234567Z fine\n2026-11-03T02:41:00.0000000Z FAIL voice: no sound came back\n' },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.created.length, 1);
  const c = r.created[0].body;
  assert.equal(c.title, T('voice'));
  assert.deepEqual(c.labels, ['bug', 'scenario-failure']);
  assert.match(c.body, /2026-11-03/);
  assert.match(c.body, /https:\/\/github\.example\/o\/r\/actions\/runs\/77/);
  assert.match(c.body, /FAIL voice: no sound came back/);
  assert.doesNotMatch(c.body, /02:41:00/);
  assert.equal(r.comments.length, 0);
});

test('a failed scenario with an open issue adds a comment and opens nothing', async () => {
  const r = await night('voice=failure', { openIssues: [{ number: 12, title: T('voice') }] });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.created.length, 0);
  assert.equal(r.comments.length, 1);
  assert.equal(r.comments[0].path, '/issues/12/comments');
  assert.match(r.comments[0].body.body, /2026-11-03/);
  assert.equal(r.patches.length, 0);
});

test('a passed scenario with an open issue closes it', async () => {
  const r = await night('voice=success late-reminder-file=success', { openIssues: [{ number: 12, title: T('voice') }] });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.created.length, 0);
  assert.equal(r.comments.length, 1);
  assert.match(r.comments[0].body.body, /actions\/runs\/77/);
  assert.equal(r.patches.length, 1);
  assert.equal(r.patches[0].path, '/issues/12');
  assert.equal(r.patches[0].body.state, 'closed');
});

test('a passed scenario with no open issue does nothing', async () => {
  const r = await night('voice=success');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.created.length + r.comments.length + r.patches.length, 0);
});

test('a scenario that did not run counts as failed', async () => {
  const r = await night('voice=skipped docker-server=cancelled linux-update=', { jobs: [{ id: 6, name: 'a stranger\'s Docker server', conclusion: 'skipped' }] }, { STAGE: 'failure' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.created.map((c) => c.body.title).sort(), [T('docker-server'), T('linux-update'), T('voice')]);
  assert.match(r.created.find((c) => c.body.title === T('docker-server')).body.body, /did not run/);
});

test('two failures open two issues', async () => {
  const r = await night('voice=failure docker-server=failure linux-install=success');
  assert.equal(r.created.length, 2);
  assert.deepEqual(r.created.map((c) => c.body.title).sort(), [T('docker-server'), T('voice')]);
});

test('a scenario named twice opens one issue', async () => {
  const r = await night('voice=failure voice=failure');
  assert.equal(r.created.length, 1);
});

test('the label is created when it is missing, and only then', async () => {
  assert.equal((await night('voice=failure', { labelExists: false })).labelsMade.length, 1);
  assert.equal((await night('voice=failure')).labelsMade.length, 0);
});

test('a job that only runs for a candidate is left out', async () => {
  const r = await night('mac-install=skipped voice=failure', {}, { CANDIDATE_ONLY: 'mac-install' });
  assert.deepEqual(r.created.map((c) => c.body.title), [T('voice')]);
});

test('a report that cannot be made fails loudly', async () => {
  const r = await night('voice=failure', {}, { GITHUB_RUN_ID: '' });
  assert.notEqual(r.code, 0);
});

// The verdict job lists its scenarios twice: `needs:` (so it waits for them) and `RESULTS` (the
// only place a failure becomes a failed verdict). A scenario added to one list and not the other
// would be waited for and never judged, or judged and never waited for. No YAML parser is a
// dependency of this test, so the needed parts are read as text.
test("the verdict's needs and RESULTS name the same scenarios, and every scenario job is in both", async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const jobsText = text.slice(text.indexOf('\njobs:\n'));
  assert.ok(jobsText.length > 10, 'no jobs: section found');
  const jobs = [...jobsText.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)].map((m) => m[1]);
  assert.ok(jobs.includes('stage') && jobs.includes('verdict'), 'stage and verdict jobs not found');
  const body = jobsText.slice(jobsText.search(/^ {2}verdict:[ \t]*$/m));
  const needsLine = body.match(/^ {4}needs:\s*\[([^\]]*)\]/m);
  assert.ok(needsLine, 'verdict has no needs: [ ... ] list');
  const needs = needsLine[1].split(',').map((x) => x.trim()).filter(Boolean).filter((x) => x !== 'stage');
  const res = body.match(/^ {6}RESULTS: >-\n((?: {8}.*\n)+)/m);
  assert.ok(res, 'verdict has no RESULTS block');
  const pairs = res[1].trim().split('\n').map((l) => l.trim()).map((p) => {
    const m = p.match(/^([A-Za-z0-9_-]+)=\$\{\{ *needs\.([A-Za-z0-9_-]+)\.result *\}\}$/);
    assert.ok(m, `RESULTS entry is not <job>=\${{ needs.<job>.result }}: ${p}`);
    assert.equal(m[2], m[1], `RESULTS key ${m[1]} reads the result of ${m[2]}`);
    return m[1];
  });
  assert.equal(new Set(needs).size, needs.length, 'duplicate in needs');
  assert.equal(new Set(pairs).size, pairs.length, 'duplicate in RESULTS');
  assert.deepEqual([...pairs].sort(), [...needs].sort(), 'needs (minus stage) and RESULTS differ');
  const scenarios = jobs.filter((j) => j !== 'stage' && j !== 'verdict');
  assert.ok(scenarios.length > 5, 'too few scenario jobs found');
  for (const j of scenarios) {
    assert.ok(needs.includes(j), `scenario job ${j} is not in the verdict's needs`);
    assert.ok(pairs.includes(j), `scenario job ${j} is not in RESULTS`);
  }
});

// Each of beta.20's four jobs runs the scenario its name says, at the stage the run was started for.
test('the four beta.20 jobs check out the selected stage and run their own scenario', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  for (const j of ['workouts-from-hevy', 'day-becomes-facts', 'hermes-update-rollback', 'first-day']) {
    const start = text.search(new RegExp(`^ {2}${j}:[ \t]*$`, 'm'));
    assert.ok(start >= 0, `no job ${j}`);
    const rest = text.slice(start + 1);
    const end = rest.search(/^ {2}[A-Za-z0-9_-]+:[ \t]*$/m);
    const block = end < 0 ? rest : rest.slice(0, end);
    assert.ok(block.includes('ref: ${{ inputs.stage || github.sha }}'), `${j} does not check out the selected stage`);
    assert.ok(block.includes(`bash scenarios/${j}.sh "$STAGE_REF"`), `${j} does not run scenarios/${j}.sh at the stage`);
    assert.equal((block.match(/bash scenarios\/[a-z-]+\.sh/g) || []).length, 1, `${j} runs more than its own scenario`);
  }
});

// talk-prep-honest keeps what it saw even when it fails, so a failed candidate can still be judged.
// The folder it uploads is the scenario's own evidence folder: scenario-lib.sh derives it as
// $RUNNER_TEMP/$SCENARIO, and SCENARIO is declared in scenarios/talk-prep-honest.sh. The workflow
// repeats that name, so this test reads it from the scenario and holds the two together.
test('talk-prep-honest always uploads its own evidence folder and fails when it is missing', async () => {
  const { readFileSync } = await import('node:fs');
  const scenarioFile = fileURLToPath(new URL('./talk-prep-honest.sh', import.meta.url));
  const libFile = fileURLToPath(new URL('./scenario-lib.sh', import.meta.url));
  const declared = readFileSync(scenarioFile, 'utf8').match(/^SCENARIO=([A-Za-z0-9_-]+)[ \t]*$/m);
  assert.ok(declared, 'scenarios/talk-prep-honest.sh declares no SCENARIO=');
  const name = declared[1];
  assert.match(readFileSync(libFile, 'utf8'), /EVIDENCE=\$\{GODSPEED_SCENARIO_WORK:-\$\{RUNNER_TEMP:-\/tmp\}\}\/\$SCENARIO/,
    'scenario-lib.sh no longer derives the evidence folder as $RUNNER_TEMP/$SCENARIO');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const start = text.search(/^ {2}talk-prep-honest:[ \t]*$/m);
  assert.ok(start >= 0, 'no job talk-prep-honest');
  const rest = text.slice(start + 1);
  const end = rest.search(/^ {2}[A-Za-z0-9_-]+:[ \t]*$/m);
  const block = end < 0 ? rest : rest.slice(0, end);
  assert.ok(block.includes(`bash scenarios/${name}.sh "$STAGE_REF"`), `the job does not run scenarios/${name}.sh`);
  const steps = block.split(/\n(?= {6}- )/).filter((s) => /^ {6}- /.test(s));
  const uploads = steps.filter((s) => s.includes('actions/upload-artifact@'));
  assert.equal(uploads.length, 1, 'talk-prep-honest should have exactly one upload step');
  const up = uploads[0];
  const field = (k) => (up.match(new RegExp(`^ +${k}: *(.+?)[ \\t]*$`, 'm')) || [])[1];
  assert.equal(field('if'), 'always()', 'the evidence upload must run even when the scenario fails');
  assert.equal(field('uses'), 'actions/upload-artifact@v4');
  assert.equal(field('name'), `${name}-evidence`, 'artifact name');
  assert.equal(field('path'), `\${{ runner.temp }}/${name}`, "the uploaded folder is not the scenario's own evidence folder");
  assert.equal(field('if-no-files-found'), 'error', 'a missing evidence folder must fail the step');
  assert.equal(field('continue-on-error'), undefined, 'a failed evidence upload must fail the job, so no continue-on-error');
  assert.doesNotMatch(block, /^ {4}continue-on-error:/m, 'talk-prep-honest must fail when its evidence upload fails, so no job-level continue-on-error');
});

// The product version is owned by notebook/package.json; the README's newest "New in" heading must name it.
test("the README's newest 'New in' heading is the package version", async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../notebook/package.json', import.meta.url), 'utf8'));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const heading = readme.match(/^## New in (\S+)/m);
  assert.ok(heading, 'README has no "New in" heading');
  assert.equal(heading[1], pkg.version);
});

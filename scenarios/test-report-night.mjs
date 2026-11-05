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

// The four beta.17 jobs run the stage's own copy of their scenario: the checkout takes the stage
// ref when one is given, the stage artifact is downloaded when none is, and the scenario gets the
// stage ref. A job that loses one of the three runs another version's scenario, silently.
for (const job of ['no-question-he-cannot-judge', 'plain-yes', 'what-was-that', 'connection-check']) {
  test(`the ${job} job takes the stage handoff: checkout ref, stage download, scenario run`, async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
    const start = text.search(new RegExp(`^ {2}${job}:[ \t]*$`, 'm'));
    assert.ok(start >= 0, `job ${job} not found`);
    const rest = text.slice(start + 1);
    const next = rest.search(/^ {2}[A-Za-z0-9_-]+:[ \t]*$/m);
    const body = next >= 0 ? rest.slice(0, next) : rest;
    const steps = body.split(/^ {6}- /m).slice(1);
    const checkout = steps.find((s) => s.startsWith('uses: actions/checkout@v4'));
    assert.ok(checkout, `${job} has no actions/checkout@v4 step`);
    assert.match(checkout, /^ {10}ref: \$\{\{ inputs\.stage \|\| github\.sha \}\}$/m, `${job}: checkout ref`);
    const download = steps.find((s) => s.startsWith('uses: actions/download-artifact@v4'));
    assert.ok(download, `${job} has no actions/download-artifact@v4 step`);
    assert.match(download, /^ {8}if: \$\{\{ !inputs\.stage \}\}$/m, `${job}: download condition`);
    assert.match(download, /^ {10}name: run-stage$/m, `${job}: download name`);
    assert.match(download, /^ {10}path: \$\{\{ runner\.temp \}\}\/run-stage$/m, `${job}: download path`);
    assert.ok(body.includes(`bash scenarios/${job}.sh "$STAGE_REF"`), `${job} does not run its scenario with "$STAGE_REF"`);
  });
}

// A failing scenario fails its job: a step that pipes a scenario into tee must declare
// `shell: bash`, because only an explicit shell runs as `bash --noprofile --norc -e -o pipefail`
// (seen in scenarios run 41871435090: the Charm Challenge step ended with exit code 1 and its job
// and the verdict failed). A step with no `shell:` runs as `bash -e {0}`, without pipefail, and
// tee would hide the scenario's exit code.
test('every step that pipes a scenario into tee declares shell: bash (pipefail)', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const steps = text.slice(text.indexOf('\njobs:\n')).split(/^ {6}- /m).slice(1);
  const piped = steps.filter((s) => /^ {8}run: .*bash scenarios\/\S+.*\|\s*tee\b/m.test(s));
  assert.ok(piped.length > 10, `too few scenario pipes found (${piped.length})`);
  for (const s of piped) {
    const name = (s.match(/run: .*?(scenarios\/\S+)/) || [])[1];
    assert.match(s, /^ {8}shell: bash$/m, `the step running ${name} pipes into tee without an explicit shell: bash`);
  }
});

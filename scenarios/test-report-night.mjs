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
    assert.ok(block.includes('ref: ${{ inputs.stage || github.event.pull_request.head.sha || github.sha }}'), `${j} does not check out the selected stage (or a pull request's own head)`);
    assert.ok(block.includes(`bash scenarios/${j}.sh "$STAGE_REF"`), `${j} does not run scenarios/${j}.sh at the stage`);
    assert.equal((block.match(/bash scenarios\/[a-z-]+\.sh/g) || []).length, 1, `${j} runs more than its own scenario`);
  }
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

// A pull request runs only the scenarios whose script it changed (the stage job's `picked`). That
// works only while every job that runs `bash scenarios/<x>.sh "$STAGE_REF"` is the job `<x>` and is
// gated by `picked` on its own name, so a new scenario cannot silently be left out of the proof.
test('every scenario job named like its script is gated by the pull request pick, on its own name', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const jobsText = text.slice(text.indexOf('\njobs:\n'));
  const starts = [...jobsText.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)];
  let checked = 0;
  for (let i = 0; i < starts.length; i++) {
    const name = starts[i][1];
    const block = jobsText.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const scripts = [...block.matchAll(/bash scenarios\/([a-z0-9-]+)\.sh "\$STAGE_REF"/g)].map((m) => m[1]);
    if (!scripts.length) continue;
    assert.deepEqual(scripts, [name], `job ${name} runs scenarios/${scripts.join(', ')}.sh: a job runs the script of its own name`);
    assert.ok(block.includes(`if: \${{ needs.stage.outputs.picked == 'all' || contains(needs.stage.outputs.picked, ',${name},') }}`), `job ${name} is not gated by the pull request pick`);
    checked++;
  }
  assert.ok(checked >= 20, `only ${checked} scenario jobs found`);
});

// The pick itself, run the way the stage job runs it, on a made-up list of changed files.
test('the pick names the scenarios whose script or owned file changed, and nothing else', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const at = text.indexOf('          jobs=$(grep -oE');
  const to = text.indexOf('          echo "The pull request changes');
  assert.ok(at > 0 && to > at, 'the pick step was not found');
  const dir = mkdtempSync(`${tmpdir()}/pick-`).replaceAll(String.fromCharCode(92), '/');
  writeFileSync(`${dir}/changed`, ['scenarios/voice.sh', 'scenarios/hevy-fixture.mjs', 'scenarios/plain-yes-extra.py', 'scenarios/scenario-lib.sh', 'scenarios/test-scenarios.sh', 'notebook/voice.sh', 'scenarios/windows-old-names-move.ps1'].join('\n') + '\n');
  const script = `RUNNER_TEMP='${dir}'\n` + text.slice(at, to).replace(/^ {10}/gm, '') + 'echo "$picked"';
  const r = spawnSync('bash', ['-c', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), ',plain-yes,voice,');
});

// A pull request proves its own head commit: GitHub's merge commit is not promised to be fetchable
// by the installer, which reads the product by commit. Every path that makes or reads the proof
// (the stage's checkout and its stage file, and the checkout of every scenario job) must say so.
test("the stage and every scenario job prove the pull request's own head commit", async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const head = 'ref: ${{ inputs.stage || github.event.pull_request.head.sha || github.sha }}';
  const jobsText = text.slice(text.indexOf('\njobs:\n'));
  const starts = [...jobsText.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)];
  const blockOf = (name) => {
    const i = starts.findIndex((m) => m[1] === name);
    assert.ok(i >= 0, `no job ${name}`);
    return jobsText.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : undefined);
  };
  const stage = blockOf('stage');
  assert.ok(stage.includes(head), 'the stage job does not check out the pull request head');
  assert.ok(stage.includes('PROOF_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'), 'the stage job has no PROOF_SHA of the pull request head');
  assert.ok(stage.includes('scenarios/stage-for-run.sh \'\' "$PROOF_SHA"'), 'the stage file is not made from PROOF_SHA');
  assert.ok(!stage.includes('"$GITHUB_SHA"'), 'the stage job still reads GITHUB_SHA');
  let checked = 0;
  for (const m of starts) {
    const block = blockOf(m[1]);
    if (!/bash scenarios\/[a-z0-9-]+\.sh "\$STAGE_REF"/.test(block)) continue;
    assert.ok(block.includes(head), `${m[1]} does not check out the pull request head`);
    assert.ok(!/ref: \$\{\{ inputs\.stage \|\| github\.sha \}\}/.test(block), `${m[1]} checks out GitHub's merge commit`);
    checked++;
  }
  assert.ok(checked >= 20, `only ${checked} scenario jobs found`);
});

// A pull request from a fork has no secrets and may carry hostile scenario code: the stage job is
// skipped for it, every scenario needs the stage, and the verdict then passes with a plain line.
test('a pull request from a fork runs nothing, and its verdict passes', async () => {
  const { readFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const jobsText = text.slice(text.indexOf('\njobs:\n'));
  const starts = [...jobsText.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)];
  const blockOf = (name) => {
    const i = starts.findIndex((m) => m[1] === name);
    return jobsText.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : undefined);
  };
  assert.ok(blockOf('stage').includes("if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"), 'the stage job does not skip a fork pull request');
  for (const m of starts) {
    const block = blockOf(m[1]);
    if (!/bash scenarios\/[a-z0-9-]+\.sh "\$STAGE_REF"/.test(block)) continue;
    assert.match(block, /^ {4}needs: stage$/m, `${m[1]} does not need the stage job, so a fork pull request could run it`);
  }
  const verdict = blockOf('verdict');
  const at = verdict.indexOf('          bad=0\n');
  const to = verdict.indexOf('      - name: Tell the night in issues');
  assert.ok(at > 0 && to > at, 'the verdict step was not found');
  const script = verdict.slice(at, to).replace(/^ {10}/gm, '');
  const run = (env) => spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '/dev/null', STAGE_REF: 'this-commit', WANT_MAC: 'false', IS_CANDIDATE: 'false', RESULTS: 'voice=skipped plain-yes=skipped', PICKED: '', ...env } });
  const fork = run({ EVENT: 'pull_request', STAGE: 'skipped' });
  assert.equal(fork.status, 0, fork.stdout + fork.stderr);
  assert.match(fork.stdout, /No scenario runs on a pull request from a fork/);
  // the same skips on a night, or a skipped stage that is not a fork's pull request, still fail
  assert.equal(run({ EVENT: 'schedule', STAGE: 'skipped' }).status, 1);
  assert.equal(run({ EVENT: 'pull_request', STAGE: 'success', PICKED: ',voice,' }).status, 1, 'a picked scenario that did not run must fail');
  assert.equal(run({ EVENT: 'pull_request', STAGE: 'success', PICKED: ',' }).status, 0, 'an unpicked skip must pass');
});

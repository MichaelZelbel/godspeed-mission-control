// node --test scenarios/test-report-night.mjs
// report-night.mjs against a stand-in for GitHub: a local server that keeps the calls it receives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalogRows } from './scenario-verdict.mjs';

const SCRIPT = fileURLToPath(new URL('./report-night.mjs', import.meta.url));
const WORKFLOW = fileURLToPath(new URL('../.github/workflows/scenarios.yml', import.meta.url));
const DRAFT = fileURLToPath(new URL('../.github/workflow-drafts/scenarios.yml', import.meta.url));
const PICKER = fileURLToPath(new URL('./pick-scenarios.sh', import.meta.url));

function workflowJobs(draft) {
  const headers = [...draft.matchAll(/^  ([a-z0-9-]+):\n/gm)];
  return headers.map((header, index) => ({
    id: header[1],
    body: draft.slice(header.index, headers[index + 1]?.index),
  }));
}

const pickedOnly = (id) => `(needs.stage.outputs.picked == 'all' || contains(needs.stage.outputs.picked, ',${id},'))`;
const windowsGuard = `startsWith(inputs.stage, 'candidate/') && ${pickedOnly('windows-old-names-move')}`;
const candidateGuards = new Map([
  ['mac-install', `\${{ inputs.mac && startsWith(inputs.stage, 'candidate/') && ${pickedOnly('mac-install')} }}`],
  ['windows-old-names-move', `\${{ ${windowsGuard} }}`],
]);

const jobCondition = ({ body }) => body.match(/^    if: ([^\r\n]+)$/m)?.[1];

function assertCandidateEligibilityConforms(catalog, draft) {
  const candidateIds = catalogRows(catalog).filter(({ candidateOnly }) => candidateOnly).map(({ id }) => id).sort();
  assert.deepEqual(candidateIds, [...candidateGuards.keys()].sort());
  const jobs = workflowJobs(draft);
  assert.deepEqual(
    jobs.map((job) => ({ id: job.id, condition: jobCondition(job) }))
      .filter(({ condition }) => condition?.includes("startsWith(inputs.stage, 'candidate/')")),
    [...candidateGuards].map(([id, condition]) => ({ id, condition })),
  );
  for (const [id, condition] of candidateGuards) {
    const job = jobs.find((item) => item.id === id);
    assert.ok(job, `${id} must have a workflow job`);
    assert.equal(jobCondition(job), condition, `${id} must keep its exact candidate-only guard`);
  }
}

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
  assert.deepEqual(c.labels, ['bug', 'scenario-failure', 'archon-triage']);
  assert.match(c.body, /2026-11-03/);
  assert.match(c.body, /https:\/\/github\.example\/o\/r\/actions\/runs\/77/);
  assert.match(c.body, /FAIL voice: no sound came back/);
  assert.doesNotMatch(c.body, /02:41:00/);
  assert.equal(r.comments.length, 0);
});

test('a pooled failure reports its exact scenario verdict before a shared job log', async () => {
  const r = await night('voice=failure', {
    jobs: [{ id: 5, name: 'the installed Linux and Docker scenarios', conclusion: 'failure' }],
    logs: { 'the installed Linux and Docker scenarios': 'shared job log' },
  }, { SCENARIO_VERDICTS: 'FAIL voice: no sound came back\nPASS plain-yes: approved' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.created[0].body.body, /FAIL voice: no sound came back/);
  assert.doesNotMatch(r.created[0].body.body, /shared job log/);
});

test("the collector's verdict lines alone say which scenarios failed and which passed", async () => {
  const r = await night('', { openIssues: [{ number: 12, title: T('plain-yes') }] },
    { SCENARIO_VERDICTS: 'FAIL voice: no result record\nPASS plain-yes: approved' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.created.map((c) => c.body.title), [T('voice')]);
  assert.match(r.created[0].body.body, /voice failed\.[\s\S]*FAIL voice: no result record/);
  assert.deepEqual(r.patches.map((p) => p.path), ['/issues/12']);
});

test('verdict lines that are set but hold no verdict fail the report instead of passing the night silently', async () => {
  const r = await night('voice=failure', {}, { SCENARIO_VERDICTS: '' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /SCENARIO_VERDICTS holds no scenario verdict/);
  assert.equal(r.created.length, 0);
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

test('the protected draft pools candidate systems and leaves the live workflow unchanged', async () => {
  const { readFileSync } = await import('node:fs');
  const draft = readFileSync(DRAFT, 'utf8');
  const live = readFileSync(WORKFLOW, 'utf8');
  assert.match(draft, /^  pooled:\n    name: the installed Linux and Docker scenarios/m);
  assert.match(draft, /bash scenarios\/run-installed-scenarios\.sh "\$STAGE_REF"/);
  assert.match(draft, /args=\(--catalog scenarios\/scenario-catalog\.tsv /);
  assert.doesNotMatch(live, /run-installed-scenarios\.sh/);
  assert.match(draft, /picked=\$\(bash scenarios\/pick-scenarios\.sh "\$RUNNER_TEMP\/changed"\)/);
  const pooled = draft.slice(draft.indexOf('  pooled:'), draft.indexOf('\n  mac-install:'));
  assert.match(pooled, /PRODUCT: \$\{\{ needs\.stage\.outputs\.product \}\}/);
  assert.match(pooled, /ENGINE: \$\{\{ needs\.stage\.outputs\.engine \}\}/);
  assert.match(pooled, /IMAGE: \$\{\{ needs\.stage\.outputs\.image \}\}/);
  const verdict = draft.slice(draft.indexOf('  verdict:'));
  assert.match(verdict, /uses: actions\/checkout@v4\n        with:\n          ref: \$\{\{ inputs\.stage \|\| github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.doesNotMatch(verdict, /CANDIDATE_ONLY:|--candidate-only/);
  assert.match(verdict, /\[ "\$IS_CANDIDATE" = true \] && args\+=\(--include-candidate-only\)/);
  assert.match(verdict, /\[ "\$WANT_MAC" = true \] \|\| args\+=\(--exclude mac-install\)/);
  const mac = draft.slice(draft.indexOf('  mac-install:'), draft.indexOf('\n  docker-server:'));
  assert.ok(mac.includes(`    if: ${candidateGuards.get('mac-install')}\n`), 'the Mac job keeps its candidate-only guard');
});

test('candidate-only catalog membership and candidate job guards stay conformant', async () => {
  const { readFileSync } = await import('node:fs');
  const catalog = readFileSync(new URL('./scenario-catalog.tsv', import.meta.url), 'utf8');
  const draft = readFileSync(DRAFT, 'utf8');
  assertCandidateEligibilityConforms(catalog, draft);
});

test('a broadened Windows candidate-only guard is rejected', async () => {
  const { readFileSync } = await import('node:fs');
  const catalog = readFileSync(new URL('./scenario-catalog.tsv', import.meta.url), 'utf8');
  const draft = readFileSync(DRAFT, 'utf8');
  const broadened = draft.replace(
    `if: \${{ ${windowsGuard} }}`,
    `if: \${{ ${windowsGuard} || github.event_name == 'workflow_dispatch' }}`,
  );
  assert.notEqual(broadened, draft, 'the Windows guard to broaden is missing');
  assert.throws(
    () => assertCandidateEligibilityConforms(catalog, broadened),
    /Expected values to be strictly deep-equal/,
  );
});

test('the verdict collector fails when a scenario verdict fails behind tee', async () => {
  const { readFileSync } = await import('node:fs');
  const draft = readFileSync(DRAFT, 'utf8').replace(/\r\n/g, '\n');
  const start = draft.indexOf('      - name: Every selected scenario has a verdict, or the run fails\n');
  assert.ok(start >= 0, 'no scenario verdict step');
  const rest = draft.slice(start + 1);
  const end = rest.indexOf('\n      - name: Tell the night in issues');
  const step = end < 0 ? rest : rest.slice(0, end);
  assert.match(step, /^        shell: bash$/m,
    'the verdict pipe must use GitHub Actions bash pipefail semantics');
  assert.match(step, /scenario-verdict\.mjs "\$\{args\[@\]\}" \| tee/);
  assert.doesNotMatch(step, /^        continue-on-error:/m);
});

test('the draft collects the verdicts once and the night reports from that same file, even when the stage failed', async () => {
  const { readFileSync, writeFileSync, mkdtempSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const draft = readFileSync(DRAFT, 'utf8').replace(/\r\n/g, '\n');
  const verdict = draft.slice(draft.search(/^ {2}verdict:[ \t]*$/m));
  const runOf = (name) => {
    const at = verdict.indexOf(`      - name: ${name}`);
    assert.ok(at >= 0, `no step ${name}`);
    const body = verdict.slice(at).match(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/m);
    return body[1].replace(/^ {10}/gm, '');
  };
  const collect = runOf('Every selected scenario has a verdict, or the run fails');
  const tell = runOf('Tell the night in issues');
  assert.equal((verdict.match(/node scenarios\/scenario-verdict\.mjs/g) || []).length, 1, 'the verdicts are collected more than once');
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const run = (STAGE) => {
    const dir = mkdtempSync(`${tmpdir()}/draft-verdict-`);
    mkdirSync(`${dir}/scenario-results`);
    if (STAGE === 'success') writeFileSync(`${dir}/scenario-results/voice.txt`, 'PASS voice: heard\n');
    const env = { ...process.env, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: `${dir}/summary`, STAGE_REF: 'main', EVENT: 'schedule', STAGE, PICKED: STAGE === 'success' ? 'all' : '', PR_IMAGE: 'skipped', IS_CANDIDATE: 'false', WANT_MAC: '' };
    const collected = spawnSync('bash', ['-eo', 'pipefail', '-c', collect], { cwd: repo, encoding: 'utf8', env });
    // report-night itself is tested above; here only what the night step hands it
    const handed = spawnSync('bash', ['-e', '-c', tell.replace('node scenarios/report-night.mjs', 'printf %s "$SCENARIO_VERDICTS"')], { cwd: repo, encoding: 'utf8', env });
    return { collected, handed };
  };
  const rows = catalogRows(readFileSync(fileURLToPath(new URL('./scenario-catalog.tsv', import.meta.url)), 'utf8')).filter((row) => !row.candidateOnly);
  const failed = run('failure');
  assert.equal(failed.collected.status, 1, 'a failed stage must fail the verdict');
  assert.equal(failed.handed.status, 0, failed.handed.stderr);
  assert.deepEqual(failed.handed.stdout.split('\n').map((line) => line.split(':')[0]), rows.map((row) => `FAIL ${row.id}`),
    'a failed stage must still hand the night every scenario, failed');
  const ran = run('success');
  assert.equal(ran.handed.status, 0, ran.handed.stderr);
  assert.match(ran.handed.stdout, /^PASS voice: heard$/m);
});

test('the draft picker selects every standalone scenario for workflow and scenario support changes', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const catalog = readFileSync(new URL('./scenario-catalog.tsv', import.meta.url), 'utf8');
  const allScripts = `,${catalog.split('\n').filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t')).filter(([, implementation]) => implementation.endsWith('.sh'))
    .map(([id]) => id).join(',')},`;
  const pick = (files) => {
    const dir = mkdtempSync(`${tmpdir()}/draft-pick-`).replaceAll(String.fromCharCode(92), '/');
    const changed = `${dir}/changed`;
    writeFileSync(changed, `${files.join('\n')}\n`);
    const result = spawnSync('bash', [PICKER, changed], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const sharedInputs = [
    '.github/workflows/scenarios.yml',
    '.github/workflow-drafts/scenarios.yml',
    'scenarios/capture-scenario-result.sh',
    'scenarios/pick-scenarios.sh',
    'scenarios/run-installed-scenarios.sh',
    'scenarios/scenario-catalog.tsv',
    'scenarios/scenario-lib.sh',
    'scenarios/scenario-verdict.mjs',
    'scenarios/server-lib.sh',
    'scenarios/telegram-through-hermes.py',
    'scenarios/numbers-lib.sh',
    'scenarios/hevy-fixture.mjs',
    'scenarios/facts-lib.sh',
    'scenarios/telegram-judge.mjs',
    'scenarios/server-telegram.mjs',
    'scenarios/scenario-asker.py',
  ];
  for (const input of sharedInputs) assert.equal(pick([input]), allScripts, `${input} must prove every standalone scenario`);
  assert.equal(pick(['scenarios/new-shared-helper.mjs']), allScripts, 'an unowned scenario support path must prove every standalone scenario');
  assert.equal(pick(['scenarios/voice-through-hermes.py']), ',voice,', 'voice-through-hermes.py is voice\'s named companion');
  assert.equal(pick(['scenarios/voice.sh']), ',voice,');
  assert.equal(pick(['scenarios/plain-yes-extra.py']), ',plain-yes,');
  assert.equal(pick(['README.md']), ',');
});

test('the draft stage handoff writes the complete picker result for a changed support helper', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const draft = readFileSync(DRAFT, 'utf8').replace(/\r\n/g, '\n');
  const catalog = readFileSync(new URL('./scenario-catalog.tsv', import.meta.url), 'utf8');
  const allScripts = `,${catalog.split('\n').filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t')).filter(([, implementation]) => implementation.endsWith('.sh'))
    .map(([id]) => id).join(',')},`;
  const stepStart = draft.indexOf('      - name: Which scenarios this run proves\n');
  const stepEnd = draft.indexOf('\n      - name:', stepStart + 1);
  assert.ok(stepStart >= 0 && stepEnd > stepStart, 'the draft pick step was not found');
  const step = draft.slice(stepStart, stepEnd);
  const runStart = step.indexOf('        run: |\n');
  assert.ok(runStart >= 0, 'the draft pick step has no shell block');
  const script = step.slice(runStart + '        run: |\n'.length).split('\n')
    .filter((line) => line.startsWith('          ')).map((line) => line.slice(10)).join('\n');
  assert.ok(script.includes('pick-scenarios.sh'), 'the draft pick block does not invoke the picker');
  const dir = mkdtempSync(`${tmpdir()}/draft-stage-pick-`).replaceAll(String.fromCharCode(92), '/');
  const bin = `${dir}/bin`;
  const output = `${dir}/github-output`;
  const summary = `${dir}/github-summary`;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(bin);
  writeFileSync(`${bin}/gh`, '#!/bin/sh\nprintf "%s\\n" scenarios/numbers-lib.sh\n', { mode: 0o755 });
  const result = spawnSync('bash', ['-c', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_REPOSITORY: 'o/r',
      PR: '123',
      RUNNER_TEMP: dir,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), `picked=${allScripts}\n`);
});

test('the draft verdict waits for pooled records and downloads them before collecting verdicts', async () => {
  const { readFileSync } = await import('node:fs');
  const draft = readFileSync(DRAFT, 'utf8').replace(/\r\n/g, '\n');
  const verdict = draft.slice(draft.search(/^ {2}verdict:[ \t]*$/m));
  assert.match(verdict, /^ {4}needs: \[[^\]]*\bpooled\b[^\]]*\]/m, 'the verdict must wait for the pooled producer');
  const download = verdict.indexOf('actions/download-artifact@v4');
  const collector = verdict.indexOf('node scenarios/scenario-verdict.mjs');
  assert.ok(download >= 0 && download < collector, 'the verdict must download result artifacts before collecting them');
  assert.match(verdict.slice(download, collector), /merge-multiple: true/, 'the pooled result artifact must be merged into the collector directory');
  assert.match(verdict.slice(download, collector), /pattern: '\*-result\*'/, 'only result artifacts may reach the collector, never an evidence folder');
  const notVerdicts = [...draft.matchAll(/^ +(?:with: \{ )?name: ([^\s,]+)/gm)].map((m) => m[1])
    .filter((name) => /-evidence$|^run-stage$/.test(name));
  assert.ok(notVerdicts.includes('pooled-scenario-evidence'), 'the pooled evidence must be an artifact of its own');
  for (const name of notVerdicts) assert.doesNotMatch(name, /-result/, `${name} would reach the collector`);
});

test('the draft uploads one exact result record for every standalone script job', async () => {
  const { readFileSync } = await import('node:fs');
  const draft = readFileSync(DRAFT, 'utf8').replace(/\r\n/g, '\n');
  const catalog = catalogRows(readFileSync(new URL('./scenario-catalog.tsv', import.meta.url), 'utf8'))
    .filter(({ implementation }) => implementation.endsWith('.sh')).map(({ id }) => id);
  for (const id of catalog) {
    const start = draft.search(new RegExp(`^ {2}${id}:[ \\t]*$`, 'm'));
    assert.ok(start >= 0, `draft has no ${id} job`);
    const rest = draft.slice(start + 1);
    const end = rest.search(/^ {2}[A-Za-z0-9_-]+:[ \t]*$/m);
    const block = end < 0 ? rest : rest.slice(0, end);
    assert.match(block, new RegExp(`capture-scenario-result\\.sh ${id} "\\$STAGE_REF"`), `${id} bypasses the exact-result wrapper`);
    assert.match(block, new RegExp(`scenario-results/${id}\\.txt`), `${id} does not upload its exact result`);
  }
  assert.doesNotMatch(draft, /scenario-results\/fallback|its isolated job passed/);
});

// The draft's verdict judges the catalog but waits only for the jobs in its `needs:`. A catalog row
// whose job it does not wait for is judged before that job uploads, and fails as "found 0". Every
// row has a job of its own except the pool's inline native and Docker installs. A row the pool runs
// (shared or terminal) runs alone only on a pull request; any other row runs alone everywhere.
test("the draft verdict waits for every catalog row's job, and each job runs where its class says", async () => {
  const { readFileSync } = await import('node:fs');
  const draft = readFileSync(DRAFT, 'utf8').replace(/\r\n/g, '\n');
  const rows = catalogRows(readFileSync(new URL('./scenario-catalog.tsv', import.meta.url), 'utf8'));
  const jobs = workflowJobs(draft.slice(draft.indexOf('\njobs:\n')));
  const verdict = jobs.find(({ id }) => id === 'verdict');
  assert.ok(verdict, 'the draft has no verdict job');
  const needs = verdict.body.match(/^ {4}needs: \[([^\]]*)\]/m)[1].split(',').map((x) => x.trim()).filter(Boolean);
  assert.equal(new Set(needs).size, needs.length, 'duplicate in needs');
  const pooledInline = (row) => row.implementation === 'inline' && row.execution === 'pooled' && row.system !== 'mac';
  const ownJobs = rows.filter((row) => !pooledInline(row)).map(({ id }) => id);
  assert.deepEqual(needs.filter((id) => !['stage', 'pr-image', 'pooled'].includes(id)).sort(), [...ownJobs].sort());
  assert.deepEqual(jobs.map(({ id }) => id).filter((id) => id !== 'verdict').sort(), [...needs].sort(), 'a draft job the verdict does not wait for');
  for (const row of rows.filter(({ implementation }) => implementation.endsWith('.sh'))) {
    const condition = jobCondition(jobs.find(({ id }) => id === row.id));
    const prOnly = condition.startsWith("${{ github.event_name == 'pull_request' && ");
    assert.equal(prOnly, row.execution !== 'isolated', `${row.id} (${row.execution}) has guard ${condition}`);
  }
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
  const needs = needsLine[1].split(',').map((x) => x.trim()).filter(Boolean).filter((x) => x !== 'stage' && x !== 'pr-image');
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
  const scenarios = jobs.filter((j) => j !== 'stage' && j !== 'verdict' && j !== 'pr-image');
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
  // Steps run in declaration order: an upload placed before the scenario would find no folder yet,
  // so the scenario's own step must come first and the upload after it.
  const runIdx = steps.findIndex((s) => s.includes(`bash scenarios/${name}.sh`));
  assert.ok(runIdx >= 0, `no step of the job runs scenarios/${name}.sh`);
  assert.ok(runIdx < steps.indexOf(up), 'the evidence upload must come after the scenario that creates the evidence');
  // The scenario step pipes its verdict through tee. A FAIL must still fail the job: GitHub runs an
  // explicit `shell: bash` as `bash --noprofile --norc -eo pipefail {0}` (an unset shell is only
  // `bash -e {0}`, where tee's 0 would win), so the step must name `shell: bash` and must not continue on error.
  const run = steps[runIdx];
  assert.equal((run.match(/^ +shell: *(.+?)[ \t]*$/m) || [])[1], 'bash',
    "the scenario step must say `shell: bash`, so GitHub adds pipefail and a FAIL behind `| tee` still fails the job");
  assert.doesNotMatch(run, /^ +continue-on-error:/m, 'a failed scenario must fail the job, so no continue-on-error on its step');
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
test('the pick names the scenarios whose script or owned file changed', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const at = text.indexOf('          jobs=$(grep -oE', text.indexOf('\n  stage:'));
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
  assert.ok(blockOf('stage').includes("github.event_name != 'pull_request' || (github.event.pull_request.head.repo.full_name == github.repository && needs.pr-image.result == 'success')"), 'the stage job does not skip a fork pull request');
  for (const m of starts) {
    const block = blockOf(m[1]);
    if (!/bash scenarios\/[a-z0-9-]+\.sh "\$STAGE_REF"/.test(block)) continue;
    assert.match(block, /^ {4}needs: stage$/m, `${m[1]} does not need the stage job, so a fork pull request could run it`);
  }
  const verdict = blockOf('verdict');
  assert.match(verdict, /^ {4}if: always\(\)$/m, 'the verdict does not always run, so a fork pull request would get no verdict');
  const at = verdict.indexOf('          bad=0\n');
  const to = verdict.indexOf('      - name: Tell the night in issues');
  assert.ok(at > 0 && to > at, 'the verdict step was not found');
  const script = verdict.slice(at, to).replace(/^ {10}/gm, '');
  const run = (env) => spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '/dev/null', STAGE_REF: 'this-commit', WANT_MAC: 'false', IS_CANDIDATE: 'false', RESULTS: 'voice=skipped plain-yes=skipped', PICKED: '', PR_IMAGE: 'success', ...env } });
  const fork = run({ EVENT: 'pull_request', STAGE: 'skipped' });
  // a failed or cancelled image job skips the stage too, and that must never read as a fork
  for (const PR_IMAGE of ['failure', 'cancelled']) assert.equal(run({ EVENT: 'pull_request', STAGE: 'skipped', PR_IMAGE }).status, 1, `an image job that ended ${PR_IMAGE} must fail the verdict`);
  assert.equal(run({ EVENT: 'pull_request', STAGE: 'skipped', PR_IMAGE: 'skipped' }).status, 0, 'a fork (image job skipped) still passes');
  assert.equal(fork.status, 0, fork.stdout + fork.stderr);
  assert.match(fork.stdout, /No scenario runs on a pull request from a fork/);
  // the same skips on a night, or a skipped stage that is not a fork's pull request, still fail
  assert.equal(run({ EVENT: 'schedule', STAGE: 'skipped' }).status, 1);
  assert.equal(run({ EVENT: 'pull_request', STAGE: 'success', PICKED: ',voice,' }).status, 1, 'a picked scenario that did not run must fail');
  assert.equal(run({ EVENT: 'pull_request', STAGE: 'success', PICKED: ',' }).status, 0, 'an unpicked skip must pass');
  // a hand-started run narrowed by `only`: the unpicked skip passes, a picked skip fails, a name that is no job fails
  const names = 'voice=skipped plain-yes=success mac-install=skipped windows-old-names-move=skipped';
  const dispatch = (env) => run({ EVENT: 'workflow_dispatch', STAGE: 'success', RESULTS: names, ...env });
  assert.equal(dispatch({ PICKED: ',plain-yes,' }).status, 0, 'only: the jobs not listed are not judged');
  assert.equal(dispatch({ PICKED: ',plain-yes,voice,' }).status, 1, 'only: a listed job that did not run must fail');
  assert.equal(dispatch({ PICKED: ',stage,' }).status, 0, 'only: `stage` is a job that always runs, not a typo');
  assert.equal(dispatch({ PICKED: ',plain-yes,verdict,' }).status, 0, 'only: `verdict` is a job that always runs, not a typo');
  assert.equal(dispatch({ PICKED: ',plain-yes,typo-job,' }).status, 1, 'only: a name that is no job must fail');
  assert.equal(dispatch({ PICKED: ',plain-yes,mac-install,' }).status, 1, 'only: a listed Mac job that did not run must fail');
  assert.equal(dispatch({ PICKED: ',plain-yes,windows-old-names-move,' }).status, 1, 'only: a listed Windows job that did not run must fail');
  assert.equal(dispatch({ PICKED: ',all,' }).status, 1, 'only=all names no job and must fail');
  assert.equal(dispatch({ PICKED: 'all' }).status, 1, 'no only: a skipped job still fails the run, as before');
  assert.equal(dispatch({ PICKED: ',plain-yes,', STAGE: 'skipped' }).status, 1, 'only: an unreadable stage still fails');
});

// The workflow's own trigger, concurrency and the pick step as a whole, read as text and run as bash.
const pickStep = (text) => {
  const at = text.indexOf('        id: pick\n', text.indexOf('\n  stage:'));
  const run = text.indexOf('        run: |\n', at);
  const to = text.indexOf('      - name: Read and check it', run);
  assert.ok(at > 0 && run > at && to > run, 'the pick step was not found');
  return text.slice(run + '        run: |\n'.length, to).replace(/^ {10}/gm, '');
};

test('the workflow runs on a pull request opened, pushed to or reopened, and one run per pull request is kept', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const on = text.slice(text.indexOf('\non:\n'), text.indexOf('\npermissions:\n'));
  assert.match(on, /^ {2}pull_request:\n {4}types: \[opened, synchronize, reopened\]$/m, 'the pull_request trigger (opened, synchronize, reopened) is missing');
  assert.match(on, /^ {2}schedule:/m);
  assert.match(on, /^ {2}workflow_dispatch:/m);
  const conc = text.slice(text.indexOf('\nconcurrency:\n'), text.indexOf('\nenv:\n'));
  assert.ok(conc.includes('group: scenarios-${{ github.event.pull_request.number || github.run_id }}'), 'the group is not one per pull request (a run id for every other event)');
  assert.ok(conc.includes("cancel-in-progress: ${{ github.event_name == 'pull_request' }}"), 'only a pull request may cancel its older run');
});

test('the pick says all on a night, a candidate and a manual run', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const script = pickStep(readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n'));
  for (const event of ['schedule', 'workflow_dispatch']) {
    const dir = mkdtempSync(`${tmpdir()}/pickall-`).replaceAll(String.fromCharCode(92), '/');
    writeFileSync(`${dir}/out`, '');
    const r = spawnSync('bash', ['-c', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: `${dir}/out`, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: `${dir}/sum` } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(`${dir}/out`, 'utf8'), 'picked=all\n', `${event} does not prove every scenario`);
  }
});

// The whole pull request arm with a stand-in `gh` that insists on the pull request's files endpoint,
// paging through all of it, and a jq filter for names: the way the pick reads a large pull request.
test('the pick on a pull request asks the files endpoint of that pull request, all pages, and writes picked', async () => {
  const { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const script = pickStep(readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n'));
  const dir = mkdtempSync(`${tmpdir()}/pickpr-`).replaceAll(String.fromCharCode(92), '/');
  mkdirSync(`${dir}/bin`);
  writeFileSync(`${dir}/bin/gh`, [
    '#!/usr/bin/env bash',
    'args="$*"',
    '[[ "$1" = api && "$2" = "repos/me/repo/pulls/42/files" ]] || { echo "unexpected endpoint: $args" >&2; exit 9; }',
    '[[ " $args " == *" --paginate "* ]] || { echo "not paginated: $args" >&2; exit 9; }',
    '[[ " $args " == *" --jq "* ]] || { echo "no --jq: $args" >&2; exit 9; }',
    'printf "%s\n" README.md scenarios/charm-challenge.sh',
    '',
  ].join('\n'));
  chmodSync(`${dir}/bin/gh`, 0o755);
  writeFileSync(`${dir}/out`, '');
  const r = spawnSync('bash', ['-c', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'me/repo', PR: '42', GITHUB_OUTPUT: `${dir}/out`, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: `${dir}/sum` } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(`${dir}/out`, 'utf8'), 'picked=,charm-challenge,\n');
});

test('the PR-image job binds its published digest to stage and selects its shared-server helper consumers', async () => {
  const { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  // The workflow is read with every line marked, so the checks below read as they did when they proved the draft.
  const workflow = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const text = workflow.split('\n').map((line) => `+${line}`).join('\n');
  // The image job runs on every event but a fork's pull request (a skipped job skips every job that
  // needs it, however indirectly, and every scenario needs stage, which needs this one), and only a
  // pull request checks out and picks, so only a same-repository pull request can build the image.
  assert.match(text, /^\+    if: github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository$/m, 'the image job is skipped outside pull requests, which skips every scenario');
  const imageJob = text.slice(text.indexOf('\n+  pr-image:\n'), text.indexOf('\n+  stage:\n'));
  assert.ok(imageJob.length > 0, 'the image job was not found before stage');
  assert.match(imageJob, /\+      - uses: actions\/checkout@v4\n\+        if: github\.event_name == 'pull_request'\n/, 'the image job checks out outside a pull request');
  assert.match(imageJob, /\+        id: pick\n\+        if: github\.event_name == 'pull_request'\n/, 'the image job picks outside a pull request');
  assert.match(imageJob, /\+      - uses: docker\/login-action@v3\n\+        if: steps\.pick\.outputs\.picked == 'true'\n/, 'the image job logs in without a pick');
  assert.match(imageJob, /\+        id: publish\n\+        if: steps\.pick\.outputs\.picked == 'true'\n/, 'the image job publishes without a pick');
  assert.match(text, /^\+      TAG: pr-\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ github\.event\.pull_request\.head\.sha \}\}$/m, 'the image tag is not unique to this pull request head');
  assert.match(text, /^\+          ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}$/m, 'the image builder does not check out the pull request head');
  assert.match(text, /^\+          docker build --build-arg REVISION="\$\{\{ github\.event\.pull_request\.head\.sha \}\}" -f docker\/full-candidate\/Dockerfile -t "\$IMAGE:\$TAG" \.$/m, 'the image build does not receive the pull request head revision');
  assert.match(text, /^\+      image: \$\{\{ steps\.publish\.outputs\.image \}\}$/m, 'the image job does not publish its immutable image');
  assert.match(text, /^\+          digest=\$\(docker buildx imagetools inspect "\$IMAGE:\$TAG" --format '\{\{\.Manifest\.Digest\}\}'\)$/m, 'the published image is not resolved to a digest');
  assert.match(text, /^\+          \[\[ \$digest =~ \^sha256:\[0-9a-f]\{64\}\$ \]\] \|\|/m, 'the published image digest is not verified');
  assert.match(text, /^\+      GODSPEED_SCENARIO_PR_IMAGE: \$\{\{ needs\.pr-image\.outputs\.image \}\}$/m, 'stage rebuilds the image reference instead of receiving its output');
  assert.match(text, /^\+    if: \$\{\{ always\(\) && \(github\.event_name != 'pull_request' \|\| \(github\.event\.pull_request\.head\.repo\.full_name == github\.repository && needs\.pr-image\.result == 'success'\)\) \}\}$/m, 'stage can run after a selected PR image fails');
  assert.doesNotMatch(text, /GODSPEED_SCENARIO_PR_IMAGE_TAG/, 'stage reconstructs the producer tag');
  const readers=[...workflow.matchAll(/bash scenarios\/([a-z0-9-]+)\.sh "\$STAGE_REF"/g)].map(match=>match[1]).sort().filter(name=>/^\. "\$HERE\/server-lib\.sh"$/m.test(readFileSync(fileURLToPath(new URL(`./${name}.sh`, import.meta.url)),'utf8')));
  assert.ok(readers.length>0,'the workflow has no direct shared-server helper consumer');
  assert.match(text,/grep -qx 'scenarios\/server-lib\.sh' "\$RUNNER_TEMP\/changed" && grep -qF '\. "\$HERE\/server-lib\.sh"' "scenarios\/\$job\.sh"/,'the PR-image picker misses a server-lib-only change');
  assert.match(text,/grep -qx 'scenarios\/server-lib\.sh' "\$RUNNER_TEMP\/changed" && grep -qF '\. "\$HERE\/server-lib\.sh"' "scenarios\/\$j\.sh"/,'the stage picker misses a server-lib-only change');
  const at=text.indexOf('+        run: |\n',text.indexOf('+        id: pick\n'));
  const to=text.indexOf('+      - uses: docker/login-action@v3',at);
  assert.ok(at>=0&&to>at,'the PR-image picker was not found');
  const script=text.slice(at+'+        run: |\n'.length,to).replace(/^\+/gm,'').replace(/^ {10}/gm,'');
  const run=(files)=>{
    const dir=mkdtempSync(`${tmpdir()}/draft-pr-image-`).replaceAll(String.fromCharCode(92),'/');
    mkdirSync(`${dir}/bin`);writeFileSync(`${dir}/bin/gh`,'#!/usr/bin/env bash\nprintf "%s\\n" "$DRAFT_FILES"\n');chmodSync(`${dir}/bin/gh`,0o755);writeFileSync(`${dir}/out`,'');
    const result=spawnSync('bash',['-c',script],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',env:{...process.env,PATH:`${dir}/bin:${process.env.PATH}`,DRAFT_FILES:files,GITHUB_REPOSITORY:'me/repo',PR:'42',RUNNER_TEMP:dir,GITHUB_OUTPUT:`${dir}/out`}});
    assert.equal(result.status,0,result.stdout+result.stderr);return readFileSync(`${dir}/out`,'utf8');
  };
  assert.equal(run('scenarios/server-lib.sh'),'picked=true\n','a shared helper change does not publish the PR image');
  assert.equal(run('scenarios/first-day.sh'),'picked=true\n','a selected server scenario publishes the PR image');
  assert.equal(run('scenarios/voice.sh'),'picked=false\n','an unpicked non-server scenario publishes no PR image');
  const stageAt=text.indexOf('+          jobs=$(grep -oE',text.indexOf('\n+  stage:'));
  const stageTo=text.indexOf('+          done',stageAt);
  assert.ok(stageAt>=0&&stageTo>stageAt,'the stage picker was not found');
  const stageScript=text.slice(stageAt,stageTo+'+          done'.length)
    .split('\n').filter((line)=>line.startsWith('+')).map((line)=>line.slice(1).replace(/^ {10}/,'')).join('\n');
  const runStage=(files)=>{
    const dir=mkdtempSync(`${tmpdir()}/draft-stage-`).replaceAll(String.fromCharCode(92),'/');
    writeFileSync(`${dir}/changed`,`${files}\n`);
    const result=spawnSync('bash',['-c',`${stageScript}\nprintf 'picked=%s\\n' "$picked"`],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',env:{...process.env,RUNNER_TEMP:dir}});
    assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;
  };
  const helperStages=runStage('scenarios/server-lib.sh');
  assert.equal(helperStages,`picked=,${readers.join(',')},\n`,'a shared helper change does not stage every direct helper consumer');
  assert.doesNotMatch(helperStages,/,voice,/,'a shared helper change stages an unrelated scenario');
});

// `only`: a hand-started run names the jobs it runs, and nothing else changes.
test('the pick on a hand-started run reads `only`, and a night and an empty `only` keep the old pick', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const on = text.slice(text.indexOf('\non:\n'), text.indexOf('\npermissions:\n'));
  assert.match(on, /^ {6}only:\n {8}description: .*\n {8}required: false\n {8}default: ''$/m, 'the workflow_dispatch input `only` (default empty) is missing');
  assert.ok(text.includes('ONLY: ${{ inputs.only }}'), 'the pick step does not read inputs.only through an env variable');
  const script = pickStep(text);
  const pick = (event, only) => {
    const dir = mkdtempSync(`${tmpdir()}/pickonly-`).replaceAll(String.fromCharCode(92), '/');
    writeFileSync(`${dir}/out`, '');
    const env = { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: `${dir}/out`, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: `${dir}/sum` };
    if (only !== undefined) env.ONLY = only; else delete env.ONLY;
    const r = spawnSync('bash', ['-c', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', env });
    return { status: r.status, out: readFileSync(`${dir}/out`, 'utf8') };
  };
  assert.equal(pick('workflow_dispatch', 'first-day,talk-prep-honest').out, 'picked=,first-day,talk-prep-honest,\n');
  assert.equal(pick('workflow_dispatch', ' first-day , ,hermes-update-rollback,\n').out, 'picked=,first-day,hermes-update-rollback,\n', 'spaces and empty entries are dropped');
  assert.equal(pick('workflow_dispatch', 'first-day').out, 'picked=,first-day,\n');
  assert.equal(pick('workflow_dispatch', '').out, 'picked=all\n', 'an empty only runs everything');
  assert.equal(pick('workflow_dispatch', undefined).out, 'picked=all\n');
  assert.equal(pick('workflow_dispatch', 'all').out, 'picked=,all,\n', '`all` is no job: it is picked as a name, so the verdict fails it');
  assert.equal(pick('schedule', 'first-day').out, 'picked=all\n', 'the night ignores only');
  for (const empty of [',', ',,, ,']) {
    const none = pick('workflow_dispatch', empty);
    assert.notEqual(none.status, 0, `only=${JSON.stringify(empty)} names no job and must fail, not pass with nothing run`);
    assert.equal(none.out, '', 'and write no pick');
  }
  const bad = pick('workflow_dispatch', 'first-day;echo hi');
  assert.notEqual(bad.status, 0, 'a value that is not job names must fail');
  assert.equal(bad.out, '', 'and write no pick');
  // the complete condition of each job that is not a script job, exactly: its own pick joined to the
  // predicate it always had (not a pull request, a candidate tag for Windows, `mac` for the Mac one)
  const gate = (name) => `needs.stage.outputs.picked == 'all' || contains(needs.stage.outputs.picked, ',${name},')`;
  const expected = {
    'linux-install': `\${{ github.event_name != 'pull_request' && (${gate('linux-install')}) }}`,
    'docker-server': `\${{ github.event_name != 'pull_request' && (${gate('docker-server')}) }}`,
    'linux-update': `\${{ github.event_name != 'pull_request' && (${gate('linux-update')}) }}`,
    'windows-old-names-move': `\${{ startsWith(inputs.stage, 'candidate/') && (${gate('windows-old-names-move')}) }}`,
    'mac-install': "${{ needs.stage.outputs.picked == 'all' && inputs.mac || contains(needs.stage.outputs.picked, ',mac-install,') }}",
  };
  const jobsText = text.slice(text.indexOf('\njobs:\n'));
  for (const [name, cond] of Object.entries(expected)) {
    const at = jobsText.indexOf(`\n  ${name}:\n`);
    assert.ok(at > 0, `${name} not found`);
    const ifs = [...jobsText.slice(at, jobsText.indexOf('\n    steps:', at)).matchAll(/^ {4}if: (.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(ifs, [cond], `${name} has not exactly its complete condition`);
  }
  // and what those conditions come to, evaluated as GitHub does for the cases that matter
  const evalCond = ({ event, stage, mac, picked }, name) => {
    const has = picked === 'all' || picked.includes(`,${name},`);
    if (name === 'mac-install') return (picked === 'all' && !!mac) || picked.includes(',mac-install,');
    if (name === 'windows-old-names-move') return stage.startsWith('candidate/') && has;
    return event !== 'pull_request' && has;
  };
  assert.equal(evalCond({ event: 'workflow_dispatch', stage: 'candidate/x', picked: ',first-day,' }, 'windows-old-names-move'), false, 'an unrelated pick leaves Windows out');
  assert.equal(evalCond({ event: 'workflow_dispatch', stage: 'beta', picked: ',windows-old-names-move,' }, 'windows-old-names-move'), false, 'Windows needs a candidate tag even when listed');
  assert.equal(evalCond({ event: 'workflow_dispatch', stage: 'candidate/x', picked: ',windows-old-names-move,' }, 'windows-old-names-move'), true);
  assert.equal(evalCond({ event: 'workflow_dispatch', stage: 'candidate/x', picked: 'all', mac: true }, 'mac-install'), true);
  assert.equal(evalCond({ event: 'workflow_dispatch', stage: 'candidate/x', picked: ',first-day,', mac: true }, 'mac-install'), false, 'mac=true does not add the Mac job to an only run');
  // no issue is filed for a run that is not the night's
  assert.match(text, /Tell the night in issues[\s\S]*?if: always\(\) && github\.event_name == 'schedule'/);
});

test('the draft picks by hand with `only`, hands the pick to the pool, and picks the PR image through the catalog', async () => {
  const { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const draft = readFileSync(DRAFT, 'utf8').replace(/\r\n/g, '\n');
  const repo = fileURLToPath(new URL('..', import.meta.url));
  assert.ok(draft.includes('ONLY: ${{ inputs.only }}'), 'the draft pick step does not read inputs.only');
  const pick = (only) => {
    const dir = mkdtempSync(`${tmpdir()}/draft-only-`).replaceAll(String.fromCharCode(92), '/');
    writeFileSync(`${dir}/out`, '');
    const r = spawnSync('bash', ['-c', pickStep(draft)], { cwd: repo, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', ONLY: only, GITHUB_OUTPUT: `${dir}/out`, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: `${dir}/sum` } });
    return { status: r.status, out: readFileSync(`${dir}/out`, 'utf8') };
  };
  assert.deepEqual(pick(' voice , ,first-day'), { status: 0, out: 'picked=,voice,first-day,\n' });
  assert.deepEqual(pick(''), { status: 0, out: 'picked=all\n' });
  assert.notEqual(pick('voice;echo hi').status, 0, 'a value that is not scenario names must fail');
  const pooled = workflowJobs(draft).find(({ id }) => id === 'pooled').body;
  assert.match(pooled, /PICKED: \$\{\{ needs\.stage\.outputs\.picked \}\}\n {8}run: bash scenarios\/run-installed-scenarios\.sh "\$STAGE_REF" "\$PICKED"\n/, 'the pool does not run only the picked scenarios');

  const imageJob = workflowJobs(draft).find(({ id }) => id === 'pr-image').body;
  const at = imageJob.indexOf('        run: |\n', imageJob.indexOf('        id: pick\n'));
  const to = imageJob.indexOf('      - uses: docker/login-action@v3', at);
  assert.ok(at > 0 && to > at, 'the draft PR-image picker was not found');
  const script = imageJob.slice(at + '        run: |\n'.length, to).replace(/^ {10}/gm, '');
  const image = (files) => {
    const dir = mkdtempSync(`${tmpdir()}/draft-pr-image-`).replaceAll(String.fromCharCode(92), '/');
    mkdirSync(`${dir}/bin`); writeFileSync(`${dir}/bin/gh`, '#!/usr/bin/env bash\nprintf "%s\\n" "$DRAFT_FILES"\n'); chmodSync(`${dir}/bin/gh`, 0o755); writeFileSync(`${dir}/out`, '');
    const r = spawnSync('bash', ['-c', script], { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, DRAFT_FILES: files, GITHUB_REPOSITORY: 'me/repo', PR: '42', RUNNER_TEMP: dir, GITHUB_OUTPUT: `${dir}/out` } });
    assert.equal(r.status, 0, r.stdout + r.stderr); return readFileSync(`${dir}/out`, 'utf8');
  };
  assert.equal(image('scenarios/server-lib.sh'), 'picked=true\n', 'a shared helper change does not publish the PR image');
  assert.equal(image('scenarios/first-day.sh'), 'picked=true\n', 'a picked server scenario does not publish the PR image');
  assert.equal(image('scenarios/voice.sh'), 'picked=false\n', 'a picked scenario without a server publishes the PR image');
  assert.equal(image('README.md'), 'picked=false\n', 'a change outside the scenarios publishes the PR image');
});

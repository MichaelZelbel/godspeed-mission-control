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

// WHAT THE TWO GUARDS BELOW ARE FOR: they catch an omitted, renamed or reformatted step in the
// workflow (a dropped `needs: stage`, a dropped download or `shell: bash`, a scenario no longer
// invoked). They do not interpret shell, so a deliberate rewrite that defeats them is a review
// matter, not something these tests can see.
//
// The jobs the guards read are parsed with the notebook's own YAML module (the one the readable
// files use), so jobs, steps, `needs`, `run` and `shell` come out as YAML defines them: a folded
// `>` scalar is joined, a literal `|` scalar is kept. ACCEPTED SUBSET: that reader takes no
// anchors, aliases or tags, and it is not given authority over the whole workflow. The text is
// split into its top-level `jobs:` entries by indentation and ONLY the jobs a guard needs are
// parsed, each on its own; a job with no scenario invocation (the stage's own scenarios/stage-for-run.sh is not one) is skipped unparsed. An anchor,
// alias or tag inside a job a guard reads fails that check with a message saying so; elsewhere
// in the workflow they are fine. A `run` value is then made one logical script: shell comment
// lines are left out, a backslash at a line end and a pipe at a line end join the next line.
import { parse as parseYaml } from '../notebook/core/records/yaml.mjs';
function splitJobs(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:[ \t]*$/.test(l));
  const blocks = {};
  if (start < 0) return blocks;
  let name = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && !l.startsWith('#')) break;
    const h = l.match(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/);
    if (h) { name = h[1]; blocks[name] = []; continue; }
    if (name && l.trim() !== '' && !l.trim().startsWith('#') && /^ {0,2}\S/.test(l)) { name = null; continue; }
    if (name) blocks[name].push(l);
  }
  return Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, v.join('\n')]));
}
// names: the jobs to parse; omitted: every job whose text invokes a scenario.
// A scenario invocation: scenarios/<name>.sh, not the stage's own helper scenarios/stage-for-run.sh.
const SCENARIO_RUN = /scenarios\/(?!stage-for-run\.sh)[A-Za-z0-9_-]+\.sh/;
const loadWorkflow = (text, names) => {
  const blocks = splitJobs(text);
  const jobs = {};
  for (const [name, body] of Object.entries(blocks)) {
    if (names ? !names.includes(name) : !SCENARIO_RUN.test(body)) continue;
    try {
      jobs[name] = parseYaml(`jobs:
  ${name}:
${body}
`).jobs[name];
    } catch (e) {
      assert.fail(`${name}: the workflow guards read job YAML without anchors, aliases or tags (the notebook's YAML reader); expand them in this job or extend the guard (${e.message})`);
    }
  }
  return { jobs };
};
const stepsOfJob = (doc, job) => {
  assert.ok(doc.jobs && doc.jobs[job], `job ${job} not found`);
  return doc.jobs[job].steps || [];
};
const logicalRun = (step) => {
  if (typeof step.run !== 'string') return null;
  return step.run.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    .replace(/\\\n\s*/g, ' ').replace(/\|[ \t]*\n\s*/g, '| ');
};
const needsList = (job) => [].concat(job.needs ?? []).map(String);

// The four beta.17 jobs run the stage's own copy of their scenario: the job waits for the stage,
// the checkout takes the stage ref when one is given, the stage artifact is downloaded when none
// is, and the step that runs the scenario gives it the stage ref, as a command (at the start of
// the script or of a line, or right after ; && || | or an opening parenthesis), never as the
// argument of another command such as echo. A job that loses one of these runs another version's
// scenario, silently.
function checkStageHandoff(text, job) {
  const doc = loadWorkflow(text, [job]);
  assert.ok(needsList(doc.jobs[job] || {}).includes('stage'), `${job}: needs does not include stage`);
  const steps = stepsOfJob(doc, job);
  const checkout = steps.find((s) => String(s.uses).startsWith('actions/checkout@v4'));
  assert.ok(checkout, `${job} has no actions/checkout@v4 step`);
  assert.equal(checkout.with?.ref, '${{ inputs.stage || github.sha }}', `${job}: checkout ref`);
  const download = steps.find((s) => String(s.uses).startsWith('actions/download-artifact@v4'));
  assert.ok(download, `${job} has no actions/download-artifact@v4 step`);
  assert.equal(download.if, '${{ !inputs.stage }}', `${job}: download condition`);
  assert.equal(download.with?.name, 'run-stage', `${job}: download name`);
  assert.equal(download.with?.path, '${{ runner.temp }}/run-stage', `${job}: download path`);
  const call = new RegExp(`(?:^|[\\n;&|(])[ \\t]*bash scenarios/${job}\\.sh "\\$STAGE_REF"`);
  assert.ok(steps.map(logicalRun).some((v) => v !== null && call.test(v)), `${job}: no step's run: value executes its scenario with "$STAGE_REF" in command position`);
}

for (const job of ['no-question-he-cannot-judge', 'plain-yes', 'what-was-that', 'connection-check']) {
  test(`the ${job} job takes the stage handoff: needs, checkout ref, stage download, scenario run`, async () => {
    const { readFileSync } = await import('node:fs');
    checkStageHandoff(readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n'), job);
  });
}

const fixtureJob = ({ needs = 'needs: stage', steps }) => `jobs:
  stage:
    runs-on: x
  demo:
    ${needs}
    runs-on: x
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ inputs.stage || github.sha }}
      - uses: actions/download-artifact@v4
        if: \${{ !inputs.stage }}
        with:
          name: run-stage
          path: \${{ runner.temp }}/run-stage
${steps}
  other:
    runs-on: x
`;
const ONE = `      - name: go
        shell: bash
        run: bash scenarios/demo.sh "$STAGE_REF" | tee "$RUNNER_TEMP/verdict"
`;
const BLOCK = `      - name: go
        shell: bash
        run: |
          # bash scenarios/demo.sh "$STAGE_REF" would be a comment
          set -e
          bash scenarios/demo.sh "$STAGE_REF" | tee "$RUNNER_TEMP/verdict"
`;
test('stage-handoff fixtures: a correct one-line and block-scalar job pass, broken ones are rejected', () => {
  checkStageHandoff(fixtureJob({ steps: ONE }), 'demo');
  checkStageHandoff(fixtureJob({ steps: BLOCK }), 'demo');
  checkStageHandoff(fixtureJob({ needs: 'needs: [stage, other]', steps: ONE }), 'demo');
  checkStageHandoff(fixtureJob({ steps: `      - name: go\n        run: set -e; bash scenarios/demo.sh "$STAGE_REF"\n` }), 'demo');
  checkStageHandoff(fixtureJob({ steps: `      - name: go\n        run: cd x && bash scenarios/demo.sh "$STAGE_REF"\n` }), 'demo');
  assert.throws(() => checkStageHandoff(fixtureJob({ needs: 'needs: other', steps: ONE }), 'demo'), /needs does not include stage/);
  assert.throws(() => checkStageHandoff(fixtureJob({ needs: '', steps: ONE }), 'demo'), /needs does not include stage/);
  const commentOnly = `      - name: go
        run: |
          # bash scenarios/demo.sh "$STAGE_REF"
          echo nothing
      - name: other step
        env:
          NOTE: 'bash scenarios/demo.sh "$STAGE_REF"'
        run: echo hi # bash scenarios/demo.sh "$STAGE_REF"
`;
  assert.throws(() => checkStageHandoff(fixtureJob({ steps: commentOnly }), 'demo'), /no step's run: value executes/);
  const otherScenario = `      - name: go
        shell: bash
        run: |
          bash scenarios/not-demo.sh "$STAGE_REF" | tee "$RUNNER_TEMP/verdict"
`;
  assert.throws(() => checkStageHandoff(fixtureJob({ steps: otherScenario }), 'demo'), /no step's run: value executes/);
  const asArgument = `      - name: go\n        shell: bash\n        run: echo bash scenarios/demo.sh "$STAGE_REF"\n`;
  assert.throws(() => checkStageHandoff(fixtureJob({ steps: asArgument }), 'demo'), /command position/);
});

// A failing scenario fails its job: a step that pipes a scenario into tee must declare
// `shell: bash`, because only an explicit shell runs as `bash --noprofile --norc -e -o pipefail`
// (seen in scenarios run 41871435090: the Charm Challenge step ended with exit code 1 and its job
// and the verdict failed). A step with no `shell:` runs as `bash -e {0}`, without pipefail, and
// tee would hide the scenario's exit code. Steps are picked by their whole run value after
// continuation lines are joined, so the pipe may sit on a later line than the command.
const pipedSteps = (doc) =>
  Object.values(doc.jobs).flatMap((j) => j.steps || []).filter((s) => /bash scenarios\/\S+\.sh[^\n]*\|\s*tee\b/.test(logicalRun(s) || ''));
const missingShell = (steps) => steps.filter((s) => s.shell !== 'bash');
test('every step that pipes a scenario into tee declares shell: bash (pipefail)', async () => {
  const { readFileSync } = await import('node:fs');
  const piped = pipedSteps(loadWorkflow(readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n')));
  assert.ok(piped.length > 10, `too few scenario pipes found (${piped.length})`);
  for (const s of missingShell(piped)) {
    const name = (logicalRun(s).match(/(scenarios\/\S+)/) || [])[1];
    assert.fail(`the step running ${name} pipes into tee without an explicit shell: bash`);
  }
});
test('shell-bash fixtures: block, folded and continued pipes without shell: bash are rejected, with it accepted', () => {
  const FOLDED = `      - name: go
        run: >
          bash scenarios/demo.sh "$STAGE_REF"
          | tee "$RUNNER_TEMP/verdict"
`;
  const CONT = `      - name: go
        run: |
          bash scenarios/demo.sh "$STAGE_REF" \\
            | tee "$RUNNER_TEMP/verdict"
`;
  const strip = (y) => y.replace('        shell: bash\n', '');
  const withShell = (y) => y.replace('      - name: go\n', '      - name: go\n        shell: bash\n');
  for (const base of [BLOCK, FOLDED, CONT]) {
    const without = base.includes('shell: bash') ? strip(base) : base;
    const w = base.includes('shell: bash') ? base : withShell(base);
    const a = pipedSteps(loadWorkflow(fixtureJob({ steps: without })));
    assert.equal(a.length, 1);
    assert.equal(missingShell(a).length, 1);
    const b = pipedSteps(loadWorkflow(fixtureJob({ steps: w })));
    assert.equal(b.length, 1);
    assert.equal(missingShell(b).length, 0);
  }
  const commentOnly = fixtureJob({ steps: `      - name: go\n        run: |\n          # bash scenarios/demo.sh | tee x\n          echo hi\n` });
  assert.equal(pipedSteps(loadWorkflow(commentOnly)).length, 0);
});

// Accepted subset: an anchor in a job the guards do not read does not matter; one inside a job
// they read fails with a message that says what to do.
test('anchor fixtures: an anchored stage job beside correct jobs passes; an alias in a read job fails clearly', () => {
  const anchored = fixtureJob({ steps: ONE }).replace('stage:\n    runs-on: x', 'stage:\n    runs-on: &scenario_runner ubuntu-24.04');
  assert.ok(anchored.includes('&scenario_runner'));
  checkStageHandoff(anchored, 'demo');
  assert.equal(pipedSteps(loadWorkflow(anchored)).length, 1);
  const aliased = anchored.replace('  demo:\n    needs: stage\n    runs-on: x', '  demo:\n    needs: stage\n    runs-on: *scenario_runner');
  assert.ok(aliased.includes('*scenario_runner'));
  const msg = /demo: the workflow guards read job YAML without anchors, aliases or tags \(the notebook's YAML reader\); expand them in this job or extend the guard/;
  assert.throws(() => checkStageHandoff(aliased, 'demo'), msg);
  assert.throws(() => pipedSteps(loadWorkflow(aliased)), msg);
});

// node --test scenarios/test-reuse-earlier-pass.mjs
// reuse-earlier-pass.mjs: which picked AI scenarios a pull request does not run again. The git cases
// build a real repository: main, a pull request branch, and a push that only merges main in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decide, scenarioPaths, patchId, workflowJobs } from './reuse-earlier-pass.mjs';

const SCRIPT = fileURLToPath(new URL('./reuse-earlier-pass.mjs', import.meta.url));
const WORKFLOW = fileURLToPath(new URL('../.github/workflows/scenarios.yml', import.meta.url));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
function repo() {
  const dir = mkdtempSync(`${tmpdir()}/reuse-`).replaceAll('\\', '/');
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(`${dir}/scenarios`);
  const write = (file, text) => { writeFileSync(`${dir}/${file}`, text); };
  write('scenarios/plain-yes.sh', Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n');
  write('README.md', 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, write };
}

test('same own diff after a merge of main has the same patch id, and a changed own diff differs', () => {
  const { dir, write } = repo();
  const read = () => readFileSync(`${dir}/scenarios/plain-yes.sh`, 'utf8');
  git(dir, 'checkout', '-q', '-b', 'pr');
  write('scenarios/plain-yes.sh', read().replace('line 20', 'line 20 changed'));
  git(dir, 'commit', '-q', '-am', 'own change');
  const oldHead = git(dir, 'rev-parse', 'HEAD');
  const oldBase = git(dir, 'merge-base', 'main', oldHead);
  // main moves on, also in the same file above the change (shifting its line numbers), and is merged in
  git(dir, 'checkout', '-q', 'main');
  write('scenarios/plain-yes.sh', 'new first line\n' + read());
  write('README.md', 'two\n');
  git(dir, 'commit', '-q', '-am', 'main moves');
  git(dir, 'checkout', '-q', 'pr');
  git(dir, 'merge', '-q', '--no-edit', 'main');
  const merged = git(dir, 'rev-parse', 'HEAD');
  const mergedBase = git(dir, 'merge-base', 'main', merged);
  const files = ['scenarios/plain-yes.sh'];
  assert.equal(patchId(dir, mergedBase, merged, files), patchId(dir, oldBase, oldHead, files), 'a merge of main made the own change look different');
  // the pull request's own change then really changes
  write('scenarios/plain-yes.sh', read().replace('line 5', 'line 5 changed'));
  git(dir, 'commit', '-q', '-am', 'own change 2');
  const changed = git(dir, 'rev-parse', 'HEAD');
  assert.notEqual(patchId(dir, mergedBase, changed, files), patchId(dir, oldBase, oldHead, files));
});

const ai = new Set(['plain-yes', 'first-day']);
const files = (job) => [`scenarios/${job}.sh`];
const ids = (table) => (sha, list) => {
  const v = table[`${sha}|${list}`];
  if (!v) throw new Error('unknown');
  return v;
};

test('decide: same own change and an earlier pass is reused, and says on which commit', () => {
  const r = decide({ picked: ',plain-yes,', ai, files, passes: () => ['aaa1111'], ownId: ids({ 'head|scenarios/plain-yes.sh': 'X', 'aaa1111|scenarios/plain-yes.sh': 'X' }) });
  assert.deepEqual(r, { picked: ',', reused: [{ job: 'plain-yes', sha: 'aaa1111' }], runs: [] });
});
test('decide: a changed own change runs', () => {
  const r = decide({ picked: ',plain-yes,', ai, files, passes: () => ['aaa1111'], ownId: ids({ 'head|scenarios/plain-yes.sh': 'Y', 'aaa1111|scenarios/plain-yes.sh': 'X' }) });
  assert.equal(r.picked, ',plain-yes,');
  assert.equal(r.reused.length, 0);
});
test('decide: no earlier pass runs (a failed or missing earlier run is never in the list)', () => {
  const r = decide({ picked: ',plain-yes,', ai, files, passes: () => [], ownId: ids({}) });
  assert.equal(r.picked, ',plain-yes,');
});
test('decide: an older pass with the same change counts when the newest earlier pass differs', () => {
  const r = decide({ picked: ',plain-yes,', ai, files, passes: () => ['new', 'old'], ownId: ids({ 'head|scenarios/plain-yes.sh': 'X', 'new|scenarios/plain-yes.sh': 'Z', 'old|scenarios/plain-yes.sh': 'X' }) });
  assert.deepEqual(r.reused, [{ job: 'plain-yes', sha: 'old' }]);
});
test('decide: an earlier commit that cannot be read, or a head that cannot, runs the scenario', () => {
  assert.equal(decide({ picked: ',plain-yes,', ai, files, passes: () => ['gone'], ownId: ids({ 'head|scenarios/plain-yes.sh': 'X' }) }).picked, ',plain-yes,');
  assert.equal(decide({ picked: ',plain-yes,', ai, files, passes: () => ['a'], ownId: ids({}) }).picked, ',plain-yes,');
});
test('decide: a scenario without the AI key is never touched, and each job is judged on its own', () => {
  const r = decide({ picked: ',charm-challenge,plain-yes,first-day,', ai, files, passes: (j) => (j === 'plain-yes' ? ['a'] : []), ownId: ids({ 'head|scenarios/plain-yes.sh': 'X', 'a|scenarios/plain-yes.sh': 'X' }) });
  assert.equal(r.picked, ',charm-challenge,first-day,');
  assert.deepEqual(r.reused.map((x) => x.job), ['plain-yes']);
});

test('the comparison covers the whole scenarios folder and the workflow, so a shared helper counts', () => {
  assert.deepEqual(scenarioPaths(), ['scenarios/', '.github/workflows/scenarios.yml']);
});

test('the workflow: the AI scenarios are found, and stage hands on what the reuse step leaves', () => {
  const text = readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  const byId = Object.fromEntries(workflowJobs(text).map((j) => [j.id, j]));
  assert.equal(byId['plain-yes'].usesAi, true);
  assert.equal(byId['plain-yes'].name, 'a plain yes or a button answers the right waiting step');
  assert.equal(byId['linux-install'].usesAi, false);
  assert.match(text, /^ {6}picked: \$\{\{ steps\.reuse\.outputs\.picked \|\| steps\.pick\.outputs\.picked \}\}$/m, 'an empty reuse output must fall back to the pick, never skip every scenario');
  assert.match(text, /id: reuse\n {8}if: github\.event_name == 'pull_request'\n {8}shell: bash\n/);
  assert.match(text, /^ {6}actions: read$/m);
});

test('non-pull-request events keep picked as it is, with no GitHub call', () => {
  for (const [event, picked] of [['schedule', 'all'], ['workflow_dispatch', ',plain-yes,'], ['workflow_dispatch', 'all']]) {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', GITHUB_EVENT_NAME: event, PICKED: picked } });
    assert.equal(r.stdout, `picked=${picked}\n`, `${event} ${picked}`);
  }
});
test('a pull request that hits an error runs everything that was picked, and says so on stderr only', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', PICKED: ',plain-yes,', WORKFLOW_FILE: '/nonexistent/scenarios.yml' } });
  assert.equal(r.stdout, 'picked=,plain-yes,\n');
  assert.match(r.stderr, /every picked scenario runs/);
});

// The step end to end with a stand-in `gh` over a real repository: earlier runs of the pull request,
// their jobs, and the compare endpoint for the merge base.
function standIn({ jobConclusion }) {
  const { dir, write } = repo();
  const read = () => readFileSync(`${dir}/scenarios/plain-yes.sh`, 'utf8');
  git(dir, 'checkout', '-q', '-b', 'pr');
  write('scenarios/plain-yes.sh', read().replace('line 20', 'line 20 changed'));
  git(dir, 'commit', '-q', '-am', 'own change');
  const oldHead = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', 'main');
  write('README.md', 'two\n');
  git(dir, 'commit', '-q', '-am', 'main moves');
  git(dir, 'checkout', '-q', 'pr');
  git(dir, 'merge', '-q', '--no-edit', 'main');
  const head = git(dir, 'rev-parse', 'HEAD');
  mkdirSync(`${dir}/.github/workflows`, { recursive: true });
  writeFileSync(`${dir}/.github/workflows/scenarios.yml`, readFileSync(WORKFLOW, 'utf8'));
  const runs = { workflow_runs: [
    { id: 7, path: '.github/workflows/scenarios.yml', head_sha: oldHead, created_at: '2026-11-12T10:00:00Z', pull_requests: [{ number: 42 }] },
    { id: 8, path: '.github/workflows/scenarios.yml', head_sha: 'f'.repeat(40), created_at: '2026-11-12T11:00:00Z', pull_requests: [{ number: 99 }] },
  ] };
  const jobs = { jobs: [{ name: 'a plain yes or a button answers the right waiting step', conclusion: jobConclusion }] };
  writeFileSync(`${dir}/gh-stub.mjs`, [
    "import { execFileSync } from 'node:child_process';",
    'const a = process.argv.slice(2).join(" ");',
    `if (a.includes('repos/me/repo/actions/runs/7/jobs')) console.log(${JSON.stringify(JSON.stringify(jobs))});`,
    `else if (a.includes('repos/me/repo/actions/workflows/scenarios.yml/runs')) console.log(${JSON.stringify(JSON.stringify(runs))});`,
    "else if (a.includes('repos/me/repo/compare/main...')) { const sha = a.split('compare/main...')[1].split(' ')[0]; console.log(execFileSync('git', ['merge-base', 'main', sha], { encoding: 'utf8' }).trim()); }",
    'else { console.error("unexpected: " + a); process.exit(9); }',
    '',
  ].join('\n'));
  writeFileSync(`${dir}/changed`, 'scenarios/plain-yes.sh\n');
  return { dir, head, env: { ...process.env, REUSE_GH_STUB: `${dir}/gh-stub.mjs`, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'me/repo', PR: '42', HEAD_REF: 'pr', PROOF_SHA: head, GITHUB_RUN_ID: '9', GITHUB_WORKSPACE: dir, WORKFLOW_FILE: `${dir}/.github/workflows/scenarios.yml`, PICKED: ',plain-yes,', GITHUB_STEP_SUMMARY: `${dir}/summary` } };
}

test('end to end: a push that only merged main in reuses the earlier pass and says so in the summary', () => {
  const { dir, env } = standIn({ jobConclusion: 'success' });
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'picked=,\n', r.stderr);
  assert.match(readFileSync(`${dir}/summary`, 'utf8'), /plain-yes: passed on [0-9a-f]{7}, own change unchanged since/);
});
for (const conclusion of ['failure', 'skipped', 'cancelled']) {
  test(`end to end: an earlier run that ended ${conclusion} is never reused`, () => {
    const { dir, env } = standIn({ jobConclusion: conclusion });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env });
    assert.equal(r.stdout, 'picked=,plain-yes,\n', r.stderr);
  });
}
test('end to end: a changed own diff runs although an earlier pass exists', () => {
  const { dir, env } = standIn({ jobConclusion: 'success' });
  writeFileSync(`${dir}/scenarios/plain-yes.sh`, readFileSync(`${dir}/scenarios/plain-yes.sh`, 'utf8').replace('line 5', 'line 5 changed'));
  git(dir, 'commit', '-q', '-am', 'own change 2');
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env: { ...env, PROOF_SHA: git(dir, 'rev-parse', 'HEAD') } });
  assert.equal(r.stdout, 'picked=,plain-yes,\n', r.stderr);
});

test('a later change to a shared helper under scenarios/, or to one space, makes the own change differ', () => {
  const { dir, write } = repo();
  const paths = scenarioPaths();
  git(dir, 'checkout', '-q', '-b', 'pr');
  write('scenarios/plain-yes.sh', readFileSync(`${dir}/scenarios/plain-yes.sh`, 'utf8').replace('line 20', 'line 20 changed'));
  git(dir, 'commit', '-q', '-am', 'own change');
  const base = git(dir, 'merge-base', 'main', 'HEAD');
  const first = git(dir, 'rev-parse', 'HEAD');
  write('scenarios/scenario-lib.sh', 'helper\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'helper');
  const helper = git(dir, 'rev-parse', 'HEAD');
  assert.notEqual(patchId(dir, base, helper, paths), patchId(dir, base, first, paths), 'a new helper did not count as a change');
  write('scenarios/plain-yes.sh', readFileSync(`${dir}/scenarios/plain-yes.sh`, 'utf8').replace('line 20 changed', 'line 20  changed'));
  git(dir, 'commit', '-q', '-am', 'space');
  assert.notEqual(patchId(dir, base, git(dir, 'rev-parse', 'HEAD'), paths), patchId(dir, base, helper, paths), 'one space did not count as a change');
});

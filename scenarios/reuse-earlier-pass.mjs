#!/usr/bin/env node
// A pull request does not pay again for an AI scenario that already passed on an earlier head of the
// same pull request, when the pull request's own change to what picked that scenario is the same.
//
// Why: the scenarios that use the paid AI key (the test key has a monthly cap) are picked on a pull
// request by the files they own, and the picking is redone on every push. A pull request that is kept
// up to date by merging main into it (Cole Medin's archon-loop does that on every lap) therefore
// reran the same unchanged scenario change over and over: 43 to 50 times on one pull request.
//
// The rule: for each picked scenario that uses the AI key, take the pull request's own diff of the whole
// change (see ownChangePaths) (merge-base with the base branch to head). When an earlier head of
// this pull request has the scenario's job concluded `success` in its scenarios run, and its own
// diff of the same files has the same patch id, the scenario is left out of `picked`, and the step
// summary says "passed on <sha>, own change unchanged since". Anything else (no earlier pass, only a
// failed, skipped or cancelled one, a different own diff, a commit that cannot be fetched, any error)
// leaves the scenario in `picked`, so it runs as before. Nothing is ever reused outside a pull request.
//
// What a scenario judges is not touched here: only whether a repeat of it runs.
//
// Called by the `stage` job (.github/workflows/scenarios.yml, step "Leave out what already passed");
// prints `picked=<list>` on stdout for $GITHUB_OUTPUT. Tests: scenarios/test-reuse-earlier-pass.mjs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The jobs of the workflow: id, display name (what GitHub's jobs API calls it), and whether the job
// holds the scenario AI key. Read from the workflow file itself, so a new AI scenario is covered
// without touching this file.
export function workflowJobs(text) {
  const clean = text.replace(/\r\n/g, '\n');
  const start = clean.indexOf('\njobs:\n');
  const body = start < 0 ? '' : clean.slice(start);
  const headers = [...body.matchAll(/^ {2}([a-z0-9-]+):\n/gm)];
  return headers.map((header, index) => {
    const jobBody = body.slice(header.index, headers[index + 1]?.index);
    const name = jobBody.match(/^ {4}name: (.+)$/m)?.[1].trim();
    return { id: header[1], name: name ?? header[1], usesAi: /^ +GODSPEED_SCENARIO_AI_KEY:/m.test(jobBody) };
  });
}

// What counts as "the pull request's own change": all of it, every file of the diff from the merge base
// with the base branch to the head (no pathspec). A scenario runs the pull request's whole tree (the
// image and the stage are built from the head), so a later push that only touches product code must run
// it again; a merge of main in changes none of the pull request's own diff (the merge base moves with
// main). One case stays open on purpose: main's own change to scenarios/ that a merge brings in changes
// the script that runs without changing the pull request's own diff; the night proves main as a whole.
export function ownChangePaths() {
  return [];
}

// The decision, with everything it needs handed in so a test can drive it without GitHub.
//   picked: ',a,b,'  ai: Set of job ids using the AI key  files(job): the paths the comparison covers
//   passes(job): shas of earlier heads of this pull request where the job concluded success, newest first
//   ownId(sha, files): the patch id of the pull request's own diff of files at sha (throws when unknown)
// Returns { picked, reused: [{job, sha}], runs: [{job, why}] }.
export function decide({ picked, ai, files, passes, ownId }) {
  const jobs = picked.split(',').filter(Boolean);
  const reused = [];
  const runs = [];
  const keep = [];
  for (const job of jobs) {
    if (!ai.has(job)) { keep.push(job); continue; }
    const earlier = passes(job);
    if (earlier.length === 0) { keep.push(job); runs.push({ job, why: 'no earlier pass on this pull request' }); continue; }
    let now;
    try { now = ownId('head', files(job)); } catch { now = null; }
    if (!now) { keep.push(job); runs.push({ job, why: 'its own change could not be read' }); continue; }
    let found = null;
    for (const sha of earlier) {
      let then = null;
      try { then = ownId(sha, files(job)); } catch { then = null; }
      if (then && then === now) { found = sha; break; }
    }
    if (found) reused.push({ job, sha: found });
    else { keep.push(job); runs.push({ job, why: 'its own change differs from every earlier pass' }); }
  }
  return { picked: keep.length ? `,${keep.join(',')},` : ',', reused, runs };
}

// The id of the pull request's own diff `git diff <mergeBase> <sha>` (limited to <files> when some are given): a hash of the diff with
// its `index` lines and the line numbers of its hunk headers taken out, every other character kept
// (whitespace too), so a merge of main that only moves the lines around a change does not look like a
// different change, and an edit of a single space does. A doubt makes the ids differ, which runs the scenario.
export function patchId(cwd, mergeBase, sha, files) {
  const diff = execFileSync('git', ['diff', '--no-ext-diff', '--no-color', mergeBase, sha, ...(files.length ? ['--', ...files] : [])], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (diff.trim() === '') throw new Error('empty own diff');
  const normal = diff.split('\n').filter((line) => !line.startsWith('index ')).map((line) => line.replace(/^@@ -[\d,]+ \+[\d,]+ @@/, '@@')).join('\n');
  return createHash('sha256').update(normal).digest('hex');
}

// The GitHub command line. The tests stand a node script in for it (REUSE_GH_STUB) so they run anywhere.
const gh = (args) => (process.env.REUSE_GH_STUB
  ? execFileSync(process.execPath, [process.env.REUSE_GH_STUB, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  : execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const ghJson = (args) => JSON.parse(gh(args));

function main() {
  const env = process.env;
  const original = env.PICKED ?? ',';
  const out = (picked) => process.stdout.write(`picked=${picked}\n`);
  const say = (line) => {
    console.error(line);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  };
  // Only a pull request reuses anything: the night, a hand-started run and a candidate run everything.
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return out(original);
  try {
    const repo = env.GITHUB_REPOSITORY;
    const pr = env.PR;
    const head = env.PROOF_SHA;
    const base = env.BASE_REF || 'main';
    const cwd = env.GITHUB_WORKSPACE || process.cwd();
    const workflowPath = env.WORKFLOW_FILE || '.github/workflows/scenarios.yml';
    const jobs = workflowJobs(readFileSync(workflowPath, 'utf8'));
    const ai = new Set(jobs.filter((job) => job.usesAi).map((job) => job.id));
    const nameOf = new Map(jobs.map((job) => [job.id, job.name]));
    const files = () => ownChangePaths();

    // Earlier heads of this pull request whose scenarios run finished with each job's conclusion.
    const runs = ghJson(['api', '--method', 'GET', `repos/${repo}/actions/workflows/scenarios.yml/runs`, '-f', 'event=pull_request', '-f', `branch=${env.HEAD_REF}`, '-f', 'per_page=100'])
      .workflow_runs
      .filter((run) => run.path === '.github/workflows/scenarios.yml' && String(run.id) !== String(env.GITHUB_RUN_ID)
        && (run.pull_requests ?? []).some((p) => String(p.number) === String(pr)))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 10); // the newest few are enough for a pull request kept up to date by merging main in
    const passedBy = new Map(); // job id -> shas, newest first
    for (const run of runs) {
      const list = ghJson(['api', '--method', 'GET', `repos/${repo}/actions/runs/${run.id}/jobs`, '-f', 'filter=latest', '-f', 'per_page=100']).jobs;
      for (const [id, name] of nameOf) {
        if (!ai.has(id)) continue;
        if (list.some((job) => job.name === name && job.conclusion === 'success')) {
          const shas = passedBy.get(id) ?? [];
          if (!shas.includes(run.head_sha) && shas.length < 5) shas.push(run.head_sha);
          passedBy.set(id, shas);
        }
      }
    }

    const fetched = new Set();
    const ids = new Map();
    const ownId = (which, list) => {
      const sha = which === 'head' ? head : which;
      const key = `${sha}|${list.join(',')}`;
      if (ids.has(key)) return ids.get(key);
      const mergeBase = gh(['api', `repos/${repo}/compare/${base}...${sha}`, '--jq', '.merge_base_commit.sha']).trim();
      if (!/^[0-9a-f]{40}$/.test(mergeBase)) throw new Error('no merge base');
      for (const commit of [mergeBase, sha]) {
        if (fetched.has(commit)) continue;
        try { execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd, stdio: 'ignore' }); } catch {
          execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', commit], { cwd, stdio: 'ignore' });
        }
        fetched.add(commit);
      }
      const id = patchId(cwd, mergeBase, sha, list);
      ids.set(key, id);
      return id;
    };

    const result = decide({ picked: original, ai, files, passes: (job) => passedBy.get(job) ?? [], ownId });
    for (const { job, sha } of result.reused) say(`${job}: passed on ${sha.slice(0, 7)}, own change unchanged since (not run again)`);
    for (const { job, why } of result.runs) say(`${job}: runs, ${why}`);
    out(result.picked);
  } catch (error) {
    // Anything unexpected: run everything that was picked, exactly as before.
    say(`Nothing is reused (${String(error.message).split('\n')[0]}); every picked scenario runs.`);
    out(original);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

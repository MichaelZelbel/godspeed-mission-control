#!/usr/bin/env node
// The night's report: one issue per failing scenario, closed again the first night it passes.
//
// Run by the scenarios workflow after a scheduled run (process.md section 5: a nightly job failing
// for a week without telling anyone is a fault). For every scenario in RESULTS:
//   - not "success" (failure, skipped, cancelled, nothing at all): it failed, a scenario that could
//     not run counts as failed. No open issue "Nightly scenario failed: <name>": open one, labelled
//     bug, scenario-failure, and archon-triage. One is open already: add the night to it as a comment.
//   - success, with such an issue open: say so in a comment with the run link, and close it.
// One run never opens more than one issue per scenario. Node built-ins only; GitHub's REST API with
// the workflow's token.
//
// Environment: RESULTS ("name=result name=result ..."), STAGE (the stage job's result, optional),
// CANDIDATE_ONLY (names of jobs that do not run at night, left out), or instead SCENARIO_VERDICTS (the
// collector's "PASS|FAIL <name>: ..." lines, which give both each scenario's result and the exact
// line its issue quotes; set but holding none is an error), GITHUB_TOKEN, GITHUB_REPOSITORY,
// GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_API_URL, NIGHT (default: today, UTC),
// WORKFLOW_FILE (default .github/workflows/scenarios.yml, where the jobs' display names are read).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LABEL = 'scenario-failure';
const LAST_LINES = 25;
const titleOf = (name) => `Nightly scenario failed: ${name}`;

// job id -> display name, from the workflow file's own text.
export function jobNames(text) {
  const names = {};
  let inJobs = false;
  let id = null;
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(line) && !/^#/.test(line)) break;
    let m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) { id = m[1]; continue; }
    m = line.match(/^ {4}name:\s*(.+?)\s*$/);
    if (m && id) names[id] = m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return names;
}

export function parseResults(results, skip = '') {
  const skipped = new Set(skip.split(/\s+/).filter(Boolean));
  const out = new Map(); // a name twice is still one scenario
  for (const pair of (results || '').split(/\s+/).filter(Boolean)) {
    const i = pair.indexOf('=');
    const name = i < 0 ? pair : pair.slice(0, i);
    const result = i < 0 ? '' : pair.slice(i + 1);
    if (skipped.has(name) || out.has(name)) continue;
    out.set(name, result);
  }
  return out;
}

export function verdictLines(text) {
  const lines = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^(PASS|FAIL) ([A-Za-z0-9_-]+): .+$/);
    if (match && !lines.has(match[2])) lines.set(match[2], line);
  }
  return lines;
}

export const lastLines = (log, n = LAST_LINES) =>
  String(log)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').trimEnd())
    .filter((l) => l.trim())
    .slice(-n)
    .join('\n');

export async function reportNight(env = process.env, log = console.log) {
  const repo = env.GITHUB_REPOSITORY;
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const runId = env.GITHUB_RUN_ID;
  if (!repo || !env.GITHUB_TOKEN || !runId) throw new Error('GITHUB_REPOSITORY, GITHUB_TOKEN and GITHUB_RUN_ID are needed');
  const night = env.NIGHT || new Date().toISOString().slice(0, 10);
  const runLink = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${runId}`;
  const verdicts = verdictLines(env.SCENARIO_VERDICTS);
  if (env.SCENARIO_VERDICTS !== undefined && !verdicts.size) throw new Error('SCENARIO_VERDICTS holds no scenario verdict');
  const scenarios = env.SCENARIO_VERDICTS === undefined
    ? parseResults(env.RESULTS, env.CANDIDATE_ONLY)
    : new Map([...verdicts].map(([name, line]) => [name, line.startsWith('PASS ') ? 'success' : 'failure']));

  const call = async (method, path, body, okCodes = []) => {
    const res = await fetch(`${api}/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !okCodes.includes(res.status)) {
      throw new Error(`${method} ${path}: GitHub answered ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    return res;
  };

  // The label.
  if ((await call('GET', `/labels/${LABEL}`, null, [404])).status === 404) {
    await call('POST', '/labels', { name: LABEL, color: 'b60205', description: 'A scenario failed on the nightly run of main' }, [422]);
    log(`created the label ${LABEL}`);
  }

  // Open issues of ours, by title.
  const open = new Map();
  for (let page = 1; ; page++) {
    const items = await (await call('GET', `/issues?state=open&labels=${LABEL}&per_page=100&page=${page}`)).json();
    for (const it of items) if (!it.pull_request && !open.has(it.title)) open.set(it.title, it.number);
    if (items.length < 100) break;
  }

  // What the failed jobs said: the run's jobs by display name, their logs on demand.
  let jobs = null;
  const jobLog = async (scenario) => {
    try {
      if (!jobs) {
        let names = {};
        try { names = jobNames(readFileSync(env.WORKFLOW_FILE || '.github/workflows/scenarios.yml', 'utf8')); } catch {}
        const list = await (await call('GET', `/actions/runs/${runId}/jobs?filter=latest&per_page=100`)).json();
        jobs = { names, list: list.jobs || [] };
      }
      const display = jobs.names[scenario] || scenario;
      const job = jobs.list.find((j) => j.name === display);
      if (!job) return null;
      if (job.conclusion === 'skipped') return { skipped: true };
      return { text: lastLines(await (await call('GET', `/actions/jobs/${job.id}/logs`)).text()) };
    } catch {
      return null;
    }
  };

  // A failed stage ran no scenario, so a verdict's missing record is not the cause the issue should quote.
  const stageEnded = env.STAGE && env.STAGE !== 'success' ? env.STAGE : '';
  const failures = [];
  for (const [name, result] of scenarios) {
    const title = titleOf(name);
    const number = open.get(title);
    if (result === 'success') {
      if (!number) { log(`ok     ${name}: passed, no issue open`); continue; }
      await call('POST', `/issues/${number}/comments`, { body: `Passed on the night of ${night}: ${runLink}\n\nClosing.` });
      await call('PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'completed' });
      log(`closed ${name}: passed, issue #${number} closed`);
      continue;
    }
    const exactVerdict = verdicts.get(name);
    const why = result === 'failure' ? 'failed' : `could not run (its job ended ${result || 'with no result'})`;
    let lines;
    if (exactVerdict && stageEnded) lines = `It did not run: the stage job ended ${stageEnded}.`;
    else if (exactVerdict) lines = exactVerdict;
    else {
      const got = await jobLog(name);
      if (got && got.text) lines = got.text;
      else if (got && got.skipped) lines = `The job did not run${stageEnded ? `: the stage job ended ${stageEnded}` : ''}.`;
      else lines = `The job's log could not be read; the run link has it.`;
    }
    const body = `Night of ${night}: ${name} ${why}.\n\nRun: ${runLink}\n\nThe last lines:\n\n\`\`\`\n${lines}\n\`\`\`\n`;
    if (number) {
      await call('POST', `/issues/${number}/comments`, { body });
      log(`commented ${name}: still failing, night added to #${number}`);
    } else {
      const res = await (await call('POST', '/issues', { title, labels: ['bug', LABEL, 'archon-triage'], body })).json();
      open.set(title, res.number);
      log(`opened ${name}: issue #${res.number}`);
    }
    failures.push(name);
  }
  return { failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reportNight().catch((e) => { console.error(`report-night: ${e.message}`); process.exit(1); });
}

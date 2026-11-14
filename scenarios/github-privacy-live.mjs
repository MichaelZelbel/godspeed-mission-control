// GITHUB'S LIVE ANSWER ABOUT PRIVACY, asked through the product's own request (issue #557).
//
// The reminder scenarios answer GitHub's privacy question for their stand-in repository on the
// machine (scenario-lib.sh stand_in_answers_privacy), so this is the one place a night still asks
// the real api.github.com. It runs the product's own FileSync.verifyRemote, unchanged and without a
// key, as a person's install asks it, about two repositories:
//
//   a public one (octocat/Hello-World): the product has to refuse it as publicly readable;
//   one nobody has (godspeed-scenario-stand-in/<random>): the product has to take GitHub's 404 as
//     private and go on to read it with git. That git step is recorded here, not run, because the
//     repository does not exist; reaching it is what passing the privacy check means.
//
// Any other answer from GitHub (a rate limit's 403 or 429, a 5xx) makes the product refuse with
// "Repository privacy could not be verified". That is asked again after a wait, 3 tries over about
// 2 minutes, and if GitHub still answers so it is a FAIL naming GitHub's status and its rate-limit
// headers. Nothing turns a refusal into a pass.
//
//   node scenarios/github-privacy-live.mjs <the product's notebook/core/sync/git.mjs>
//
// Prints one line, PASS or FAIL, and exits 0 or 1. The waits between tries are seconds, separated
// by spaces, in GODSPEED_PRIVACY_WAITS ("40 80" when unset).
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const [file] = process.argv.slice(2);
if (!file) {
  console.log('FAIL the live GitHub privacy check was not told where the product\'s git.mjs is');
  process.exit(1);
}
const waits = (process.env.GODSPEED_PRIVACY_WAITS ?? '40 80').trim().split(/\s+/).filter(Boolean).map(Number);
if (waits.some(n => !Number.isFinite(n) || n < 0)) {
  console.log(`FAIL GODSPEED_PRIVACY_WAITS is not seconds separated by spaces: ${process.env.GODSPEED_PRIVACY_WAITS}`);
  process.exit(1);
}

let FileSync;
try {
  ({ FileSync } = await import(pathToFileURL(file).href));
} catch (error) {
  console.log(`FAIL the product's sync code could not be loaded from ${file}: ${error.message}`);
  process.exit(1);
}
if (typeof FileSync?.prototype?.verifyRemote !== 'function') {
  console.log(`FAIL ${file} has no FileSync.verifyRemote, so there is no product request to ask GitHub with`);
  process.exit(1);
}

// What GitHub answered, read off the product's own request as it passes: the request and the
// response go through untouched.
let last = null;
const real = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const response = await real(url, ...rest);
  if (String(url).startsWith('https://api.github.com/')) {
    const h = name => response.headers.get(name);
    last = {
      url: String(url),
      status: response.status,
      limits: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-resource', 'retry-after']
        .filter(name => h(name) !== null)
        .map(name => `${name}: ${h(name)}`)
        .join(', ') || 'no rate-limit headers',
    };
  }
  return response;
};

// One ask through the product's verifyRemote. Its only use of `this` is the git step after the
// privacy answer, which is recorded instead of run.
async function ask(address) {
  last = null;
  let reachedGit = false;
  const self = { git(args) { if (args[0] === 'ls-remote') reachedGit = true; return ''; } };
  try {
    await FileSync.prototype.verifyRemote.call(self, address);
    return { refused: null, reachedGit, github: last };
  } catch (error) {
    return { refused: error.message, reachedGit, github: last };
  }
}

const said = r => r.github
  ? `GitHub answered ${r.github.status} to ${r.github.url} (${r.github.limits})`
  : 'GitHub was not reached';
const unverified = r => /could not be verified/.test(r.refused || '') || (r.refused && !r.github);

const cases = [
  {
    name: 'a public repository',
    address: 'https://github.com/octocat/Hello-World.git',
    right: r => /publicly readable/.test(r.refused || '') && r.github?.status === 200,
    wrong: r => r.refused === null
      ? `the product let a public repository through as private; ${said(r)}`
      : `the product refused a public repository with "${r.refused}" instead of calling it publicly readable; ${said(r)}`,
  },
  {
    name: 'a repository nobody has',
    address: `https://github.com/godspeed-scenario-stand-in/no-such-${randomBytes(4).toString('hex')}.git`,
    right: r => r.refused === null && r.reachedGit && r.github?.status === 404,
    wrong: r => r.refused
      ? `the product refused a join that should pass its privacy check, with "${r.refused}"; ${said(r)}`
      : `the product passed the privacy check without GitHub's 404 or never read the repository with git; ${said(r)}`,
  },
];

const sleep = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const passed = [];
for (const c of cases) {
  let r;
  for (let attempt = 0; ; attempt++) {
    r = await ask(c.address);
    if (c.right(r) || !unverified(r) || attempt >= waits.length) break;
    console.error(`Asked about ${c.name} (try ${attempt + 1} of ${waits.length + 1}): ${said(r)}; asking again in ${waits[attempt]} seconds`);
    await sleep(waits[attempt]);
  }
  if (!c.right(r)) {
    console.log(`FAIL the live GitHub privacy check, asked about ${c.name}: ${c.wrong(r)}`);
    process.exit(1);
  }
  passed.push(`${c.name} (${r.github.status})`);
}
console.log(`PASS the product's own privacy request, asked of the real api.github.com without a key, refused ${passed[0]} and took ${passed[1]} as private`);

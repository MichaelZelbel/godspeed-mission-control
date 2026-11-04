// Stands in for Telegram's servers for the one program of an install that asks them directly: the
// daily connection check, which calls https://api.telegram.org/bot<token>/getMe through Node's fetch
// and has no address setting to point elsewhere. Loaded with NODE_OPTIONS=--import=file://<this file>.
//
// Only https://api.telegram.org/bot<token>/<method> is answered, from $GODSPEED_SCENARIO_FIXTURE
// (telegram-fixture.json): getMe and getWebhookInfo succeed for the valid token, any other token is
// refused with HTTP 401 as Telegram refuses a revoked one, any other method gets 400. Every other
// address goes to the real fetch untouched. One line per call goes to $GODSPEED_SCENARIO_CALLS:
// "<method> valid|invalid", never the token.
import fs from 'node:fs';

const realFetch = globalThis.fetch;
const TELEGRAM = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/([A-Za-z]+)/;
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? '';
  const match = TELEGRAM.exec(url);
  const fixtureFile = process.env.GODSPEED_SCENARIO_FIXTURE;
  if (!match || !fixtureFile) return realFetch(input, init);
  const [, token, method] = match;
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  if (typeof fixture.valid_token !== 'string' || !fixture.valid_token) {
    throw new Error(`${fixtureFile} has no valid_token: it is not a telegram-fixture.json written by scenario-lib.sh`);
  }
  const valid = token === fixture.valid_token;
  if (process.env.GODSPEED_SCENARIO_CALLS) {
    fs.appendFileSync(process.env.GODSPEED_SCENARIO_CALLS, `${method} ${valid ? 'valid' : 'invalid'}\n`);
  }
  if (!valid) return json(401, { ok: false, error_code: 401, description: 'Unauthorized' });
  if (method === 'getMe') {
    return json(200, { ok: true, result: { id: fixture.bot_id, is_bot: true, first_name: 'Scenario', username: 'scenario_bot' } });
  }
  if (method === 'getWebhookInfo') return json(200, { ok: true, result: { url: '', pending_update_count: 0 } });
  return json(400, { ok: false, error_code: 400, description: 'Bad Request' });
};

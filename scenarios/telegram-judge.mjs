// What the Telegram scenarios read out of their evidence, so the shell scripts that judge it never
// parse JSON themselves (scenario-lib.sh wraps these as no_code_in, outbox_between and friends).
//
//   node telegram-judge.mjs codes <run.json> [<approvals.json>...]
//        exit 1 and one line when any message sent in the run holds a code the owner would have to type
//   node telegram-judge.mjs messages <run.json> <label>[,<label>...] [accepted]
//        one JSON-quoted text per line: what was sent during those steps, refused sends too
//   node telegram-judge.mjs buttons <run.json> <label> <text it holds>
//        how many messages of that label carrying the text have buttons
//   node telegram-judge.mjs failed <run.json>
//        exit 1 and "<label>: <kind>: <error>" for the first step that did not succeed
//   node telegram-judge.mjs status <approvals.json> <text>
//        the status of each waiting-step record whose row holds <text>, one per line
//   node telegram-judge.mjs recorded <run.json> <label> <conversation_messages.json> <report-facts.json>
//        whether the report sent in <label> is recorded as a background message of the chat, with the
//        facts it was written from: "ok", "not-sent", "not-recorded" or "facts-differ"
//   node telegram-judge.mjs deadlines <due.json> [<due before.json>]
//        "<state><TAB><title><TAB><slug>" of each deadline (by slug) that the earlier snapshot did not hold
//   node telegram-judge.mjs state <due.json> <slug>
//        the state of the deadline with that slug, or "absent"
//   node telegram-judge.mjs bell <notifications.json> <notifications before.json> [connection]
//        one JSON-quoted text per line of each bell record the earlier snapshot did not hold; with
//        "connection", only how many of them are connection-* records
//   node telegram-judge.mjs waiting <approvals.json>
//        how many records have status "pending"
import fs from 'node:fs';

const [command, file, ...rest] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const rows = (name) => {
  const data = read(name);
  return Array.isArray(data) ? data : data.data ?? [];
};
const outbox = () => {
  const { outbox: sent } = read(file);
  if (!Array.isArray(sent)) throw new Error(`${file} has no outbox: it is not a run.json written by owner-on-telegram.py`);
  return sent;
};
const requiredSteps = () => {
  const { steps } = read(file);
  if (!Array.isArray(steps)) throw new Error(`${file} has no steps: it is not a run.json written by owner-on-telegram.py`);
  return steps;
};
const labelled = (labels) => outbox().filter((m) => labels.split(',').includes(m.label));

// "approve 59f1d506", "reject aad2598f", "/approve x1": a command word, then an id with a digit.
const COMMAND_WITH_ID = /(?:\/(?:approve|reject)\b|\b(?:approve|reject)[\s"'`]{0,3}(?=[0-9A-Za-z_-]*\d)[0-9A-Za-z_-]{4,})/i;
// A hex id of six or more that holds a digit and a letter a-f ("decade", "facade", "20261104" are not ids).
const HEX_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}\b/i;

function codesIn(text, knownIds) {
  const found = COMMAND_WITH_ID.exec(text) ?? HEX_ID.exec(text);
  if (found) return found[0];
  for (const id of knownIds) if (text.includes(id) || text.includes(id.slice(0, 8))) return id;
  return null;
}

if (command === 'codes') {
  const ids = new Set();
  for (const name of rest) for (const row of rows(name)) if (typeof row?.id === 'string' && row.id.length >= 6) ids.add(row.id);
  for (const message of outbox()) {
    const match = codesIn(message.text, ids);
    if (match) {
      console.log(`"${message.text.replace(/\s+/g, ' ').slice(0, 200)}" holds "${match}"`);
      process.exit(1);
    }
  }
} else if (command === 'messages') {
  const accepted = rest[1] === 'accepted';
  for (const m of labelled(rest[0])) if (!accepted || m.accepted) console.log(JSON.stringify(m.text));
} else if (command === 'buttons') {
  const [label, needle] = rest;
  console.log(labelled(label).filter((m) => m.buttons.length && m.text.toLowerCase().includes(needle.toLowerCase())).length);
} else if (command === 'failed') {
  const step = requiredSteps().find((s) => !s.success);
  if (step) {
    console.log(`${step.label}: ${step.kind}: ${String(step.error ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
    process.exit(1);
  }
} else if (command === 'status') {
  for (const row of rows(file)) if (JSON.stringify(row).toLowerCase().includes(rest[0].toLowerCase())) console.log(row.status ?? '');
} else if (command === 'recorded') {
  const [label, messagesFile, factsFile] = rest;
  const sent = labelled(label).filter((m) => m.accepted);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const parsed = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } };
  const record = sent.length === 1 && rows(messagesFile).find((r) => r?.source_app === 'background' && String(r.content ?? '').trim() === sent[0].text.trim());
  const facts = parsed(record?.report)?.facts ?? parsed(record?.report_facts);
  console.log(sent.length !== 1 ? 'not-sent' : !record ? 'not-recorded' : same(facts, read(factsFile)) ? 'ok' : 'facts-differ');
} else if (command === 'deadlines') {
  const key = (r) => r?.slug ?? r?.id;
  const known = new Set(rest[0] ? rows(rest[0]).map(key) : []);
  for (const r of rows(file)) if (!known.has(key(r))) console.log(`${r.state ?? ''}\t${r.title ?? ''}\t${key(r) ?? ''}`);
} else if (command === 'state') {
  console.log(rows(file).find((r) => (r?.slug ?? r?.id) === rest[0])?.state ?? 'absent');
} else if (command === 'bell') {
  const known = new Set(rows(rest[0]).map((r) => r?.id));
  const fresh = rows(file).filter((r) => !known.has(r?.id));
  if (rest[1] === 'connection') console.log(fresh.filter((r) => /connection-/.test(JSON.stringify(r))).length);
  else for (const r of fresh) if (/telegram/i.test(JSON.stringify(r))) console.log(JSON.stringify(String(r.body ?? r.text ?? r.message ?? r.title ?? '')));
} else if (command === 'waiting') {
  console.log(rows(file).filter((row) => row?.status === 'pending').length);
} else {
  console.error('telegram-judge.mjs: unknown command ' + command);
  process.exit(2);
}

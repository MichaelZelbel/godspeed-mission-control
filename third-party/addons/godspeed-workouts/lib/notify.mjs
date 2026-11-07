// Messages only when the person can act, at most one per problem:
//   key-refused       Hevy refused the key: only they can make a new one (link: Hevy's page for it);
//   hevy-changed      Hevy's answers no longer look the way the add-on knows: it needs an update;
//   notebook-refused  the notebook refused a row: something to look at;
//   run-failed        the run stopped with an error of its own.
// Hevy or the notebook not answering is not said: nothing is lost, the next hour tries again, and
// `godspeed-workouts status` shows it.
//
// A problem is said once it was seen in two runs in a row (one odd answer is not a problem), and
// never again while it lasts: the key "<kind>:<since>" is kept in `told` before the channels get the
// message, so a crash in that moment never makes the person hear it twice. When it is over and comes
// back later, that is a new problem with a new "since".
import { tell as tellChannels } from "./channels/index.mjs";
import { dayWords } from "./clock.mjs";
import { collectionLink } from "./notebook.mjs";

export const SAID = ["key-refused", "hevy-changed", "notebook-refused", "run-failed"];
export const KEY_PAGE = "https://hevy.com/settings?developer";
export const UPDATE_PAGE = "https://github.com/MichaelZelbel/godspeed-workouts#update";

export function setProblem(c, kind, why) {
  const at = c.now().toISOString();
  c.state.problems ||= {};
  const p = c.state.problems[kind];
  c.state.problems[kind] = p ? { ...p, last: at, runs: (p.runs || 1) + 1, why } : { since: at, last: at, runs: 1, why };
}

export function clearProblem(c, kind) {
  if (c.state.problems?.[kind]) {
    c.log(`over: ${kind} (since ${c.state.problems[kind].since})`);
    delete c.state.problems[kind];
  }
}

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const short = (why) => String(why || "").replace(/\s+/g, " ").replace(/\bhttps?:\/\/\S+/g, "").slice(0, 140).trim();

export function messageFor(c, kind, p) {
  const t = c.settings.texts, tz = c.tz || "UTC";
  const vars = { since: dayWords(p.since, tz), why: short(p.why) };
  const tracker = collectionLink(c.state.web, c.state.collection?.slug);
  if (kind === "key-refused") return { text: `${t.key_refused} ${KEY_PAGE}`, link: KEY_PAGE };
  if (kind === "hevy-changed") return { text: `${fill(t.hevy_changed, vars)} ${UPDATE_PAGE}`, link: UPDATE_PAGE };
  const link = tracker || UPDATE_PAGE;
  if (kind === "notebook-refused") return { text: `${fill(t.notebook_refused, vars)} ${link}`, link };
  return { text: `${fill(t.run_failed, vars)} ${link}`, link };
}

export async function notifyStep(c) {
  const st = c.state;
  st.told ||= {};
  const due = Object.entries(st.problems || {}).filter(([kind, p]) => SAID.includes(kind) && (p.runs || 1) >= 2 && !st.told[`${kind}:${p.since}`]);
  if (!due.length) return { sent: 0 };
  const send = c.tell || ((text, opts) => tellChannels(text, { settings: c.settings, env: c.env, log: c.log, ...opts }));
  let sent = 0;
  for (const [kind, p] of due) {
    const key = `${kind}:${p.since}`;
    const { text, link } = messageFor(c, kind, p);
    st.told[key] = c.now().toISOString();
    c.saveState();
    let res;
    try { res = await send(text, { link }); } catch (e) { res = { delivered: false, results: { error: e.message } }; }
    if (res?.delivered) { sent++; c.log(`message sent: ${kind}`); }
    else {
      // No channel took it: said again next run, never lost.
      delete st.told[key];
      c.log(`the message about ${kind} was not taken by any channel (${Object.entries(res?.results || {}).map(([k, v]) => `${k}: ${v}`).join("; ")}); again next run`);
    }
  }
  // Keys of problems long over are forgotten after 90 days.
  const old = c.now().getTime() - 90 * 86400e3;
  for (const [k, at] of Object.entries(st.told)) if (Date.parse(at) < old) delete st.told[k];
  return { sent };
}

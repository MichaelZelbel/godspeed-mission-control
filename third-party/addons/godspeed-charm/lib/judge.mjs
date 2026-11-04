// The program's own judgement of a message while a Charm Challenge runs: is it a slip the person
// should be asked about, a plain yes or no to an open question, or nothing for the Charm Challenge?
// The model that does the person's work no longer decides that for itself; this answer is what the
// Hermes plugin acts on. Reads nothing and writes nothing itself: the command hands it the state.
import { spawnSync } from "node:child_process";
import { isFinishDay } from "./brief.mjs";
import { SLIP, ONLY_AI } from "./context.mjs";
import { pickLanguage } from "./texts.mjs";
import { isYes, isNo, isExplicitReset } from "./words.mjs";

export const MODEL_SECONDS = 15;

const none = (why) => ({ verdict: "none", source: "rule", why });

// Contempt and blame aimed at the assistant or its work, English and German. Whole words only.
const CONTEMPT = [
  "garbage", "rubbish", "useless", "worthless", "pathetic", "incompetent", "stupid", "idiot", "a mess", "wrong again",
  "do you even", "are you even", "you ignored", "you never listen", "you always get", "can you never",
  "Müll", "nutzlos", "wertlos", "Schrott", "Mist", "Blödsinn", "dumm", "unfähig", "schon wieder falsch", "wieder falsch",
  "ein Chaos", "hast du überhaupt", "hörst du überhaupt", "du hörst nie zu", "du ignorierst",
];
const CONTEMPT_AT = new RegExp(`(?<![\\p{L}])(?:${CONTEMPT.map((p) => p.replace(/ /g, "\\s+")).join("|")})(?![\\p{L}])`, "iu");
const GERMAN_AT = /(?<![\p{L}])(?:der|die|das|und|nicht|ich|du|ist|schon|wieder|warum|immer|mir|Müll|nutzlos|Schrott|Mist)(?![\p{L}])/giu;
const looksGerman = (words) => (words.match(GERMAN_AT) ?? []).length >= 2;

const wordCheck = (words, fallbackLanguage, why) => ({
  verdict: CONTEMPT_AT.test(words) ? "ask" : "none",
  language: looksGerman(words) ? "de" : fallbackLanguage,
  source: "words",
  why,
});

const SYSTEM =
  "You decide whether one message a person sent to their AI assistant is a slip in their Charm Challenge. " +
  `${SLIP} ${ONLY_AI} When you cannot tell, answer unsure. ` +
  'Answer with exactly one JSON object and nothing else: {"verdict":"slip"|"not"|"unsure","language":"en"|"de"}, ' +
  "where language is the language of the message.";

// The installation's godspeed-model: the request as JSON on stdin, {"text": ...} as the last line.
// Returns {verdict, language} or {failed: <why>}.
function askModel(command, words, timeoutMs) {
  const request = JSON.stringify({ system: SYSTEM, prompt: `The message:\n\n${words}`, timeout_ms: timeoutMs, max_tokens: 60 });
  const r = spawnSync(command, [], {
    input: request, encoding: "utf8", timeout: timeoutMs, windowsHide: true,
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
  });
  if (r.error) return { failed: r.error.code === "ETIMEDOUT" ? "model-timed-out" : "model-command-failed" };
  if (r.status !== 0) return { failed: "model-request-failed" };
  try {
    const text = JSON.parse(r.stdout.trim().split("\n").pop()).text;
    const answer = JSON.parse(String(text).match(/\{[^{}]*\}/)?.[0]);
    if (!["slip", "not", "unsure"].includes(answer.verdict)) return { failed: "model-answer-not-understood" };
    return { verdict: answer.verdict, language: ["en", "de"].includes(answer.language) ? answer.language : null };
  } catch {
    return { failed: "model-answer-not-understood" };
  }
}

// judge({state, settings, today, conversation, words, scheduled, language, modelCommand, noModel, timeoutMs})
// -> {verdict: "ask"|"answer"|"none", answer?, language?, source: "rule"|"model"|"words", why}
export function judge({ state, settings = {}, today, conversation = "", words = "", scheduled = false, language, modelCommand = "", noModel = false, timeoutMs = MODEL_SECONDS * 1000 }) {
  const text = String(words ?? "").trim();
  const conv = String(conversation ?? "").trim();
  if (scheduled) return none("scheduled run");
  if (!conv) return none("no conversation");
  if (!state?.running || isFinishDay(state, today)) return none(state?.running ? "finish day" : "no challenge running");
  if (state.resetToday) return none("reset today");
  if (!text) return none("no words");
  if (text.startsWith("/")) return none("a command");
  const lang = pickLanguage(language, settings?.language);
  if (state.open?.some((q) => q.conversation === conv)) {
    if (isYes(text)) return { verdict: "answer", answer: "yes", language: lang, source: "rule", why: "a yes to the open question" };
    if (isNo(text)) return { verdict: "answer", answer: "no", language: lang, source: "rule", why: "a no to the open question" };
  }
  if (isExplicitReset(text)) return none("an explicit reset request");
  let why = "no-model-command";
  if (modelCommand && !noModel) {
    const asked = askModel(modelCommand, text, timeoutMs);
    if (!asked.failed) return { verdict: asked.verdict === "not" ? "none" : "ask", language: asked.language ?? lang, source: "model", why: `the model said ${asked.verdict}` };
    why = asked.failed;
  } else if (noModel) why = "no-model requested";
  return wordCheck(text, lang, why);
}

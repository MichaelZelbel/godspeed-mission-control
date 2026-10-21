// The note the model reads before the person's message while a Charm Challenge runs: the
// [godspeed-charm] block, like the journal's and the coach's. The model reads it and the person
// never does, so it is plain English whatever language they speak; every sentence the person
// hears is quoted from texts.mjs, in both languages, word for word.
// Pure: no reading, no writing, so the notebook's chat can call it with a state it already has.
import { LENGTH } from "./count.mjs";
import { T, formatDay, pickLanguage } from "./texts.mjs";
import { isFinishDay } from "./brief.mjs";

const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;
const NAMES = { en: "English", de: "German" };
// A sentence the person hears: in their usual language first, the other one beside it.
function said(lang, text) {
  const other = lang === "de" ? "en" : "de";
  return `"${text(lang)}" (${NAMES[other]}: "${text(other)}")`;
}
// Their words, on one line and short enough not to crowd the note.
function shortWords(words, max = 160) {
  const one = String(words ?? "").replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 3).trimEnd() + "..." : one;
}
const quoted = (value) => JSON.stringify(String(value));

// Where no conversation id reached the block, nothing can be recorded, so the reply offers the
// words that reset instead of a question a bare yes could not answer.
const NO_ID = {
  en: () => `That sounded like a slip. To go back to ${LENGTH}, say: charm slip.`,
  de: () => `Das klang nach einem Ausrutscher. Wenn du zurück auf ${LENGTH} willst, sag: charm slip.`,
};

const SLIP =
  'A slip is venting at the assistant instead of saying what to fix: insults, sarcasm, contempt, "why do you give me this garbage?", ' +
  "or arguing about the mistake instead of asking for the correction. A firm correction is not a slip " +
  '("The deadline is wrong. Check the client\'s message and fix the draft.").';
const ONLY_AI = "Only how they talk to you or to another AI they mention counts; never ask about anger at people, traffic or the weather.";
const KIND = "At most once per message. Never lecture, and never refuse or delay the work because of a slip.";
const COMMANDS =
  "After a godspeed-charm command, reply with its reply word for word; pass --language de when their message is German, " +
  "and --words-file <file> instead of --words when their words hold quotes or line breaks.";

// contextBlock(state, settings, {conversation, scheduled, today, language}): "" when scheduled, or
// when no challenge runs and it is not the finish day. `conversation` names where this message
// came from ("telegram:<chat>", "claude:<session>", "notebook:<id>"): only there does a bare
// yes or no answer the open question.
export function contextBlock(state, settings = {}, { conversation = "", scheduled = false, today, language } = {}) {
  if (scheduled || !state) return "";
  const lang = pickLanguage(language, settings?.language);
  if (isFinishDay(state, today)) return finishBlock(state, lang);
  if (!state.running) return "";
  const conv = typeof conversation === "string" ? conversation.trim() : "";

  const L = [
    `[godspeed-charm] The person is doing the Charm Challenge: day ${state.day} of ${LENGTH}, ${days(state.daysToGo)} to go, ` +
      `done on ${formatDay(state.end, "en")}. It is about how they talk to AI: charming it into the result instead of arguing. A slip they agree to sends the count back to ${LENGTH}.`,
  ];
  if (state.resetToday) {
    L.push("A reset already happened today: don't ask about slips today.");
    L.push('If they ask to reset in words ("charm slip", "reset my Charm Challenge"): run godspeed-charm slip --words "<their words>".');
  } else if (conv) {
    L.push(SLIP, ONLY_AI);
    L.push(
      "If this message is a slip, or might be one: first do everything it asked, then end your reply with this one question, " +
        `in the language of their message: ${said(lang, (l) => T[l].question())}. When unsure, ask. ${KIND}`,
    );
    L.push(`When you ask, record it in the same turn: godspeed-charm asked --conversation ${quoted(conv)} --words "<their words>"`);
    L.push(
      'If they report a slip themselves, here or about another AI ("charm slip", "reset my Charm Challenge", "I yelled at Copilot"): ' +
        'run godspeed-charm slip --words "<their words>". It resets only on a plain request like "charm slip"; anything else it refuses, ' +
        "and you end your reply with the question above instead (and record it).",
    );
  } else {
    L.push(SLIP, ONLY_AI);
    L.push(
      "If this message is a slip, or might be one: first do everything it asked, then end your reply with this, " +
        `in the language of their message: ${said(lang, (l) => NO_ID[l]())}. When unsure, say it. ${KIND}`,
    );
    L.push('This conversation has no id here, so no question can be recorded and a bare yes or no cannot answer one: the person resets only in words ("charm slip").');
    L.push('If they report a slip themselves ("charm slip", "reset my Charm Challenge"): run godspeed-charm slip --words "<their words>".');
  }
  const open = conv ? state.open?.find((q) => q.conversation === conv) : null;
  if (open) {
    L.push(
      `Open question in this conversation: after their words "${shortWords(open.words)}" earlier today, you asked whether to go back to ${LENGTH}. ` +
        `If this message answers it with a yes ("yes", "ja", "reset", "fair"), run godspeed-charm answer yes --conversation ${quoted(conv)} --words "<their words>"; ` +
        `with a no ("no", "nein", "that didn't count"), run godspeed-charm answer no --conversation ${quoted(conv)} --words "<their words>". ` +
        "Anything else leaves it open: answer the message as usual.",
    );
  }
  L.push(COMMANDS);
  return L.join("\n");
}

// The finish day (needsFinish, or the finish written today): the finish line once, a new round,
// one celebrating sticker where the sticker plugin is installed, and no more slip questions.
function finishBlock(state, lang) {
  return [
    `[godspeed-charm] The person finished the Charm Challenge today: ${LENGTH} days in a row.`,
    "Say this once, at the start of your reply and in the language of their message, unless you already said it in this conversation: " +
      `${said(lang, (l) => T[l].finish(state))}. Then answer their message as usual.`,
    'Offer a new round; if they want one, run godspeed-charm start --words "<their words>" and reply with its reply word for word.',
    "On Telegram, if the hermes-telegram-stickers plugin is installed (your instructions then mention tags like [[sticker:done]]), " +
      "end that reply with [[sticker:party]] for one celebrating sticker; otherwise add no tag.",
    "The challenge is over: don't ask about slips.",
    "Pass --language de to godspeed-charm when their message is German.",
  ].join("\n");
}

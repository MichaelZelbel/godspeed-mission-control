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
// A value inside the note, quoted so that quotes in it cannot break the sentence around it.
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
// A refusal's text is for the model, never for the person: only a success is passed on.
const COMMANDS =
  "When a godspeed-charm command succeeds, use its reply word for word. When it refuses, never pass its text on; do what this note says. " +
  "Pass --language de when their message is German, and --words-file <file> instead of --words when their words hold quotes or line breaks.";
// Starting while it runs asks whether to start over, a question that belongs to this conversation.
const startCommand = (conv) => `godspeed-charm start ${conv ? `--conversation ${quoted(conv)} ` : ""}--words "<their words>"`;

// contextBlock(state, settings, {conversation, scheduled, today, language, stickers}): "" when
// scheduled, or when no challenge runs and it is not the finish day. `conversation` names where
// this message came from ("telegram:<chat>", "claude:<session>", "notebook:<id>"): only there does
// a bare yes or no answer the open question. `stickers` is true only when the caller knows the
// hermes-telegram-stickers plugin will turn a tag into a sticker (R13).
export function contextBlock(state, settings = {}, { conversation = "", scheduled = false, today, language, stickers = false } = {}) {
  if (scheduled || !state) return "";
  const lang = pickLanguage(language, settings?.language);
  const conv = typeof conversation === "string" ? conversation.trim() : "";
  if (isFinishDay(state, today)) return finishBlock(state, lang, conv, stickers === true);
  if (!state.running) return "";

  const L = [
    `[godspeed-charm] The person is doing the Charm Challenge: day ${state.day} of ${LENGTH}, ${days(state.daysToGo)} to go, ` +
      `done on ${formatDay(state.end, "en")}. It is about how they talk to AI: charming it into the result instead of arguing. A slip they agree to sends the count back to ${LENGTH}.`,
  ];
  if (state.resetToday) {
    L.push("A reset already happened today: don't ask about slips today.");
    L.push('If they report a slip themselves ("charm slip", "I yelled at Copilot"): run godspeed-charm slip --words "<their words>" and use its reply.');
  } else if (conv) {
    L.push(SLIP, ONLY_AI);
    L.push(
      "If this message is a slip, or might be one: first do everything it asked, then end your reply with this one question, " +
        `in the language of their message: ${said(lang, (l) => T[l].question())}. When unsure, ask. ${KIND}`,
    );
    L.push(`When you ask, record it in the same turn: godspeed-charm asked --conversation ${quoted(conv)} --words "<their words>"`);
    L.push(
      'If they report a slip themselves, here or about another AI ("charm slip", "reset my Charm Challenge", "I yelled at Copilot"): ' +
        'run godspeed-charm slip --words "<their words>". It resets only on a plain request like "charm slip". ' +
        `When it refuses, run godspeed-charm asked --conversation ${quoted(conv)} --words "<their words>" and end your reply with its reply.`,
    );
  } else {
    L.push(SLIP, ONLY_AI);
    L.push(
      "If this message is a slip, or might be one: first do everything it asked, then end your reply with this, " +
        `in the language of their message: ${said(lang, (l) => NO_ID[l]())}. When unsure, say it. ${KIND}`,
    );
    L.push('This conversation has no id here, so no question can be recorded and a bare yes or no cannot answer one: the person resets only in words ("charm slip").');
    L.push(
      'If they report a slip themselves ("charm slip", "reset my Charm Challenge", "I yelled at Copilot"): run godspeed-charm slip --words "<their words>". ' +
        "When it refuses, end your reply with the sentence above.",
    );
  }
  L.push(`If they ask to start the Charm Challenge while it runs: run ${startCommand(conv)}.`);
  const open = conv ? state.open?.find((q) => q.conversation === conv) : null;
  if (open) {
    const words = shortWords(open.words);
    L.push(
      "Open question in this conversation: " +
        (words ? `after their words ${quoted(words)} earlier today, you asked whether to go back to ${LENGTH}. ` : `earlier today you asked whether to go back to ${LENGTH}. `) +
        `If this message answers it with a yes ("yes", "ja", "reset", "fair"), run godspeed-charm answer yes --conversation ${quoted(conv)} --words "<their words>"; ` +
        `with a no ("no", "nein", "that didn't count"), run godspeed-charm answer no --conversation ${quoted(conv)} --words "<their words>". ` +
        "Anything else leaves it open: answer the message as usual.",
    );
  }
  L.push(COMMANDS);
  return L.join("\n");
}

// The finish day (needsFinish, or the finish written today): the finish line and the offer of a
// new round, together and once per conversation, and no more slip questions. A sticker only when
// the caller says the sticker plugin is there: a model left to judge that for itself could send a
// raw tag to someone without the plugin.
function finishBlock(state, lang, conv, stickers) {
  const L = [
    `[godspeed-charm] The person finished the Charm Challenge today: ${LENGTH} days in a row.`,
    "Once in this conversation (skip this if you already did it here): at the start of your reply, in the language of their message, " +
      `say ${said(lang, (l) => T[l].finish(state))} and offer a new round; if they want one, run ${startCommand(conv)}.`,
  ];
  if (stickers) L.push("End that reply with the tag [[sticker:party]]: the hermes-telegram-stickers plugin turns it into one celebrating sticker.");
  L.push("Then answer their message as usual. The challenge is over: don't ask about slips.", COMMANDS);
  return L.join("\n");
}

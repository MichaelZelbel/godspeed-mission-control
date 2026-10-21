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

// The notebook's own chat has no shell: there the model returns `charm` operations, the notebook
// runs the command for it, names the conversation itself and adds each reply to the answer. The
// question after a slip is added at the end of the model's own reply, so the model never writes it.
const op = (fields) => `charm {${fields}, words:<their message>}`;
const NOTEBOOK = {
  asked: op('action:"asked"'),
  slip: op('action:"slip"'),
  start: op('action:"start"'),
  yes: op('action:"answer", answer:"yes"'),
  no: op('action:"answer", answer:"no"'),
  replies: "The notebook adds each charm operation's reply to your answer itself, in the language of their message: never write those sentences yourself.",
};

// contextBlock(state, settings, {conversation, scheduled, today, language, stickers, channel}): ""
// when scheduled, or when no challenge runs and it is not the finish day. `conversation` names where
// this message came from ("telegram:<chat>", "claude:<session>", "notebook:<id>"): only there does
// a bare yes or no answer the open question. `stickers` is true only when the caller knows the
// hermes-telegram-stickers plugin will turn a tag into a sticker (R13). `channel` is "shell" (the
// default: the steps are godspeed-charm commands) or "notebook" (the notebook's own chat, where
// the same steps are charm operations).
export function contextBlock(state, settings = {}, { conversation = "", scheduled = false, today, language, stickers = false, channel = "shell" } = {}) {
  if (scheduled || !state) return "";
  const lang = pickLanguage(language, settings?.language);
  const conv = typeof conversation === "string" ? conversation.trim() : "";
  const notebook = channel === "notebook";
  if (isFinishDay(state, today)) return finishBlock(state, lang, conv, stickers === true, notebook);
  if (!state.running) return "";

  const L = [
    `[godspeed-charm] The person is doing the Charm Challenge: day ${state.day} of ${LENGTH}, ${days(state.daysToGo)} to go, ` +
      `done on ${formatDay(state.end, "en")}. It is about how they talk to AI: charming it into the result instead of arguing. A slip they agree to sends the count back to ${LENGTH}.`,
  ];
  if (state.resetToday) {
    L.push("A reset already happened today: don't ask about slips today.");
    L.push(notebook
      ? `If they report a slip themselves: a plain "charm slip" or "reset my Charm Challenge" is ${NOTEBOOK.slip}; a story of venting at an AI changes nothing today, so it needs no charm operation.`
      : 'If they report a slip themselves ("charm slip", "I yelled at Copilot"): run godspeed-charm slip --words "<their words>" and use its reply.');
  } else if (conv && notebook) {
    L.push(SLIP, ONLY_AI);
    L.push(
      `If this message is a slip, or might be one: first do everything it asked, then add the operation ${NOTEBOOK.asked}. ` +
        `The notebook ends your reply with the one question itself, in the language of their message, so never write it yourself: ` +
        `${said(lang, (l) => T[l].question())}. When unsure, ask. ${KIND}`,
    );
    L.push(
      `If they report a slip themselves, here or about another AI: a plain "charm slip" or "reset my Charm Challenge" is ${NOTEBOOK.slip}, ` +
        `which goes back to ${LENGTH} at once; a story ("I yelled at Copilot") is ${NOTEBOOK.asked}.`,
    );
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
    L.push(notebook
      ? `If they say "charm slip" or "reset my Charm Challenge": ${NOTEBOOK.slip}. For a story of venting at an AI, end your reply with the sentence above.`
      : 'If they report a slip themselves ("charm slip", "reset my Charm Challenge", "I yelled at Copilot"): run godspeed-charm slip --words "<their words>". ' +
        "When it refuses, end your reply with the sentence above.");
  }
  L.push(`If they ask to start the Charm Challenge while it runs: ${notebook ? NOTEBOOK.start : `run ${startCommand(conv)}`}.`);
  const open = conv ? state.open?.find((q) => q.conversation === conv) : null;
  if (open) {
    const words = shortWords(open.words);
    L.push(
      "Open question in this conversation: " +
        (words ? `after their words ${quoted(words)} earlier today, you asked whether to go back to ${LENGTH}. ` : `earlier today you asked whether to go back to ${LENGTH}. `) +
        (notebook
          ? `If this message answers it with a yes ("yes", "ja", "reset", "fair"): ${NOTEBOOK.yes}; with a no ("no", "nein", "that didn't count"): ${NOTEBOOK.no}. `
          : `If this message answers it with a yes ("yes", "ja", "reset", "fair"), run godspeed-charm answer yes --conversation ${quoted(conv)} --words "<their words>"; ` +
            `with a no ("no", "nein", "that didn't count"), run godspeed-charm answer no --conversation ${quoted(conv)} --words "<their words>". `) +
        "Anything else leaves it open: answer the message as usual.",
    );
  }
  L.push(notebook ? NOTEBOOK.replies : COMMANDS);
  return L.join("\n");
}

// The finish day (needsFinish, or the finish written today): the finish line and the offer of a
// new round, together and once per conversation, and no more slip questions. A sticker only when
// the caller says the sticker plugin is there: a model left to judge that for itself could send a
// raw tag to someone without the plugin.
function finishBlock(state, lang, conv, stickers, notebook) {
  const L = [
    `[godspeed-charm] The person finished the Charm Challenge today: ${LENGTH} days in a row.`,
    "Once in this conversation (skip this if you already did it here): at the start of your reply, in the language of their message, " +
      `say ${said(lang, (l) => T[l].finish(state))} and offer a new round; ${notebook ? `when they ask for one by name ("start the Charm Challenge"): ${NOTEBOOK.start}` : `if they want one, run ${startCommand(conv)}`}.`,
  ];
  if (stickers) L.push("End that reply with the tag [[sticker:party]]: the hermes-telegram-stickers plugin turns it into one celebrating sticker.");
  L.push("Then answer their message as usual. The challenge is over: don't ask about slips.", notebook ? NOTEBOOK.replies : COMMANDS);
  return L.join("\n");
}

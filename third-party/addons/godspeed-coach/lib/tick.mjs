// What the no-model job does every 15 minutes. Pure: it returns the messages to send and the writes
// that prove they went out, and the caller does the writing. Empty output is the normal case and
// makes the scheduler stay silent.
import { localParts, addDays, dayWords, atWords, whenSaid } from "./clock.mjs";
import { listAreas, nextTalkDay } from "./areas.mjs";
import { followUpDue, notHeldDue, readTalk } from "./talks.mjs";
import { listHabits, dueOn, answerOn, askedOn, daysWords } from "./habits.mjs";
import { autoTicks } from "./auto.mjs";

export const CHECK_WINDOW_HOURS = 3;

// The only sentences the coach sends without a model writing them. Each arrives on a phone, cold,
// as its own message, often hours after the person last thought about the habit or the talk. So
// each says where it comes from, what they agreed and when, why it asks now, the question, and the
// exact replies and what each one does, including what silence does. The first line is what the
// phone's preview shows, so it carries the source and the subject.
//
// 2026-09-30: "Still up for the health and fitness talk? One line is enough." did not say which
// talk, from when, or what it had asked; "Answer yes, no or skip" did not say what skip does.
const bullets = (items) => items.map((i) => `• ${i}`);
const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
const plain = (t) => clean(t).replace(/[.;:,\s]+$/, "");
const example = (n, yes, no) => Array.from({ length: n }, (_, i) => (i % 2 ? no : yes)).join(" ");
// "Health and fitness" reads "your health and fitness talk" in English; "VRChat" stays as it is.
const inSentence = (t) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

const T = {
  en: {
    one: (h) => [
      `From your coach: ${h.title} today? You planned this habit for ${daysWords(h.days, "en")}, and nothing is tracked for today yet.` +
        (plain(h.doneMeans) ? ` You said it counts as done when: ${plain(h.doneMeans)}.` : ""),
      `Reply "yes" if you did it, "no" if you didn't, or "skip" if today shouldn't count, for example because you were ill. No reply is fine: the day stays blank and I won't ask about it again.`,
    ].join("\n"),
    many: (hs) => [
      `From your coach: ${hs.length} of your habits have nothing tracked for today yet.`,
      ...bullets(hs.map((h) => h.title + (plain(h.doneMeans) ? `, done when: ${plain(h.doneMeans)}` : ""))),
      `Did you do them? Reply yes, no or skip for each, in this order, for example "${example(hs.length, "yes", "no")}", or one word for all of them. "skip" means today shouldn't count, for example because you were ill. No reply is fine: the day stays blank and I won't ask about it again.`,
    ].join("\n"),
    follow: ({ title, when, opening, next }) => [
      `From your coach: ${when} I opened your ${inSentence(title)} talk, and it is still waiting for your reply.`,
      ...(opening ? [`It started with: "${opening}"`] : []),
      `Still up for it? Just answer, a line is enough, and we carry on from there. No reply is fine: I won't bring it up again` +
        (next ? `, and the next ${inSentence(title)} talk is ${next}.` : "."),
    ].join("\n"),
  },
  de: {
    one: (h) => [
      `Von deinem Coach: ${h.title} heute? Du hast dir diese Gewohnheit für ${daysWords(h.days, "de")} vorgenommen, und für heute ist noch nichts eingetragen.` +
        (plain(h.doneMeans) ? ` Erledigt ist sie laut dir, wenn: ${plain(h.doneMeans)}.` : ""),
      "Antworte „ja“, wenn du es gemacht hast, „nein“, wenn nicht, oder „skip“, wenn heute nicht zählen soll, zum Beispiel weil du krank warst. Keine Antwort ist auch in Ordnung: Der Tag bleibt leer, und ich frage nicht noch einmal danach.",
    ].join("\n"),
    many: (hs) => [
      `Von deinem Coach: Für ${hs.length} deiner Gewohnheiten ist heute noch nichts eingetragen.`,
      ...bullets(hs.map((h) => h.title + (plain(h.doneMeans) ? `, erledigt, wenn: ${plain(h.doneMeans)}` : ""))),
      `Hast du sie gemacht? Antworte für jede mit ja, nein oder skip, in dieser Reihenfolge, zum Beispiel „${example(hs.length, "ja", "nein")}“, oder mit einem Wort für alle. „skip“ heißt: Heute soll nicht zählen, zum Beispiel weil du krank warst. Keine Antwort ist auch in Ordnung: Der Tag bleibt leer, und ich frage nicht noch einmal danach.`,
    ].join("\n"),
    follow: ({ title, when, opening, next }) => [
      `Von deinem Coach: Ich habe ${when} dein Gespräch über ${title} begonnen, und es wartet noch auf deine Antwort.`,
      ...(opening ? [`Es fing so an: „${opening}“`] : []),
      `Noch Lust darauf? Antworte einfach, eine Zeile reicht, dann machen wir dort weiter. Keine Antwort ist auch in Ordnung: Ich spreche es nicht noch einmal an` +
        (next ? `, und das nächste Gespräch über ${title} ist ${next}.` : "."),
    ].join("\n"),
  },
};

export function pendingHabits(habits, ymd) {
  return habits.filter((h) => dueOn(h, ymd) && !h.auto && !answerOn(h, ymd));
}

export function dueTick(mcDir, s, now, table = {}) {
  const messages = []; const writes = [];
  const lang = T[s.language] ? s.language : "en";
  const txt = T[lang];
  const lp = localParts(now, s.timezone);
  const active = listHabits(mcDir, { status: "active" });

  for (const t of autoTicks(active, table, [addDays(lp.date, -2), addDays(lp.date, -1), lp.date])) {
    writes.push({ kind: "auto", habit: t.habit, ymd: t.ymd, words: t.words });
  }
  const autoToday = new Set(writes.filter((w) => w.ymd === lp.date).map((w) => w.habit.slug));

  for (const a of listAreas(mcDir)) {
    for (const d of notHeldDue(a, now, s.timezone)) writes.push({ kind: "not-held", area: a, ymd: d });
    const f = followUpDue(a, now, s.timezone);
    if (f) {
      const talk = readTalk(a, f);
      const next = nextTalkDay(a, lp.date);
      messages.push(txt.follow({
        title: a.title,
        when: talk.opened ? whenSaid(talk.opened, now, s.timezone, lang) : `${dayWords(f, lp.date, lang)} ${atWords(a.time, lang)}`,
        opening: clean(talk.sections["The opening"]),
        next: next ? `${dayWords(next, lp.date, lang)} ${atWords(a.time, lang)}` : "",
      }));
      writes.push({ kind: "follow-up", area: a, ymd: f, at: now.toISOString().replace(/\.\d+Z$/, "Z") });
    }
  }

  const [h, m] = s.habit_check_at.split(":").map(Number);
  const [nh, nm] = lp.hm.split(":").map(Number);
  const mins = nh * 60 + nm - (h * 60 + m);
  const alreadyAsked = active.some((x) => askedOn(x, lp.date));
  if (mins >= 0 && mins <= CHECK_WINDOW_HOURS * 60 && !alreadyAsked) {
    const pending = pendingHabits(active, lp.date).filter((x) => !autoToday.has(x.slug));
    if (pending.length) {
      messages.push(pending.length === 1 ? txt.one(pending[0]) : txt.many(pending));
      for (const x of pending) writes.push({ kind: "asked", habit: x, ymd: lp.date });
    }
  }
  return { messages, writes };
}

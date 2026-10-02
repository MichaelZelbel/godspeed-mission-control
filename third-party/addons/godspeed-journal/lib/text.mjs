// The only sentences the journal sends without a model writing them. Each one arrives on a phone,
// cold, as its own message, often hours after the person last thought about the task. So each
// says where it comes from, what they recorded and when, what done meant, what is being asked,
// and the exact replies and what each one does, including what silence does. The first line is
// what the phone's preview shows, so it carries the source and the task.
//
// 2026-09-30: the one-line versions ("Still on "Tofu" (since Mon 22:09), or did it turn into
// something else?") were short and unreadable. The person could not tell which journal, which
// task, or what to answer.
const bullets = (items) => items.map((i) => `• ${i}`);

const STRINGS = {
  en: {
    nudge: ({ title, when, doneMeans = [], record = "", lastNote = "", last = true }) => [
      `From your journal: ${when} you started "${title}".` +
        (doneMeans.length ? ` You said it is done when: ${doneMeans.join("; ")}.` : "") +
        (record ? ` ${record}` : "") +
        (lastNote ? ` Your last note about it was ${lastNote}.` : " Nothing about it has been noted since."),
      `Is it done, or are you still on it? Reply "done" and I'll check it against what you said done means, reply "still on it" and it stays open, or tell me what you're doing instead. ` +
        (last ? "No reply is fine: it stays open and I won't ask about it again." : "No reply is fine: it stays open, and I'll ask once more later."),
    ].join("\n"),
    evening: (open, loose = []) => {
      const example = (open[0] || loose[0]).title;
      if (!open.length) {
        return [
          "From your journal: you finished these without everything you said done includes:",
          ...bullets(loose.map((t) => `${t.title}, missing: ${t.missed.join(", ")}`)),
          `If one of them happened after all, reply "done" with its name, for example "done ${example}". No reply is fine; they won't be listed again.`,
        ].join("\n");
      }
      return [
        "From your journal, still open:",
        ...bullets(open.map((t) => `${t.title}, started ${t.when}`)),
        ...(loose.length ? ["Finished, but without everything you said done includes:", ...bullets(loose.map((t) => `${t.title}, missing: ${t.missed.join(", ")}`))] : []),
        `Reply "done" or "drop" with a name, for example "done ${example}". Anything you don't mention stays as it is, and no reply is fine.`,
      ].join("\n");
    },
    weekly: (text) => `Your week in the journal:\n${text}`,
    nothingOn: (names) => `Nothing has gone out on ${names} since.`,
    onRecord: (name, when, title, url) => `On record: the ${name} post${title ? ` "${title}"` : ""} went out ${when}${url ? `, ${url}` : ""}.`,
    or: " or ",
  },
  de: {
    nudge: ({ title, when, doneMeans = [], record = "", lastNote = "", last = true }) => [
      `Aus deinem Tagebuch: Du hast ${when} „${title}" angefangen.` +
        (doneMeans.length ? ` Fertig ist es laut dir, wenn: ${doneMeans.join("; ")}.` : "") +
        (record ? ` ${record}` : "") +
        (lastNote ? ` Deine letzte Notiz dazu war ${lastNote}.` : " Seitdem hast du nichts dazu notiert."),
      `Ist es erledigt, oder bist du noch dran? Antworte „erledigt", dann prüfe ich es gegen das, was du als fertig festgelegt hast, „noch dran", dann bleibt es offen, oder schreib, woran du stattdessen arbeitest. ` +
        (last ? "Keine Antwort ist auch in Ordnung: Es bleibt offen, und ich frage nicht noch einmal danach." : "Keine Antwort ist auch in Ordnung: Es bleibt offen, und ich frage später noch einmal."),
    ].join("\n"),
    evening: (open, loose = []) => {
      const example = (open[0] || loose[0]).title;
      if (!open.length) {
        return [
          "Aus deinem Tagebuch: Diese Aufgaben hast du abgeschlossen, aber ohne alles, was du als fertig festgelegt hattest:",
          ...bullets(loose.map((t) => `${t.title}, es fehlte: ${t.missed.join(", ")}`)),
          `Falls etwas davon doch noch passiert ist, antworte „erledigt" mit dem Namen, zum Beispiel „erledigt ${example}". Keine Antwort ist auch in Ordnung; sie werden nicht noch einmal aufgelistet.`,
        ].join("\n");
      }
      return [
        "Aus deinem Tagebuch, noch offen:",
        ...bullets(open.map((t) => `${t.title}, angefangen ${t.when}`)),
        ...(loose.length ? ["Abgeschlossen, aber ohne alles, was du als fertig festgelegt hattest:", ...bullets(loose.map((t) => `${t.title}, es fehlte: ${t.missed.join(", ")}`))] : []),
        `Antworte „erledigt" oder „streichen" mit dem Namen, zum Beispiel „erledigt ${example}". Was du nicht nennst, bleibt, wie es ist, und keine Antwort ist auch in Ordnung.`,
      ].join("\n");
    },
    weekly: (text) => `Deine Woche im Journal:\n${text}`,
    nothingOn: (names) => `Auf ${names} ist seitdem nichts erschienen.`,
    onRecord: (name, when, title, url) => `Belegt: Der ${name}-Beitrag${title ? ` "${title}"` : ""} ist ${when} erschienen${url ? `, ${url}` : ""}.`,
    or: " oder ",
  },
};

export const T = (settings) => STRINGS[settings.language] || STRINGS.en;
export const EN = STRINGS.en;

# Holdout scenarios

Acceptance checks the agents building the code never see. They are written from the product document,
not from the issues or the code, and they test the space between issues: one rule on every surface,
sequences, what must never happen by any route, and old behaviour that has to keep working.

This file is committed so the team shares it. People read and edit it freely. Agents cannot: the hook
in `.factory/hooks/holdout_fence.py` refuses every agent except the `holdout-writer` and
`holdout-verifier` subagents, and `.ignore` keeps the folder out of searches. The app check and the
manager run these through the verifier, which reports only a verdict and what a user sees.

No scenarios yet. Write the first set before the backlog is built (ask your coding agent to dispatch
the holdout-writer with the product document), or by hand in this form:

```
## H-01 A short title in the user's words
Protects: the product rule it guards (PRD section or rule number)
Touches: the product areas it exercises, so a change is checked only against scenarios it can affect
Setup: the state to start from
Steps: what a user does, through the app's public surface
Expect: what a user sees, exactly where the product document fixes it
Author: owner
```

Scenarios are added and tightened, never loosened, except by the owner with a reason recorded here.

## How these scenarios are run

Each runs black-box against a checkout started as `harness/RUNTIME.md` says: the notebook on a free
port with a new, empty folder, driven through HTTP and, where a scenario says "in the browser", through
the notebook's web pages after a frontend build (never an installer, never sudo). Where a scenario needs
the person's AI, it is a **stand-in AI**: a small local server the verifier runs, connected the way a
person connects their own AI key or endpoint in the app, that answers each request with what the
scenario prepared and records every request and answer. Where it needs the private GitHub copy, two
notebooks on two new folders (computer A and computer B) are joined through one local bare Git
repository standing in for it, connected the way **Connect record sync** in Settings connects one. A
scenario whose setup the app offers no public route to is INCONCLUSIVE, never PASS, and the verifier
says which step had no route. The judges named below are in `judges/` beside this file; run them with
`python3 -I`.

## H-01 One sentence refused in the middle of a paragraph costs only that sentence
Protects: the morning briefing and its checks (MISSION Core capabilities); README beta.20 "a draft that passes is unchanged"; invariant that the person gets every part of the brief that passed
Touches: morning brief, source check
Setup: a fresh folder with one goal, two deadlines with dates and one person, all entered through the app. The stand-in AI answers each request to write the brief with a prepared draft of three paragraphs of three sentences each. Every sentence uses only names, dates and numbers present in the folder, except the second sentence of the second paragraph, which states a deadline for a person named "Zorvath Quellmann" with the amount 4,382, both found nowhere in the folder.
Steps: make the morning brief through the app's public route (run the briefing routine from Settings, Routines, or whatever the app offers to run it now). Read the brief the app saved and shows.
Expect: the brief arrives. All eight grounded sentences arrive word for word in their order, including the first and third sentences of the second paragraph, which stay together as one paragraph. Neither "Zorvath", "Quellmann" nor "4,382" appears anywhere in it. No empty line item, no doubled full stop or comma where the sentence was. Fallback note in place of the brief is a FAIL: the paragraph's good sentences were lost. Judge: `judges/brief_judge.py` with `order_matters: true`.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft; escaped class "repaired per paragraph, not inside it"

## H-02 A refused sentence first, last, or alone leaves no hole
Protects: the morning briefing and its checks (MISSION Core capabilities): every part that passed reaches the person, never a refused sentence
Touches: morning brief, source check
Setup: as H-01, with three separate draft variants, one per run, each on a fresh folder: (a) the brief's very first sentence is the invented one; (b) the brief's very last sentence is; (c) a paragraph that consists of the invented sentence alone, and in the same draft a bulleted list of three items whose middle item is an invented sentence on its own.
Steps: make the brief for each variant and read what the app saved and shows.
Expect: in every variant, every grounded sentence and every grounded list item arrives word for word and in order; no invented name or number appears; the brief does not begin or end with a stray mark, a dangling connective ("And", "Also") lifted from the refused sentence, or an empty bullet; the list keeps its two good items as items. A variant whose brief is the short fallback note, or is missing, is a FAIL. Judge: `judges/brief_judge.py` once per variant.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft

## H-03 Several refused sentences, side by side and far apart
Protects: the morning briefing and its checks (MISSION Core capabilities)
Touches: morning brief, source check
Setup: as H-01, but the draft has five invented sentences out of fifteen: two directly next to each other inside one paragraph, one inside a list item that also holds a grounded sentence ("Call Anna about the move. Zorvath confirmed 4,382 euros."), one under a heading as the heading's only sentence, and one as the last sentence of the brief. Each invented sentence has its own invented name or number.
Steps: make the brief and read it.
Expect: all ten grounded sentences arrive word for word, including the grounded half of the mixed list item, which stays a list item. None of the five invented sentences, and none of their invented names or numbers, appears. Getting only the fallback note when ten sentences passed is a FAIL. Judge: `judges/brief_judge.py`.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft; escaped class "repaired per item, not inside it"

## H-04 When every sentence is refused, the person gets an honest short note
Protects: the morning briefing and its checks (MISSION Core capabilities); README beta.20 (a brief whose drafts fail is a short note built only from facts it can show, with one concrete next step, never nothing)
Touches: morning brief, source check, chat "today's brief"
Setup: as H-01, but every sentence of every draft the stand-in AI writes contains an invented name or number.
Steps: make the brief. Read what the app saved and shows. Then ask the notebook's chat (or the assistant chat the app exposes) for "today's brief".
Expect: there is a brief for today, not an empty page, an error, or silence. It is short, contains no invented name or number and no sentence of the draft, does not claim to be the full brief, and names one concrete next step built from what the folder holds (for example a real deadline from the setup). The chat answers with that same note and the stand-in AI is not asked to write a new brief for it. Judge: `judges/brief_judge.py` with `all_refused: true`, `expect_single_brief: true`; the verifier also quotes the note so a human can judge its honesty.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft

## H-05 The refused sentence is gone on every surface the brief reaches
Protects: one rule, every surface: the morning brief, "today's brief" in the chat (README beta.18: the chat gives the briefing the morning made), and the notebook
Touches: morning brief, source check, chat, notebook pages
Setup: as H-01 (one invented sentence mid-paragraph).
Steps: make the brief. Then, on the very next requests, read it from every place the app shows it: the saved brief file in the person's folder, the notebook (HTTP and, if built, in the browser), the chat's answer to "today's brief" and to "the brief again", and any notice or message the app queues for the person about the brief.
Expect: every surface shows the same filtered brief: the eight grounded sentences present, nothing of the invented sentence present. Asking the chat twice does not make the stand-in AI write a brief again. A surface that shows the unfiltered draft, or a differently filtered one, is a FAIL. The privately kept repair record may hold the refused sentence; it must not be what any of these surfaces shows. Judge: `judges/brief_judge.py` with all surfaces and `expect_single_brief: true`.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft

## H-06 A refused sentence next to a voice-rule cut and the Charm Challenge line
Protects: how the new refusal meets the old cuts: README beta.17 (a sentence breaking a rule in `profile/voice.md` is cut and the rest is sent; a line carried word for word is kept unless it breaks a rule)
Touches: morning brief, source check, voice rules, Charm Challenge
Setup: a folder with a rule in `profile/voice.md` that forbids a word (for example "synergy"), a Charm Challenge started through the chat ("start the Charm Challenge"), and the H-01 facts. The stand-in AI's draft has one paragraph holding, in this order: a grounded sentence, a grounded sentence using "synergy", the invented sentence, a grounded sentence. The Charm Challenge line follows that paragraph.
Steps: make the brief and read it on the saved brief and on the chat's "today's brief".
Expect: the two clean grounded sentences of the paragraph arrive in order; the "synergy" sentence and the invented sentence are both absent; the Charm Challenge line arrives word for word; no repair item claims the Charm Challenge line was left out. Judge: `judges/brief_judge.py` with `voice_cut` and `carried`.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft (meeting existing features)

## H-07 A brief where everything passes is unchanged, and no AI still says so
Protects: old behaviour still works: README beta.20 ("a draft that passes is unchanged, and an install with no AI still says so")
Touches: morning brief, source check
Setup: two fresh folders. One with the stand-in AI and a draft of nine grounded sentences, with a decimal ("3.5 km"), an abbreviation ("Dr. Berger", a person in the folder), a date with dots ("30.11.") and a quoted sentence. The other with no AI connected.
Steps: make the brief on each.
Expect: the first brief contains all nine sentences word for word and in order, the decimal, abbreviation and date not split or cut. The second says in words that there is no AI connected, and is not an error page. Judge: `judges/brief_judge.py` with `order_matters: true` for the first.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft (old behaviour)

## H-08 Refusing a sentence never cuts a good sentence that looks like it
Protects: the morning briefing and its checks (MISSION Core capabilities): good text is never lost because one sentence was refused
Touches: morning brief, source check
Setup: as H-01, but the draft holds a grounded sentence "Your tax return is due on 30 November." and, in another paragraph, an invented sentence that begins with exactly the same words: "Your tax return is due on 30 November, and Zorvath Quellmann files it for 4,382 euros." The grounded sentence also appears a second time, word for word, later in the brief. A grounded sentence with a decimal follows the invented one in its paragraph.
Steps: make the brief and read it.
Expect: both copies of the grounded sentence arrive; the invented sentence is gone whole (no "and Zorvath..." tail, no grounded head left as a fragment ending in a comma); the decimal sentence after it arrives intact. Judge: `judges/brief_judge.py`.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft; escaped class at the level of a sentence's text

## H-09 A large file on the other computer is explained in words, not broken
Protects: the notebook's media (MISSION Core capabilities) across computers joined through the private GitHub copy; README beta.21 (a second computer joined through the private copy gets everything)
Touches: notebook media, record sync, two computers
Setup: computers A and B joined through the stand-in private copy. On A, add to a note through the notebook a picture of 110 MB (larger than any single file GitHub accepts) and sync. Sync B.
Steps: on B, open the note and the media list (HTTP, and in the browser when built). Open the large file's card, and ask for the file itself the way the card's link or preview does.
Expect: on B the note and a card for the file are there. The card says in plain words that the file is kept on the other computer, naming that computer the way the app names it elsewhere when it has a name for it, and that it is not on this one. No broken-image icon, no empty frame, no endless spinner, and no bare error ("404", "Not found", "Failed to load", a code or a stack) on the card, in its preview, or on the page its link opens. Nothing about the file is reported to the person as lost or deleted.
Author: writer, 2026-11-13, area being built: media in the notebook across two computers

## H-10 The computer that has the large file labels it readably
Protects: the notebook's media (MISSION Core capabilities); a page must be understandable without being told
Touches: notebook media, media card labels
Setup: computer A from H-09 after its sync, with the large file on a card that also carries every other label the app can put on a media card (for example its type, a comment count, a tag), plus a small picture's card for comparison.
Steps: in the browser on A, open the media view at 1280x800 and at 375x800. Measure the large file's "kept only on this computer" label and every other label on that card.
Expect: the large file's card has a label saying in words it is kept only on this computer; the small picture's card does not. At both widths the label is fully inside its card, overlaps no other label, nothing is drawn over it, and its text contrast is at least 4.5:1. Judge: `judges/media_label_judge.py`.
Author: writer, 2026-11-13, area being built: media in the notebook across two computers

## H-11 One large file does not hold back the rest of its note
Protects: the notebook's media; README beta.21 and the merged change "pictures and PDFs travel with the private GitHub copy"
Touches: notebook media, notes, record sync
Setup: computers A and B joined. On A, one note holds its text, a 200 KB picture, a 1 MB PDF and a 110 MB file. Sync A, then B.
Steps: on B, open the note and each of its three media cards; download the picture and the PDF.
Expect: on B the note's text is there word for word, the picture and the PDF open and are byte-for-byte A's (same SHA-256), and only the large file's card shows the H-09 words. The note is not missing, empty, marked conflicted or held back because of the large file. Escaped class: handled per record, not per file inside it.
Author: writer, 2026-11-13, area being built: media in the notebook across two computers; escaped class "repaired per record, not inside it"

## H-12 Editing on the other computer never harms the large file
Protects: invariant 1 (nothing deletes, overwrites or moves what the person wrote without their yes); plain files stay the source
Touches: notebook media, notes, record sync, restart
Setup: H-11 completed. Record the SHA-256 of the large file in A's folder.
Steps: on B, edit the note's text and save; sync B, then A. Restart both notebooks on the same folders. Open the note on both.
Expect: on A the large file has the same SHA-256 and size and still opens; B's edit is on A; the note still shows all three media. On B, after the restart, the large file's card still shows the words of H-09 (not a broken card); on A the label of H-10 is still there. No file in either folder was replaced by a placeholder, a pointer file or an empty file in the person's view, and nothing went missing from A's folder.
Author: writer, 2026-11-13, area being built: media in the notebook across two computers (invariants and restart)

## H-13 Asking B for the file directly still gets words
Protects: the notebook's media: the person on the other computer is never shown a bare error
Touches: notebook media, HTTP routes
Setup: H-09 completed.
Steps: on B, open the large file's own address (the one its card links to or loads) directly in a browser tab and with a plain HTTP GET; also ask B to download it, and ask B's media list and search for the file by its name.
Expect: each route on B answers in readable words that the file is kept on the other computer (a page or message a person can read), never a bare status page, an empty body, a JSON error alone, or a stack. Search and the list find the file by name and show the same words. B never serves a partial or zero-byte file as if it were the file.
Author: writer, 2026-11-13, area being built: media in the notebook across two computers (misuse, every route)

## H-14 An opening that misses the preparation twice still gives a talk
Protects: coaching talks (MISSION chat and add-ons; README beta.18 "coaching talks arrive prepared", beta.20 "a talk only starts once its record exists"); the person gets a talk, not an error
Touches: coaching talks, talk preparation, stand-in AI
Setup: a goal in an area with a coaching talk, a preparation made through the app's own preparation routine with the stand-in AI, recording the prepared opening. For requests to open the talk, the stand-in AI answers with a friendly opening that does not contain the prepared opening, every time.
Steps: ask the chat (the notebook's chat, or the assistant route the app exposes) to start the talk. Read the first message and the talk's record.
Expect: the person gets the talk, opening with the prepared opening from the record, with no error, apology for a failure, or "try again". The AI was asked to open the talk exactly twice (the first ask and exactly one more). Exactly one record of this talk is open and complete. Judge: `judges/talk_judge.py`, case "miss-twice".
Author: writer, 2026-11-13, area being built: starting a coaching talk when the AI's opening does not match what was prepared

## H-15 A second reply that matches is used, and the talk goes on
Protects: coaching talks (README beta.20: the record exists before the answer); sequences
Touches: coaching talks, chat
Setup: as H-14, but the stand-in AI misses the opening on the first ask and gives one containing the prepared opening on the second.
Steps: start the talk; then, on the very next request, reply to it in the chat; then ask again to start the same talk.
Expect: the person sees an opening containing the prepared opening, never the first reply. The reply continues that same talk; asking to start it again neither opens a second record nor errors. The AI was asked for the opening exactly twice. Judge: `judges/talk_judge.py`, case "miss-then-match".
Author: writer, 2026-11-13, area being built: starting a coaching talk when the AI's opening does not match what was prepared

## H-16 Half an opening, an empty reply or an AI failure still gives a talk
Protects: coaching talks: the person gets a talk, not an error
Touches: coaching talks, stand-in AI
Setup: as H-14, one fresh folder per case: (a) "partial": each reply holds only the first half of the prepared opening, then something else; (b) "partial": each reply holds the prepared opening with one sentence of it changed; (c) "empty": each reply is empty; (d) "ai-error": the stand-in AI fails each request (HTTP 500, then a timeout).
Steps: start the talk in each case and read the first message and the record.
Expect: in every case the person gets the talk opening with the whole prepared opening from the record, never the half or changed opening, an empty message, or an error; never more than two asks of the AI for the opening; one open, complete record. Judge: `judges/talk_judge.py` with the case named.
Author: writer, 2026-11-13, area being built: starting a coaching talk when the AI's opening does not match; escaped class "matched as a whole, not inside it"

## H-17 A matching opening is asked for once, and an unprepared talk still says so
Protects: old behaviour still works: README beta.18 ("a talk that is not prepared says so" in one short sentence)
Touches: coaching talks
Setup: two fresh folders. One prepared as H-14 with a stand-in AI whose first reply contains the prepared opening. One with the talk never prepared.
Steps: start the talk on each.
Expect: the prepared one opens after one ask of the AI, with the prepared opening. The unprepared one opens with one short sentence saying it is not prepared and why, claims no research, and is not retried into an error or silence. Judge: `judges/talk_judge.py`, cases "match" and "unprepared".
Author: writer, 2026-11-13, area being built: starting a coaching talk (old behaviour)

## H-18 A brief the chat makes is filtered by sentence too
Protects: one rule, every path: README beta.18 (when no brief was made yet today, asking the chat for "today's brief" makes one, once)
Touches: chat, morning brief, source check
Setup: as H-03 (five invented sentences among fifteen), with no brief made yet today.
Steps: ask the chat for "today's brief". Then ask for "the brief again". Then run the morning briefing routine the same day.
Expect: the chat's brief carries all ten grounded sentences and nothing of the five invented ones; the second ask gives the same text with no new request to the AI to write a brief; the morning does not send a second, different brief. Judge: `judges/brief_judge.py` with `expect_single_brief: true`.
Author: writer, 2026-11-13, area being built: the brief when the source check refuses part of the draft; escaped class "repaired on one path, not every path"

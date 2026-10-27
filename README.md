# Godspeed Mission Control

Godspeed with the integrated notebook, for readers of [Teach It Once: Make AI your mission control for life and work](https://leanpub.com/teachitonce). It includes Menerio's notebook functionality: notes, collections, people, world knowledge, timeline, media, comments and memory review, alongside Godspeed's goals, chat, routines and recovery controls.

New here and not a reader yet? The first chapters are free: [download the free sample of *Teach It Once* on Leanpub](https://leanpub.com/teachitonce).

A new release comes out most weeks. I write about what my AI does for me and what I will not let it do in a free newsletter: [subscribe on Substack](https://michaelzelbel.substack.com/subscribe).

Version 2 is the current edition. The lines below install the current public version, which is the branch `beta` of this repository; `main` is where the work goes on, and a change merged into it reaches nobody until the next version is released. The installers set up a new, separate folder. They do not move an existing version 1 Godspeed folder or your Menerio account.

## New in 2.0.0-beta.8

The chat answers faster. In Telegram the answer appears while it is written, in one message that grows, and no "let me check" lines are left behind. A long chat is shortened at night, when you are not waiting for an answer, instead of in front of your next message.

### Voice replies

Talk to your assistant while you walk or drive, and listen to the answer. When you send it a voice note in Telegram, it answers with a voice note and the same answer as text, so you can listen now and read or search it later. Ask in writing for a spoken answer ("answer me with a voice note"), and you get one too, with the text.

- It is on by default in your Telegram chat. Send `/voice off` there to get text only, `/voice tts` to have every answer spoken, and `/voice on` to go back. It does not make the Hermes app on your computer read every answer aloud.
- The voice is a free Microsoft voice that speaks the language of the answer. Or use your own ElevenLabs voice: in Settings, Voice replies, enter your ElevenLabs key, the voice, the model and its voice settings (stability, similarity, style, as on the ElevenLabs voice page). Godspeed makes a short sample first, plays it to you, and keeps the voice only if the sample worked. The key stays on your device, with your other keys.
- The written answer always arrives. When the voice service refuses, for example because your ElevenLabs credits are used up, you get the text and Godspeed tells you once why the voice note is missing.

Updating keeps your folder, notes and settings. A chat where you already chose `/voice off` keeps it.

## New in 2.0.0-beta.7

What you install changes only when a version is released. Until now the install lines took whatever had been merged that day, so a change made in the morning was on a stranger's computer in the afternoon, tried or not. They now read the current public version, and it moves only when the maintainer releases one. Nothing inside Godspeed changes, and updating keeps your folder, notes and settings.

A released version can also be taken back. If something is wrong with it, the installers refuse it from then on and install the version before it instead, so a line or a link you saved cannot put it on your computer either.

## New in 2.0.0-beta.5 (24 October 2026)

Search by meaning keeps the notebook responsive. Links in a note open when clicked, and text you type stays in the editor if saving fails. The Review page checks for repeats before adding a suggestion.

Add-ons can ask the AI you connected with `godspeed-model`, use your backup when needed, write searchable notes without queuing processing, and keep deadlines. [The add-on interface](docs/full-version/addon-model.md) describes those commands.

### A backup AI

Your mission control thinks with one AI, the one you connected at setup. When that AI fails, for example during an outage, when its usage limit is reached or when its sign-in runs out, the routines that need it stop until you fix it.

Now you can connect a second AI yourself as a backup, for example Claude when your main AI is ChatGPT, or the other way round. Godspeed uses it only when the main AI fails, and only for that one request; the next request tries the main AI first again. It never adds a backup by itself, so your work never moves to another paid service unless you chose it.

- You connect the backup the same ways as your main AI, in the same places, and it is tested before it is kept.
- On a computer, and in the notebook on a server: Settings, Your AI, Backup AI. Sign in with your ChatGPT plan right there, or use a key of OpenRouter, OpenAI or another service. Your main AI can now be signed in with a ChatGPT plan in Settings too, as it already could in Telegram.
- On the one-line server, in Telegram: send `/backupai`. It offers the same AIs as the first setup. A short setup takes over the chat for a few minutes. It needs no AI, so it works even while your main AI is down, and it deletes your key from the chat as soon as it has read it.
- A backup is another service than your main AI: when one service fails, its other models usually fail with it.
- Settings shows your backup, how often it answered while your main AI was failing, and a button to remove it. Its check now asks the main AI and the backup each on their own, so a working backup no longer hides a main AI that is broken.
- Add-ons that ask Godspeed for an answer get the backup too, and the answer says when the backup gave it.
- When your main AI has been failing for more than an hour while the backup does the work, Godspeed tells you once.

Updating keeps your folder, notes and settings. Nothing changes until you connect a backup.

### add-ons that write many notes

Some add-ons write a note for each thing they handle, for example one note per scanned letter, with its summary and key facts already in it. Until now your notebook's AI read every one of those notes again, at most 40 a day and oldest first, so a pile of a few hundred letters held your own notes back for weeks.

- An add-on can now mark its notes so that your notebook's AI does not read them again. You still find them in search, and your assistant still finds them when you ask about a letter. Your own notes are read as before.
- When you move a note to the trash, or take out the sentence a suggestion came from, the suggestions from that note you had not kept yet leave the Review Queue. Restore the note and they are back. What you kept stays.
- **Classify unclassified vault notes** no longer counts the notes it does not classify.

For add-on authors: `docs/full-version/addon-model.md`, "Notes an add-on writes".

### deadlines from add-ons

An add-on can now give Godspeed a deadline it found, for example a documents add-on that reads "pay by 20 November" in a scanned letter. It is a normal deadline: it is in your deadline list, your deadline reminders and your morning brief mention it as the day comes, and you close or move it the way you close or move any deadline. The add-on sends no reminders of its own, so nothing reminds you twice.

- Once you change such a deadline's day or name, or close or drop it, it is yours: the add-on can never change it again.
- An add-on makes each deadline once, also when it reads the same letter again.

For add-on authors: `docs/full-version/addon-model.md`, "Deadlines an add-on keeps".

### a Review page without repeats

When your notebook reads a new note, its AI suggests facts, timeline entries and people for your Review page. Until now everything it answered went there, also what your notebook already knew, and the same things again each time the note was saved: a phone number you had saved long ago, the same trip three times, a hotel's booking number as a fact about you.

- Your notebook now checks every suggestion against what it already has, by one rule for "the same thing" that keeping a suggestion uses too. A fact is the same when it is about the same person, of the same kind and has the same value, also written another way: +44 7700 900123 and 07700 900 123, € 120,50 and 120.50 €, 15 June 2041 and 2041-06-15, an email in capitals. A timeline entry is the same on the same day from the same note, or with nearly the same title a day apart. A person is the same by name or nickname. Keep never adds a second copy of something you have.
- Nothing is suggested twice, whatever you did with it the first time: kept, removed or blocked.
- A note processed again after you edited it brings only what your new words say.
- A note was sometimes processed again with the same text, when it finished while another program was writing to your mission control folder. That no longer happens.
- The AI is asked to leave out details of documents, bookings and invoices, such as booking and invoice numbers or a hotel's phone number, and timeline entries for routine things, such as a letter arriving.
- Each card on the Review page says what it is: Timeline entry, Fact about you, Fact about a person by name, or New person. Facts no longer have a calendar icon, and pointing at the icon says what Keep does.
- Your assistant can now remove, roll back, block or snooze waiting suggestions when you ask it to. Keeping one still needs your own words.

What was left out is listed in `.godspeed/suggestion-filter.jsonl` in your mission control folder. Updating keeps your folder, notes and settings, and suggestions already waiting stay where they are.

### tracker changes from Claude Code

Asked in Claude Code to change a tracker, a habit or a meal you already have, for example "the health talk should also look at my workouts tracker", your notebook refused with "Read the current record hash before editing", although Claude Code had just read the tracker. Claude Code sent the version it had read as text, because the notebook never said that it takes a list of versions there.

- The notebook now tells every AI app you connect what each part of such a request looks like, so a list of versions arrives as a list. It also reads the text Claude Code sent until now.
- A change to something that changed after the AI read it is still refused, as before.
- The same works for goals, routines and deadlines: an AI app can name the version of what it changes in the same way as for a tracker.

### web addresses for add-ons

Some add-ons need a web address on your server, for example a documents add-on whose archive you open on your phone. Until now such an add-on changed the file that gives your notebook its address, and on a server where Godspeed brings its own Caddy every update took that change out again, so the add-on's address was gone until the add-on noticed, up to an hour later.

- Your server now has a folder for add-ons' web addresses, `/etc/caddy/godspeed-addons/`. Each add-on puts a file of its own there, and Godspeed never writes in it, so an update keeps every add-on's address.
- An add-on can also add a path to your notebook's own address, such as `https://<your server>/pictures/`, and show it only to whoever is signed in to your notebook.

Your server gets the folder when you update it. For add-on authors: `docs/full-version/addon-model.md`, "A web address for an add-on".

### Godspeed inside another project's folder

Checked out inside the folder of a JavaScript project whose settings say its files are ES modules, for example an add-on's own repository, Godspeed's tools took that setting for their own: the deadline tool stopped with "require is not defined", and the notebook, which uses it, did not start. Godspeed now carries its own setting, so its tools and the notebook work wherever it is checked out, and the helper that lends your computer's browser works wherever it is installed.

## New in 2.0.0-beta.4 (21 October 2026): a small copy before each update

Before every update the installer saves a copy of your notebook, so you can go back if the update goes wrong. Until now that copy took your whole folder, also your work folder with its recordings and downloads. On a grown mission control it was gigabytes and many minutes, and an update refused to start when the disk had no room for it. Old copies also piled up.

Now the copy holds only what an update can change, never your work folder. When your folder is a Git repository, it holds only what Git does not already keep, and Git keeps the rest. On one computer it took 85 MB and a few seconds instead of 8.33 GB and sixteen minutes. Once an update has worked, its copy stays as your way back and every older one is removed, also the full copies earlier versions left behind. Importing from Menerio makes the same small copy first, and only the newest import's copy stays.

The update itself is faster too: it reads your notebook once instead of five times. On Windows it waits for a slow first start instead of calling it failed; on one computer the notebook needed two minutes after an update, and the setup used to give up after one. Updating keeps your folder, notes and settings.

## New in 2.0.0-beta.3 (20 October 2026)

Clearing a conversation now starts a fresh AI conversation. Late replies cannot restore the cleared chat. Your saved notes stay in place. Updating keeps your folder, notes and settings.

## New in 2.0.0-beta.2 (20 October 2026)

Pausing the journal now stops new journal entries from chat and stops its check-ins. Resuming starts it again. Your saved entries stay in place. Updating keeps your folder, notes and settings.

## The first beta (19 October 2026)

This is the first beta of version 2, 2.0.0-beta.1: the version for the first people who install and use it on their own. It brings everything below. Updating keeps your folder, your notes and your settings.

Your goals:

- Your goals have their own page in the notebook, under Goals in the sidebar. It shows the weekly number and its readings over time, what each step should do to it and what it did, today's decision, the steps and whether their checks passed, what went out, what the research found, and when the next check is. You can tell it this week's number there.
- A number you tell the notebook or the chat for a goal now counts as a reading of its weekly number, so the weekly check can say whether the steps helped. Until now it was kept where the check never looked.
- Steps you allowed once go out even when you have no morning brief, and the daily round tells you what went out. Until now they went out only after a morning brief had shown them, and a first goal starts without one.
- Coaching talks are prepared the night before. A new routine, "Coaching talk preparation", runs at 03:00 on your clock and prepares each talk of the next day, such as your weekly check-in: it reads your goal and its research, what changed and what you said, and writes the talk's opening and the notes the talk carries. It writes only that preparation and contacts nobody. A talk it could not prepare opens as before. So a first goal now starts seven routines: the nightly goal research, the daily round's two (one picks the day's work, one does it), deadline reminders, the weekly check-in, the coach's reminders, and this one. A mission control that already has its routines gets it once, after the update, unless you removed routines on purpose.
- The nightly goal research keeps what it found when your AI writes it in a layout of its own. A smaller model wrote 29 people, 5 cases and 10 claims as one line each, and the night counted none of them and called itself unfinished. Now they are put in the research files' own form and count.
- A step of your daily round can no longer be filed with a check that can never pass, such as `test -ge 900` (a comparison with nothing on one side). Such a step stayed unfinished for good, and nothing said why. Now the check is refused when it is filed, with an example of one that works.
- A deadline you save in Settings or tell the notebook's chat is now a real deadline: the reminders and the morning brief see it. Deadlines saved the old way are moved over once.

Settings:

- Connecting your AI in Settings now also connects your routines, and Settings says whether they can reach it. Until now Settings connected only the notebook's chat, and the routines failed every morning for someone who did what the installer said.
- Connecting your AI in Settings, and every request after it, tries again when the AI company's service has a passing fault (an error 502, 503, 504 or 429), instead of failing at once.
- Settings has an About section: your version and release code, where your folder, notes, files and backups are, the food table's source and licence, and links to the user guide.
- The Notifications switches turn the morning brief and the weekly review on and off for real, at the time you choose. Recovery says how the last nightly backup went.
- Routine times moves your routines to the time you choose, Enable routine offers your mission control's own recipes by name, and results go to Telegram whenever this computer's assistant has a Telegram bot. The journal's check-ins, evening list and weekly summary run at the times you set.
- Connect AI in the sidebar opens Settings at the AI connection.

The notebook:

- A note shows its comments under it. You can add and delete them.
- A computer makes nightly backups from the start, also before your first goal, and a backup that failed is said in plain words.
- An export imports again, also into a notebook that is already set up. Keys for other apps are left out of every export.
- The morning brief carries what your watches found.
- A new mission control starts with its first commit, so searching your folder finds its files from day one, and the nightly research is saved in the folder's history on a computer that never used Git.

Installing and removing:

- The Linux and Mac installer counts the notebook as running only when the notebook that answers is its own. Under WSL on Windows every Linux distro shares one network, so another distro's notebook could answer in its place; now the installer says so, and how to choose another port.
- On a Mac the notebook starts when you log in and runs in the background. Until now it ran only while its Terminal window stayed open. A Mac without Homebrew is told how to get it before anything is downloaded.
- `mc-uninstall` removes the program from a Mac or Linux computer in one command and leaves your mission control folder.
- Gmail can be connected on a Mac, on an ARM Linux computer and on the one-line server.
- The anonymous install count you can say yes to goes to godspeedmissioncontrol.com, and its question no longer names a person.
- One version name everywhere: 2.0.0-beta.1.

Skills and add-ons:

- When you ask your assistant to book, buy or cancel something, your request is the yes it needs. A starter rule said "never book anything without asking first", and a small model refused a booking it had just been asked for. A step you did not ask for still waits for your yes. A new mission control gets the new wording.
- The deadline skill reads as plain English again: some of its questions had garbled words, and it named a program you do not have.
- "Track journal" and "track Tagebuch" start a journal entry, as the tracker skill already said. The journal skill still said that no message starting with "track" was a journal entry, so a dictated "Track journal. Done with the weekly plan." could be refused.
- Asking your assistant to caption a video works again.
- Phone calls work on a Linux computer set up with the Linux installer.
- /radar and /subs answer in Telegram.

## New on 18 October 2026

- On a Mac or Linux computer, the one-line installer no longer stops at "Installing Hermes..." when you run it in a terminal. Hermes' own installer was waiting there, out of sight, for answers to its setup questions. Now it does not ask them.
- On a Mac or Linux computer your assistant can now use your notebook, for example to save a note or find a person. A new installation left it without the notebook's tools, so it answered that your notebook was not connected. Updating to this release gives them to an installation that lacks them.

## New on 17 October 2026

- Your first goal now starts its routines every time: the daily round, deadline reminders, the weekly check-in, the coach's reminders and the nightly goal research. Until now it started none of them when something else was planned first. On a new server that was the one-time message that invites you to the getting-to-know-you chat. On a computer it was a morning brief, a research watch or a reminder you asked for before your first goal, or the city you named in the getting-to-know-you chat. Now only routines that were on the computer before your mission control came, or that work for another folder, keep them away.
- If your mission control missed its routines this way, this update brings them. They start once the updated notebook runs. A routine you removed yourself stays removed.
- Notes save reliably again. After a few quick saves a note could refuse every later save with "This record changed". Now the next save goes through, and what you typed is never lost. A note's text also saves when the notebook added tags or a summary to it while you typed.
- Timeline moments have a clearer impact scale: Everyday, Short-term, Lasting and Life-defining, each with a short description. Your assistant uses the same scale. Everyday moments belong on your timeline too.
- The notebook's Documentation link opens the user guide. It used to show "This page is unavailable".
- The one-line server installer no longer stops on a brand-new server with "Could not get lock". It waits while the server installs its own updates, then installs Docker.
- Smaller fixes: a one-time sign-in link signs you in again, and a day whose work was chosen is no longer reported as unfinished.

## New on 16 October 2026, second update

- Setting up a server now comes in two parts. The first is technical and takes about five minutes: in Telegram you connect an AI, such as ChatGPT or Claude, and say whether this is your first Godspeed Mission Control. Your clock is set from your computer's time zone. GitHub comes up only if you want to bring in a Mission Control you already keep there.
- Getting to know you comes afterwards, whenever you like. About ten minutes after the setup your mission control writes to you once, with no reminders after it. Reply when you are ready, or send the word `context` at any time, in Telegram or in the notebook's chat. It asks where you live (only for the time zone, and only when your computer did not tell it), a little about you, and what you want help with first, one question at a time. Every question can be skipped. If you have never written down who you are, it shows you three easy ways: send the file from the book, let ChatGPT or Claude write it for you with a message it gives you to copy, or answer five short questions. What you tell it is shown on the page Godspeed's brain, with Undo.
- The dashboard has a big "Chat with Godspeed" button at the top, and a "Tell Godspeed about you" card until that chat is done or you hide it.
- Connecting Telegram on the setup page: a bot you have used before shows no Start button, so the page also shows the message to send it, with a Copy button.
- Asked how to open your notebook, your mission control says to sign in with the username and password you chose at setup, and what to do if you forgot them.
- Also new since 15 October: the Identity page is now "Godspeed's brain", with numbered rules that save as shown, extra instructions and its own chat beside it; coaching talks can open from a talk prepared ahead from your goal's research (the routine that prepares them every night came with the release of 18 October) and answer in two sentences at most; and an update keeps the newest three copies it made of your notebook, so old copies no longer fill the disk.

## New earlier on 16 October 2026

The installers' last words say what comes next. The Windows setup's last page, and the last lines of the Linux and Mac installer and of the one-line server installer, now say where your mission control is, how to start talking to it, and where I write about it. On Windows that page used to keep the stock "Setup has finished" text. This release otherwise keeps the notebook of 15 October.

## New on 15 October 2026

- The notebook has an Identity page, under System: who your assistant is, what it may and may not do (your rules, and the instructions for connected AI apps that My Profile held), what it knows about you (your profile pages) and how it does its jobs (your recipes). You see and change them there. Every part keeps its earlier versions, with "Undo last change" and "Restore this version", and your assistant can make the same changes when you ask it in the chat.
- Hermes, the program behind your assistant, now takes its identity from "who it is". Until now it told itself "You are Hermes Agent" before it read your manual. Its identity file (`SOUL.md` in the assistant's own folder) is written from the "who it is" paragraph of your `AGENTS.md`. On an installation you update, this happens during the update and each time the notebook starts, and the text it replaces is kept beside it. A `SOUL.md` you wrote yourself is left as it is; the Identity page names it and offers to replace it.
- If a program of your own keeps the list of rules in your `AGENTS.md`, the Identity page changes a rule only when it would write that list exactly as your program does. Otherwise it leaves your rules to that program.
- Habits are forgiving. Every day you did a habit stays in its lifetime total, even after a break. Two missed days a month are covered automatically, holidays and illness can be excused afterwards, and each habit shows a calendar of its last seven days. On Telegram, a habit reminder has buttons to mark it done.
- More than one coaching talk may look at the same tracker or habit. Asking for another talk while one is open starts that talk, and a talk you started in the chat is not brought up again as waiting.
- The daily round gives every dated chance from a goal's research that closes within two weeks a step, unless you dropped the idea. A step only you can take that is still waiting counts toward your one step a day.
- The installed app's icon is the G on a transparent background.
- The server image collects the programs it has finished with by itself. Before, a server whose setup did not ask for that kept one finished program from every sync.
- A notebook that brought in Menerio before 8 October syncs again. The retired Lexicon's pages stopped it; they now stay in `notebook/Lexicon/` as ordinary pages.

## New on 14 October 2026

The notebook no longer calls every installation a test installation. Its unavailable-page message also uses ordinary wording. This release otherwise keeps the notebook from 13 October. The installer keeps its starter files matched to that notebook version.

## New on 13 October 2026

- Every goal now has research of its own, kept current every night. A new routine runs at 00:15 on your clock and looks for who leads the field, who reached the goal from a start like yours, what was just proven wrong, and chances with a closing date. It writes what it finds into the goal's research folder, `goals/research/<goal>/`, and checks every quote it keeps against the page it came from. Its instructions are to read pages and write files only, and never to contact anyone or spend anything; Hermes, which runs your routines, takes no list of tools, so those instructions are what holds it. A mission control that already has its routines gets this one too, once, unless you removed routines on purpose.
- A research night that was cut off part way is never counted as done. Its goal goes first the next night, and a goal that had no time left says so in its own research folder.
- The daily round reads each goal's research before it picks the day's work. Every step it plans copies a person or a case from that research, names what holds the goal back right now, and says how the step changes that. At most one step a day is yours to do.
- You can allow one kind of step for a goal once, in your own words, with a number per week (`mc-goals allow`). Such a step then goes out at its set time unless you say stop: your morning brief lists it that morning, and `mc-work stop` keeps it back. A step that reaches nobody else can also be allowed to go ahead by itself, and the next morning brief says what it did. Money, sign-ups, bookings, cancellations, a first message to someone new and anything on LinkedIn by automation always ask you first.
- A new installation no longer starts with a review of the next-action recipe, a recipe it never changed. Until that review was settled, the notebook did not sync.

## New on 12 October 2026, second update

- Trackers you talk to. Say "track belly 92 cm" and your mission control asks once whether to start a tracker called Belly, then keeps the number; after that, "track belly 91" is enough. Your trackers are in Collections, under Trackers. One you have not used for 30 days rests there, with everything kept, until your next "track".
- A cycle tracker for the period: "track period", "track period over", or a symptom such as "track cramps". After two complete cycles it says when the next period is likely to start, and if you ask, it gives a heads-up in your morning brief. It is not for contraception, for trying to conceive or for a diagnosis, and it says so.
- A food tracker: "track breakfast, two eggs and a slice of rye bread" works out calories and protein from the German food table BLS 4.0 of the Max Rubner-Institut, which your mission control downloads once and then uses offline (Settings, About names it and its licence). Packaged food can be looked up by barcode or brand on Open Food Facts. A daily target is optional.
- Headaches and habits answer to "track" too. A coaching talk can be told what it may look at and what it must never do: "The health talk may also look at my sleep tracker", "The health talk must never suggest buying anything".
- A habit day you mark "skip" no longer counts against the habit.

## New earlier on 12 October 2026

- Every new conversation is saved. What you type to the AI apps on your computer (Hermes, your mission control's own assistant, Claude Code, Codex and OpenCode) and what they answer goes into the conversation archive in `prompts/archive/`, from the day you install or update. The one-click server saves its Telegram chat every hour.
- The "Your conversations" boxes and `--sources` decide one thing only: whether chats from before the install are brought in as well. Unticked, only new chats are saved.
- When your assistant cannot recall an earlier conversation, it runs `mc-prompt-archive search` before saying it does not know. That search now works on Windows without a Python of your own, from cmd and PowerShell, and from any folder.
- Trackers: say "track" and a number or a thing, and your mission control keeps the count.

## New on 10 October 2026

- Programming goes to a coding helper. When you ask your mission control to write or change code in one of your projects, it hands the work to a helper that works only in that project's folder, tests and saves it there, and reports back, so your conversation keeps its context. Claude Code does this by itself; the manual tells Codex and Hermes to do the same.
- On Linux, a routine that ran in the same instant the notebook first looked at it is no longer overlooked.

## New on 9 October 2026, for the book's second edition

- Your first goal starts five routines by itself: the daily round's two (one picks the day's work, one does it), deadline reminders, and a weekly check-in about the goal on Sundays with the coach's reminders. Later releases added the nightly goal research and the preparation of coaching talks, so a first goal starts seven today.
- The notebook keeps the people, facts and events you tell it about, one page per person. Each kind of fact has one fixed name, and a newer value ends the older one.
- The note graph is back, worked out from your notes when you open it.
- A computer can connect its own GitHub copy from Settings, and mail works on a computer too.
- A second computer or a server joins the mission control you already have, and the server runs the routines.
- A weekly review and a research watch come with every new mission control.
- On Windows, the mission control's own commands work inside the assistant's chat.
- The assistant asks its questions in the chat and waits for your answer, keeps what you tell it in the notebook instead of a memory of its own, and reads the notebook directly, so the morning brief knows you. The daily round tells you what it decided, or that it could not finish.
- Smaller fixes: deadlines are always read from the mission control you are working in, a deadline file that cannot be read is shown as needing a look, Settings shows when the weekly check-in really runs, and the chat no longer shows the assistant's waiting lines.

## Windows

[Download GodspeedSetup.exe](https://github.com/MichaelZelbel/godspeed-mission-control/releases/latest/download/GodspeedSetup.exe), then run it.

That is the release marked Latest, the current public version. It changes only when a version is released, and a version that was taken back is not it any more.

This uses Godspeed's original setup wizard and shared installer, then connects the integrated notebook. On a PC that already has Godspeed, the wizard selects a separate installation by default. The notebook opens at [http://127.0.0.1:47831/dashboard](http://127.0.0.1:47831/dashboard). Connect your own model account in Settings to use the assistant. The installer is unsigned.

The executable is also [committed in this repository](installers/GodspeedSetup.exe). The [download page](https://github.com/MichaelZelbel/godspeed-mission-control/releases/latest) lists the same file and its checksums.

## Linux or Mac

This uses Godspeed's shared native installer for Git, Node.js, Hermes and the Godspeed folders, then adds the notebook. Docker is not required for this route. On a Mac, the notebook starting by itself, `mc-uninstall` and connecting Gmail were checked on GitHub's Mac test computers; the whole one-line install on a real Mac has not been checked yet.

Paste this line into a Terminal window:

```bash
curl -fsSL https://godspeedmissioncontrol.com/install | bash
```

It installs the current public version. That version changes only when the maintainer releases one, so pasting the line again next month gives you what was released, not whatever was changed yesterday. A version that was taken back is refused in one plain sentence, and nothing on the computer is changed.

If you would rather have the file in front of you first, this is the same installer from the same version:

```bash
curl -fsSLO https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/beta/install-godspeed.sh
bash install-godspeed.sh
```

To install another stage than the public one, name it with `GODSPEED_STAGE_REF`, for example a release candidate before it is released to everybody:

```bash
curl -fsSLO https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/candidate/2.0.0-beta.7/install-godspeed.sh
GODSPEED_STAGE_REF=candidate/2.0.0-beta.7 bash install-godspeed.sh
```

Take the installer from the stage you are installing, as above: each stage's installer and the version it installs belong together.

On a computer that already has Godspeed, use the original installer's separate-folder option:

```bash
bash install-godspeed.sh --beside --godspeed "$HOME/godspeed-v2"
```

The notebook opens locally at `http://127.0.0.1:47831/dashboard`. On Linux it starts through systemd. Use the Hostinger installation below for a deployment with HTTPS.

The default folder is `~/godspeed-v2`. The original installer also accepts `--godspeed` and `--repo`.

`install-godspeed.sh` at the top of each stage is that stage's installer, and the short line above fetches it from the public stage, so both lines install the same version. It names no version itself: it reads the version it installs from `stage.json` beside it, the one file that says what a published version is made of (`stage/README.md`). For development only: `install-godspeed-dev.sh` installs the development branch's newest commit, so it can differ from one day to the next. It is not for readers.

On a server, the installer also gives the notebook a web address with HTTPS. A server is a Linux computer without a desktop whose public address has a name in public DNS; another name can be given with `GODSPEED_HOST=notebook.example.com`. The address is `https://` plus that name, or that name with `:48443` when the server's own Caddy already serves it. At the end the installer prints a private link that makes your account (username, password, and a recovery code to keep); after that you sign in there. Ports 80 and 443 must be free or held by Caddy, and the installer needs sudo once. The assistant and the routines on the server keep using `http://127.0.0.1:47831`, which asks no sign-in and answers only on the server itself.

## One-click Hostinger installation

[Install Godspeed Mission Control v2 on Hostinger](https://godspeedmissioncontrol.com/hostinger). This prepares a private deployment configuration for Hostinger's Deploy button, then gives you your new server's setup link. Hostinger charges for the server; complete its checkout yourself. The image it installs is pinned to one exact build.

## Problems and ideas

- **Something does not work?** Look at [Known issues](https://godspeedmissioncontrol.com/guide/known-issues) first. It may be there already, with what to do about it.
- **Something broken that is not listed there?** [Report it here](https://github.com/MichaelZelbel/godspeed-mission-control/issues/new/choose). A short form asks what happened and where to find the log. You need a free GitHub account.
- **An idea for a new feature?** Share it in [Ideas](https://github.com/MichaelZelbel/godspeed-mission-control/discussions/categories/ideas), where others can vote for it.
- **A question about using it?** Ask in [Q&A](https://github.com/MichaelZelbel/godspeed-mission-control/discussions/categories/q-a).
- **A security problem, or no GitHub account?** Write to [support@ownward.studio](mailto:support@ownward.studio). A problem someone could misuse never goes into a public report.

## Status

Version 2 is in its first beta. Windows and Linux core flows have been checked. On a Mac, the notebook starting by itself, `mc-uninstall` and connecting Gmail were checked on GitHub's Mac test computers, but not a whole install on a real Mac. Actual two-week user outcomes remain unverified. Some historical memory reviews lack enough information for Undo and report that limitation. The wider release and recipe checks remain incomplete. See [the trial handoff](docs/full-version/trial-handoff.md) for the remaining limits.

Godspeed's code is MIT licensed. Included Menerio-derived notebook components retain their stated AGPL license. Source and notices are included in the packages.

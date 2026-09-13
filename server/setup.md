# Chapter 30: Install Your Hub on a Linux Server

Closing the laptop is a pleasant way to end the day. Unfortunately, a job scheduled on it still needs the computer awake. A Linux server gives that job another place to run and lets you reach the hub from your phone. I recommend adding one when you have useful work that should continue after you close the lid. While you're still testing those jobs, keep using the laptop.

A rented server is another computer in a data centre, with its own copy of your hub. The company hosting it looks after the physical machine; you still have the assistant's setup to look after. The server's model sign-in and schedule belong to that computer, even when you bring the hub files from your existing repository.

## Check the requirements before renting

I used Ubuntu on a Hostinger KVM 2 server for this setup; the installation record includes a fresh Ubuntu 24.04 test. The scripts use Ubuntu's package tools and system services. Have the assistant compare your proposed machine with the current [Hermes installation requirements](https://hermes-agent.nousresearch.com/docs/getting-started/installation) and the companion server scripts before renting. The kit does not establish a tested minimum memory size for every model and job.

Before committing to a server, check that Hermes supports your model account and that the server can access your private GitHub repository. For phone access, you'll also use Telegram. Look at the model account's current eligibility and allowance now: a free account may not provide enough access for the daily work you want it to do.

If you need to rent, check the full price, renewal price and tax. The welcome offer is introducing itself on its best behaviour; the renewal price tells you what keeping it will cost.

## Run the server installer on the server

Open the provider's browser terminal or use SSH, a secure way to log in remotely. Check that the terminal is on the server before typing. Two open terminals can look much alike until the wrong computer starts installing things.

The setup starts as `root`, the administrator account. Review the script from your companion release first, then run:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install.sh | bash
```

That address retrieves the current public installer. Save its completion report. The installer pins a version of its shared setup code, but also downloads other current components; this is not a promise that every future installation will be byte-for-byte identical.

The installer creates a limited user called `ai`, installs Hermes and prepares `/home/ai/hub`. If a step fails, give the error to your existing assistant and ask it to diagnose and repair that step on the server before continuing. Keep credentials out of the copied error text.

## Answer the connection prompts

For phone access, the installer connects a Telegram bot: a chat account controlled by the assistant's software. BotFather is Telegram's tool for creating that account. Its token is the credential that lets the server use it.

The installer guides you through these choices:

1. **Telegram:** create a bot through Telegram's BotFather with `/newbot`. Paste its token only into the dedicated installer prompt. Send your new bot a message so the installer can identify your user. Skip this if you do not want the phone route.
2. **Model sign-in:** open the authentication page printed by Hermes, enter the temporary code and approve on your own account. Follow the code's displayed expiry; request a new code if it expires.
3. **Hub folder:** use the verified repository address your existing assistant found for you, or choose a fresh hub. The resulting folder for this route is `/home/ai/hub`.
4. **Menerio:** this is the optional online memory service. Skip the connection unless you use it. Local files are enough for a brief or investigation.
5. **GitHub:** use the displayed device sign-in to authorize the server. For a fresh hub, choose the private repository name and inspect the result before relying on it.
6. **Morning brief:** leave scheduling off initially. Verify the skill, profile, time zone and delivery first.

When I first built this setup by hand, there was no installer yet. My first working run sent the brief to my phone and pushed the files to GitHub. It also pushed the file holding my API key, which I had put inside the hub folder.

The repository was private, but I still had to rewrite its history and replace the key. Ten minutes of unpleasantness for one lazy file placement. I'd like that story to stay mine.

Credentials must stay out of the tracked hub in plaintext. Check the installer's reported locations and which files entered the first upload. The current server script creates and pushes a private repository for a fresh hub; it does not pause for the book's separate file-by-file privacy review. Keep a first-server hub empty of personal material until that initial setup is checked. For an existing hub, review its files and earlier history before giving the server access.

## Check the folder before asking personal questions

If this server joined your existing hub, ask through your connected Telegram bot. If you skipped Telegram, start an interactive conversation in the server terminal with `su - ai`, then `cd /home/ai/hub`, then `hermes`. Use that conversation for the same request:

```
Read /home/ai/hub/AGENTS.md. Confirm the working folder. Name the profile files you can read and quote one harmless fact from the file I specify. Do not change anything or use memory from an earlier conversation.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-30-text-2-20260913)*

For a fresh hub, first ask the server assistant to download the [matching companion kit](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once-Companion.zip) and follow its `setup/match-edition.md` guide for `/home/ai/hub`. Ask it to preserve the server's paths and working connections. This brings the installed instructions into line with this edition before you add personal material.

Then begin with a few reviewed lines about yourself, your work and your preferences. You can use the briefing you already saved or write those lines now. Paste only that reviewed text into your server conversation and ask the assistant to save it as `/home/ai/hub/what-my-ai-knew.md`. Then ask it to file the useful parts into the profile's about-me, people, projects and voice files, keeping the original and leaving unanswered questions in the inbox. Inspect the saved facts before asking personal questions.



A harmless fact from the right file tells you that the messenger, model and folder worked together for this request. If it fails, ask your existing assistant to check the messenger connection, model sign-in and folder access separately. That narrows the repair to the place where the request stopped.

## Move one schedule, not two

Build and manually test the morning-brief skill in this server folder if it is not already present. Use a separate practice result when today's brief exists. Before enabling its server schedule, ask the assistant on your laptop to pause the laptop's version and verify that it is paused.

Then ask:

```
Inspect this server's system time zone and Hermes scheduler configuration. Show the current local time and the next intended 07:00 run in my chosen named zone. Confirm /home/ai/hub is the working folder and skills/morning-brief/SKILL.md exists.

Prepare one daily morning-brief schedule using that folder and zone. Confirm the laptop's version has been paused before enabling this one. Its prompt must read AGENTS.md and the skill. Preserve existing daily briefs. If an installer-created 06:00 job exists, edit or retire it rather than adding another.

Ask me to choose server-local results or delivery to my own connected Telegram chat. For local results, save brief/YYYY-MM-DD.md and show its full server path. I can ask you to display its contents in this conversation. For Telegram, verify the exact destination is my allowed chat and show it before I confirm. Save Telegram as this job's delivery setting only after that confirmation. Authorize only delivery of my brief to that chat, never messages to customers or other people. The skill still saves the file and does not send messages itself.

Show the saved job record, next run, output path, delivery setting and pause control. Do not claim scheduled delivery works based on an ordinary bot conversation.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-30-text-3-20260913)*

Have the assistant record the active schedule's location in `procedures.md`. Keep the skill on both machines if you like. Two versions of tomorrow's brief are unlikely to make tomorrow twice as helpful.

Try a one-time practice job due in five minutes, using your chosen delivery setting and `practice/brief-tests/server-timer-test.md` for the result. Afterwards, read the file and run history, and check that no future run remains. If you chose Telegram, look for the scheduled result in the intended chat. For local results, ask the server assistant to show the saved file in the conversation, or open it through a desktop connection you have configured. Then leave the daily job active.

## Know what the recovery checks cover

The server setup checked for this book also installs a local watchdog, which means scheduled checks on the assistant's service. A basic check runs every five minutes and can try a restart. Separate jobs review logs with AI and ask the model for a short response.

The basic service check can work without a model. The check that asks the model a question succeeds only when it gets an answer. Noticing that it did not answer, and telling you so over Telegram, works even when the model is down.

These checks all run on the same server. If the server or its network goes down, they may be unable to look or send word. A monitor on another computer would be a separate addition.

The `ai` user has fewer rights than root, but it can still change its own files and use the credentials it holds. Keep the rules requiring approval for spending, sending and destructive changes in the server hub's instructions too.

## Confirm what survives a restart

The Hermes gateway stays running to receive messages and start jobs. It's set up as a service intended to return after a server restart. In an earlier test, it came back fourteen seconds after a reboot.

For your own restart test, choose a quiet time before a deadline depends on the server. Afterwards, check the model connection, next run and a harmless file read, then look for the expected result. Note any repair it needs, so you have a record of what returned on its own and what needed attention.

GitHub shows the files you've pushed, which can be older than the live server files. Ask the server assistant to read a live result when you need it. The optional desktop connection also provides a larger screen for those files and schedules.

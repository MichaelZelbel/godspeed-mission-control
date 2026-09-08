# Chapter 31: Install Your Hub on a Linux Server

If your laptop is doing the scheduled work, it has to be awake when the work comes due. That may suit you perfectly. If you want to close the lid and still get results, or ask the hub questions from your phone, you can put it on a Linux server. This chapter is optional.

A rented server is another computer, with its own hub copy. You leave it running elsewhere, but it still depends on power, a network, updates and a working model connection. We'll test those parts instead of treating the rental as a guarantee.

## Check the requirements before renting

The setup recorded for this book used Ubuntu on a Hostinger KVM 2 server. That's the route tested here. Before choosing a machine, read the companion server guide for supported Ubuntu versions, resources and installation requirements. A small Linux server isn't automatically the right small Linux server.

You'll need a model account Hermes supports and access to your private GitHub repository. The phone route also uses Telegram. Check the account's current eligibility and allowance before planning daily work around it; a free account may not provide enough access for that job.

If you already have a suitable server, use it. Otherwise, check the full rental price, renewal price and tax before buying. The introductory price is only part of what you'll pay to keep it running.

## Run the server installer on the server

Open the provider's browser terminal or use SSH, which gives you a secure remote login. First check that you're on the server. It's easy to have two terminals open and type confidently into the wrong computer.

The setup starts as `root`, the administrator account. Review the script from your companion release first, then run:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install.sh | bash
```

That address points to current source, which can change. To make the installation repeatable, keep to the same reviewed release or commit version, including the Chapter 32 script. You want the instructions and installer to describe the same setup.

The installer creates a limited user called `ai`, installs Hermes and prepares `/home/ai/hub`. Read the completed steps as it goes. If one fails, read that error before continuing; the next step may depend on it.

## Answer the connection prompts

The installer guides you through these choices:

1. **Telegram:** create a bot through Telegram's BotFather with `/newbot`. Paste its token only into the dedicated installer prompt. Send your new bot a message so the installer can identify your user. Skip this if you do not want the phone route.
2. **Model sign-in:** open the authentication page printed by Hermes, enter the temporary code and approve on your own account. Follow the code's displayed expiry; request a new code if it expires.
3. **Hub folder:** give the address of your existing private repository, or choose a fresh hub. The resulting folder for this route is `/home/ai/hub`.
4. **Notebook:** skip this unless you chose the optional notebook chapters. It is not needed for a file-based brief or investigation.
5. **GitHub:** use the displayed device sign-in to authorize the server. For a fresh hub, choose the private repository name and inspect the result before relying on it.
6. **Morning brief:** leave scheduling off initially. Verify the skill, profile, time zone and delivery first.

Credentials must stay out of the tracked hub in plaintext. Check the installer's reported locations and inspect the proposed first upload for unintended material, as in Chapters 18 and 19.

## Check the folder before asking personal questions

If this server joined your existing hub, ask through Telegram:

```
Read /home/ai/hub/AGENTS.md. Confirm the working folder. Name the profile files you can read and quote one harmless fact from the file I specify. Do not change anything or use memory from an earlier conversation.
```

If this is your first hub, the server doesn't yet know your background. Prepare and review the summary from Chapters 1 and 2, then upload it to `/home/ai/hub/what-my-ai-knew.md`. Use the remote file route available to you. Chapter 4's filing prompt will help put the reviewed information into the separate profile files.

An empty profile won't know Nadia from Sam's fictional example unless you deliberately put that practice material there. A missing person can simply mean you haven't taught the hub about them yet.

An answer about a specific file checks the messenger, model and folder together. If it fails, inspect those parts one at a time. A vague reply won't tell you which connection needs attention.

## Move one schedule, not two

Build and manually test the morning-brief skill in this server folder if it is not already present. Use a separate practice result when today's brief exists.

Then ask:

```
Inspect this server's system time zone and Hermes scheduler configuration. Show the current local time and the next intended 07:00 run in my chosen named zone. Confirm /home/ai/hub is the working folder and skills/morning-brief/SKILL.md exists.

Prepare one daily morning-brief schedule using that folder and zone. Its prompt must read AGENTS.md and the skill. Preserve existing daily briefs. If an installer-created 06:00 job exists, edit or retire it rather than adding another.

Ask me to choose server-local results or delivery to my own connected Telegram chat. For local results, save brief/YYYY-MM-DD.md and show its full server path; I can read it through Chapter 32's desktop connection. For Telegram, verify the exact destination is my allowed chat and show it before I confirm. Save Telegram as this job's delivery setting only after that confirmation. Authorize only delivery of my brief to that chat, never messages to customers or other people. The skill still saves the file and does not send messages itself.

Show the saved job record, next run, output path, delivery setting and pause control. Do not claim scheduled delivery works based on an ordinary bot conversation.
```

Pause the laptop's copy of the same job before turning on the server schedule. Record the server as the active location in `procedures.md`. You can keep the skill on both machines, but you don't need both timers producing tomorrow's brief.

Try a one-time practice job due in five minutes, using your chosen delivery setting and `practice/brief-tests/server-timer-test.md` for the result. Afterwards, read the file and run history, and check that no future run remains. If you chose Telegram, look for the scheduled result in the intended chat. For local results, open the server file through the desktop connection. Then leave the daily job active. This short test checks the route; it doesn't tell you how a full night will go.

## Know what the recovery checks cover

The server setup checked for this book also installs a local watchdog, which means scheduled checks on the assistant's service. A basic check runs every five minutes and can try a restart. Separate jobs review logs with AI and ask the model for a short response.

The basic service check can work without a model. The model probe **needs** a model response to pass, but detecting its failure and reporting the error through a working Telegram connection don't. That distinction lets the check report a problem even when the model is the problem.

All these checks still live on the same server. If the whole server or its network goes down, they may be unable to check or tell you anything. A monitor running elsewhere would be a separate addition.

The limited `ai` user reduces local authority. It can still change its own files and use credentials it holds. Retain narrow access and the Chapter 17 approval rules.

## Confirm what survives a restart

The gateway runs as a service intended to start again with the server. In one earlier test it returned fourteen seconds after a reboot. That was encouraging, but your setup needs its own restart test before you depend on it.

Plan that test before an unattended deadline matters. After restarting, check the model connection, next run and a harmless file read, then look for the expected output. Record anything that still needs fixing while the test is fresh.

Remember that GitHub shows what was pushed, not every current file on the server. To open live files and work with the actual schedules, we'll add the desktop connection in Chapter 32.

# Chapter 31: Install Your Hub on a Linux Server

This chapter is optional. Use it when scheduled work must run while your own computer is asleep, or you want to ask your hub questions from a phone.

A rented server is another computer with its own copy of the hub. It still needs power, network access, updates and a working model connection. Renting one does not guarantee uninterrupted work.

## Check the requirements before renting

The historical setup used Ubuntu on a Hostinger KVM 2 server. That identifies the tested route; it does not establish that every small Linux server will work. Check the current companion server guide for supported Ubuntu versions, resources and installation requirements.

You need a model account supported by Hermes, access to your private GitHub repository and, for the phone route here, Telegram. Check current account eligibility and allowances. This chapter makes no promise that a free model account will support daily unattended work.

Review the server's full rental price, renewal price and tax before buying. Use your existing suitable server if you have one.

## Run the server installer on the server

Open the provider's browser terminal or your SSH terminal. SSH is a secure remote login. Confirm that the terminal belongs to the server, not your laptop.

The setup starts as `root`, the administrator account. Review the script from your companion release first, then run:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install.sh | bash
```

That address follows the current source. For a repeatable installation, use the same reviewed release or commit version throughout, including the Chapter 32 script. Do not mix an old installer with an unrelated newer setup guide.

The installer creates the limited user `ai`, installs Hermes and prepares `/home/ai/hub`. Read each completed step and any actual error before continuing.

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

If the server is your first hub, it has not met the people in your life. Make the Chapter 1 summary and review it using Chapter 2. Place that reviewed summary in `/home/ai/hub/what-my-ai-knew.md` through the available upload or remote file route. Then use Chapter 4's filing prompt to put the information in its separate profile files.

Do not ask a fresh server about Nadia unless you deliberately installed Sam's fictional practice material. A missing person in an empty profile is not an installation failure.

A file-specific answer tests the messenger, model and folder route together. If it fails, inspect those separately. A vague answer does not prove which part failed.

## Move one schedule, not two

Build and manually test the morning-brief skill in this server folder if it is not already present. Use a separate practice result when today's brief exists.

Then ask:

```
Inspect this server's system time zone and Hermes scheduler configuration. Show the current local time and the next intended 07:00 run in my chosen named zone. Confirm /home/ai/hub is the working folder and skills/morning-brief/SKILL.md exists.

Prepare one daily morning-brief schedule using that folder and zone. Its prompt must read AGENTS.md and the skill. Preserve existing daily briefs. If an installer-created 06:00 job exists, edit or retire it rather than adding another.

Ask me to choose server-local results or delivery to my own connected Telegram chat. For local results, save brief/YYYY-MM-DD.md and show its full server path; I can read it through Chapter 32's desktop connection. For Telegram, verify the exact destination is my allowed chat and show it before I confirm. Save Telegram as this job's delivery setting only after that confirmation. Authorize only delivery of my brief to that chat, never messages to customers or other people. The skill still saves the file and does not send messages itself.

Show the saved job record, next run, output path, delivery setting and pause control. Do not claim scheduled delivery works based on an ordinary bot conversation.
```

Pause the laptop's version of this same job before activating the server version. Record the server as the active location in `procedures.md`. The old skill file can remain on the laptop; the old timer should not keep firing.

Use a one-time practice job due in five minutes with the chosen delivery setting and a separate output at `practice/brief-tests/server-timer-test.md`. Confirm the saved result, run history and no future occurrence. If you chose Telegram, confirm that this scheduled result arrived in the intended chat. If you chose local results, open the server file through the desktop connection. Then leave the daily job active. A short test is not evidence of a full night of operation.

## Know what the recovery checks cover

The inspected server setup adds a local watchdog, meaning scheduled checks of the assistant's service. A plain service check runs every five minutes and can try a restart. An AI log review runs separately. A periodic model probe asks for a short response.

The service check does not need a model. The model probe **does** need the model to succeed. Detecting a failed probe and sending its error through a working Telegram connection do not require a successful model answer.

These checks still run on the same server. A total server outage or loss of its network can prevent every local check and alert. An independent outage monitor would be a separate addition.

The limited `ai` user reduces local authority. It can still change its own files and use credentials it holds. Retain narrow access and the Chapter 17 approval rules.

## Confirm what survives a restart

The gateway is installed as a service, intended to restart with the server. A historical test observed it returning fourteen seconds after reboot. That is one measurement, not a recovery-time promise.

Before depending on an unattended deadline, test a planned restart on your own setup. Afterwards check the model connection, next run, a harmless file read and the relevant output. Record the result and any remaining issue.

The private GitHub copy shows only work that was pushed. It is not a live view of every file on the server. For live files and schedule controls, Chapter 32 adds a desktop connection.

# Chapter 29: Use the Same Mission Control on Another Computer

A new computer comes with enough setup to do without asking you for your life story. Your saved background and methods can travel with Mission Control. You'll still arrange model access, suitable permissions and a notebook connection if you use one, but the explanations you've already written can come with you.

A private GitHub repository, an online copy of selected files and their Git history, can carry them across. We'll check the app settings and schedules separately, because some live outside the folder. That is how we find the difference between a computer that holds your instructions and one that can do the work.

## Join the existing mission control

This route needs a private GitHub copy of your mission control. If you have not made one, ask the assistant to prepare it from reviewed local files and history, show what will be uploaded, and wait for your approval. Confirm the repository is private and the uploaded version matches before continuing.

Ask your assistant to save your latest work and upload it to your private GitHub repository before leaving the first computer. Git calls that upload a push. Have it verify that the uploaded version matches and give you the repository link. That online copy is the version the second computer can fetch.

On Windows, download `GodspeedSetup.exe` from the [companion kit's Releases page](https://github.com/MichaelZelbel/teach-it-once-kit/releases). Confirm that source before accepting any Windows installation warning. Choose the existing private repository when offered and keep the suggested folder inside your user folder. Untick history-collection tools unless you want their local conversations copied.

For macOS or Linux, ask the assistant on your first computer to prepare the command below with the verified repository address already filled in. Then paste its finished command into the terminal on the new computer:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/install-godspeed.sh | bash -s -- --sources "" --repo YOUR-PRIVATE-REPOSITORY-URL
```

`YOUR-PRIVATE-REPOSITORY-URL` is a placeholder for the assistant to replace. The installer copies the files and their history from that address onto this computer and guides any required sign-in. Keep its completion report so the assistant can inspect a failed step. The `--sources ""` option leaves local conversation collection off. The address above retrieves the currently published installer.

Open the installed mission control in your assistant and ask for a harmless line you saved recently, with the source file. Then ask it to check which skills are available. These are answers you can check. “Do you know me?” invites a charming reply that may tell you very little.

Try a real skill with harmless input as well. You want to see the new machine read the file, find the skill and reach the model. Once those checks work, you're ready to continue.

## Know what was copied

The installer connects the new computer to the folder, sets up the shared skill locations and configures the supported assistant behavior. The installer may leave a second path pointing at the same skill files. Edit the `skills/` folder you can see, and you won't have to work out which copy you are looking at.

Before importing an assistant's existing notes, read them and keep the old copy while you check what's moving. An assistant can have a very settled opinion about a preference you never expressed. A new computer is no reason to give that opinion another home.

Conversation collection is optional. The setup choices taught here leave it off, but an installer run with its automatic source selection can enable supported tools it finds. If enabled, the collector copies available local conversation text into `prompts/archive/`; it does not retrieve every chat from your online accounts.

Before switching computers, ask the assistant to review and upload your changes. On the other computer, ask it to fetch those changes before starting work. Git calls fetching and applying those changes a pull. If you enabled Menerio's scheduled copying, its hourly check also tries to fetch changes when the computer is awake. Check that it succeeded before relying on it. If you edited the same text on both computers, the assistant may need you to choose which version to keep.

## Optional: carry encrypted credentials

If your password manager already handles your credentials comfortably, keep using it and enter them separately in each application's settings. Choose the kit's encrypted store in `secrets/` when you want protected values to travel with the private mission control. That saves carrying each value across yourself, at the cost of looking after one more phrase.

Encryption makes the stored values unreadable without the correct phrase. Keep that phrase in your password manager, outside Mission Control. The separation does useful work: anyone with both the store and the phrase can recover the credentials.

Use the installer's dedicated credential prompt on the first machine and its local phrase prompt on the other one. Keep the keys and phrase out of AI conversations.

After saving the key, test the app that needs it. I learned to insist on this because I once put everything in the right place and still couldn't use the service.

## Check that a program receives the current key

I had stored a new key, saved the file and pushed it to my backup. My assistant had confirmed each step. I opened the next session expecting to use the service, only to find it had no usable key. I had been very thorough about completing most of the job.

The store was right. The step that should have handed its contents to programs on that computer had failed. The error sent me looking for a missing encryption program, which was already installed; the process simply couldn't see its location.

[View the illustrated reading edition](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)

Ask the assistant to run `mc-check-keys`, the kit's credential check, and explain the result. It examines local storage, whether the store can be read with the phrase, and whether a fresh program receives the current values. It reports names, counts and dates rather than secrets. Read the outcomes alongside the names: a listed name alone doesn't confirm that its value is correct.

That local check doesn't sign in to each service. Follow it with a read-only test of the connection you need. Even a cancelled key can make the trip between computers perfectly and then be refused when it arrives.

## Record expiry accurately

Some credentials are keys you can copy to several machines. Others are sign-ins that refresh themselves and need to be completed on each one. The provider's instructions tell you which kind you have and how its expiry works.

Ask the assistant to record the credential's name, verified expiry date and renewal page in `secrets/expires.txt`. That record contains no secret value. The kit's deadline helper can read it, so keeping one entry prevents duplicate renewal reminders.

If the service gives no expiry date, have the assistant record “expiry unknown” as a comment rather than inventing a deadline. Use “never expires” only when the service establishes that. If the credential belongs in a machine's own sign-in store, keep it there and record how to renew it on that machine.

## Renew the existing entry

The service may require you to sign in to create or approve a replacement. Let the assistant prepare the local steps and checks, then use the service's secure input flow.

```
I have replaced the credential for the service I name. Inspect the existing record and update its one entry in secrets/expires.txt. Do not append a duplicate. Record the verified expiry and renewal page, or preserve an explicit unknown state if the service does not establish a date. Keep credential values out of this file and out of chat.

Help me load the replacement through a masked local input or the existing encrypted store. Run mc-check-keys, then the service's read-only connection test without printing any credential. Update the existing tracked renewal after checking the evidence. Do not treat a newer file timestamp as successful renewal.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-30-box-5)*

If you use the kit's deadline helper in your morning brief, it reads those dated entries and supplies the reminder. Writing an expiry date alone does not create a schedule. The local credential check also does not prove the service accepted the replacement; that is why the prompt asks for a real connection test.

## Inspect the machine's optional jobs

If you enabled Menerio copying or conversation collection, those jobs use the computer's own scheduler, separate from the one that starts jobs in Hermes. Have the assistant read the installer's report and inspect which jobs are active, so you know where to stop them later.

Ask the assistant to inspect the machine scheduler and explain each kit job it finds. On Windows, the relevant Task Scheduler names are **Godspeed notebook sync** and **Godspeed prompt archive**. On macOS or Linux, the installer uses the user's scheduled-command list. To stop collection, ask it to disable that specific job and verify the result, preserving unrelated jobs.

Notebook sync can also have a Git post-commit hook. Ask the assistant to inspect that hook before disabling it, preserving any unrelated custom work. Ordinary editor saves do not trigger it.

Record the enabled jobs and how to stop them in `procedures.md`. Then read the log and look for a harmless recent update. The schedule says when the copying should happen. The changed file shows you what arrived.

## Updating an older mission control

Before running the installer again on an older folder, save a version you can recover and read the proposed migration. Afterwards, look for the profile, observations and skills in their intended places, then try a file read and a skill. These checks are easier while you still remember what the folder looked like.

Use these checks again when replacing a computer. Once it can read the files and use the connections, you can carry on with the work.

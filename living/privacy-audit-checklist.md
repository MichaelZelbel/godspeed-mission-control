# Chapter 18: Check Where Your Private Information Goes

"What exactly does that AI know about us, and where does it keep it?" That is a fair question, especially when the person asking appears in your notes.

You can open your mission control folder and read what you've put there. The less obvious part is where that information goes after an assistant reads it.

With a cloud model, the information in the request goes to the model provider. A connected tool may send some elsewhere too. We've reviewed the backup; now let's trace the other places a copy can reach. Knowing the route gives you a practical basis for choosing what to share.

## Name the locations

| Location | What to inspect |
|---|---|
| Your mission control and its backup history | Current files, archived captures and earlier saved versions |
| Hermes conversation records | The conversations saved by the application |
| Hermes' own saved notes | Notes the application keeps outside your mission control |
| Providers and connected services | Data sent in requests, retention settings and granted access |

The first three locations include records on your own computer. Inspecting them tells you what is kept locally, but it won't reveal every copy a provider may hold. A cloud request can draw information from any of these local records.

## Review Mission Control again

Before adding an upload destination, check the current files, earlier saved versions and exactly which material would leave the computer. For a wider look at the files, the app and its connections, ask:

```
Review where this mission control's information is stored or sent. Begin with a local file inventory and the configured backup destinations. Include current files, archives and earlier Git history where present.

Identify credentials, unintended personal material and information about other people that deserves review. Do not print secret values or send files to a separate scanning service. Report paths and categories. Do not change or upload anything.

Separately list the assistant's local conversation and memory locations, plus configured providers and connected services you can actually inspect. Mark unknown destinations or retention settings as unknown. Distinguish what a local deletion would remove from copies elsewhere.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-19-box-1)*

Asking a cloud assistant to check private files has an awkward catch: what it reads may itself go to the provider. For the most sensitive material, make a local list and inspect it yourself. Look beyond passwords. A private story doesn't need a suspicious string of numbers to deserve care.

## What the earlier audit caught

I tested the older privacy prompt on a practice folder I'd deliberately made untidy in familiar ways: credentials in notes, personal details and project problems that weren't meant for sharing. It found them, then pointed out:

> The **red lines** in `AGENTS.md` are a good design, but they only bind an AI you're running. They don't stop a human who can read the folder. Credentials, medical info, and unshared bad news need to be *out of the folder*, not just protected by a rule at the top of it.

A rule can tell the assistant to keep something private. It does nothing to stop a person who already has access to the folder from opening the file. The privacy review needs to examine the contents as well as the instructions above them.

When I asked for cleanup, the assistant kept the originals and made a cleaned copy beside them, so I could compare the two. Before sharing, I read the new copy and its history myself. "Cleaned" is a useful description of work to inspect, not a reason to skip the inspection.

## Inspect the application's own records

Ask the assistant where this installation stores conversation history and saved notes, and have it identify those locations without printing private contents. In the version I used, transcripts sat in a local database and saved notes included `MEMORY.md` and `USER.md` inside a `memories` folder.

These application files are separate from `observations/` in your mission control. Asking the assistant to save a note in the shared folder doesn't mean the app keeps no notes of its own. I checked both places during the earlier tests for that reason.

Hermes can also keep separate application profiles, each with its own settings and records. These are different from the `profile/` notes inside your mission control. Before removing one, read what the app says it will remove and check any others you use. In one test, copying an application profile carried its saved notes along. I had given it a fresh name; it had brought its memories anyway.

Use the application's export or removal controls where available, and keep track of copies you've made in Mission Control, its backup or elsewhere. Deleting a local record sends no request to the provider to delete theirs.

## Check the access a job actually needs

Choose access to fit the job. An assistant researching public pages has no reason to open your mailbox. One preparing a brief from project files can do that without permission to contact everyone named in them.

For each connection, name the job it serves. Start with read-only access when the job is research or preparation; add permission to change things when the work actually requires it. Check the provider's current retention and training settings for your account and service, since those determine how it treats the information you send.

Keep credentials in the supported secret store or sign-in system, outside ordinary notes and prompts. For personal information, bring your own knowledge to the review. A scanner may find a password and miss why one harmless-looking sentence about a friend should never leave the folder.

## Review removal by location

To remove a detail, follow the places it could have reached: the current file, old versions, app notes, conversations, exports and provider records. Check each location separately. A local deletion can be complete and still leave copies elsewhere.

If you leave a service, take your mission control files with you and review what the service retains and which account permissions remain. Owning the files makes departure easier; it doesn't perform the cleanup for you.

For the first jobs you run while away, give the assistant agreed sources and ask it to prepare a result for you to read. You can see what it used and judge whether the access was useful. Add more access when a real job gives you a reason, with the same care you used for the first connection.

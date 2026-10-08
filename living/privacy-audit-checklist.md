# The Privacy Audit (Chapter 22)

Where your information is kept, and where it goes when an assistant reads it. Run it before
the first upload to a backup or any other destination, and again when you add a connection.
Four drawers.

## Drawer one: your mission control and its backup history

Current files, archived captures and earlier saved versions. In your mission control, ask:

```
Review where this mission control's information is stored or sent. Begin with a local file inventory and the configured backup destinations. Include current files, archives and earlier Git history where present.

Identify credentials, unintended personal material and information about other people that deserves review. Do not print secret values or send files to a separate scanning service. Report paths and categories. Do not change or upload anything.

Separately list the assistant's local conversation and memory locations, plus configured providers and connected services you can actually inspect. Mark unknown destinations or retention settings as unknown. Distinguish what a local deletion would remove from copies elsewhere.
```

*[Copy prompt](https://querino.ai/prompts/privacy-audit)*

What a cloud assistant reads may itself go to the provider, so for the most sensitive material
make a local list and inspect it yourself.

What the audit looks for:

1. **Credentials**: passwords, access keys, card numbers. Out of the folder, always.
2. **Other people's private information**: anything the work does not need.
3. **Bad news not yet delivered**, and other project problems not meant for sharing.
4. **Other personal material** you did not mean to keep.

A rule in `AGENTS.md` binds the assistant, not a person who can open the folder, so these
need to be out of the folder. When you ask for cleanup, the originals should stay and a
cleaned copy appear beside them; read the copy and its history yourself before sharing.

## Drawer two: Hermes conversation records

Ask the assistant where this installation stores its conversation history, and have it name
the locations without printing private contents.

## Drawer three: Hermes' own saved notes

Ask the same for the notes the app keeps outside your mission control, such as `MEMORY.md`
and `USER.md` inside a `memories` folder. They are separate from `observations/`, so check
both.

Hermes can also keep separate application profiles, each with its own records, and copying a
profile can carry its saved notes along. Before removing one, read what the app says it will
remove.

## Drawer four: providers and connected services

- [ ] Each connection names the job it serves. Research and preparation start read-only.
- [ ] Your model provider's retention and training settings are set the way you want, in
      your account with that provider.
- [ ] Credentials sit in the supported secret store or sign-in system, never in ordinary
      notes or prompts.
- [ ] If you connect your mailbox (Chapter 32), the text of each message your mission control
      reads goes to the model provider. Forwarding single messages to its own address
      (Chapter 31) shares less.

## Removing a detail

Follow every place it could have reached: the current file, old versions, app notes,
conversations, exports and provider records. Deleting a local record sends no request to the
provider to delete theirs.

## The sorting rule

- **In:** who matters, projects, preferences, plans, voice.
- **Never:** passwords, access keys, full card numbers, anything that is access rather than
  information.
- **Other people:** only the detail the work needs, in words you could defend to their face.

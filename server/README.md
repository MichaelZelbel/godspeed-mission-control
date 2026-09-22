# server

Optional. Chapters 32 and 33. This solves one specific problem and nothing else.

**The problem.** Hermes' clock lives inside its gateway, so a scheduled job fires only on a
machine where the gateway is running, and a slot it was down for runs once, late. A brief that reads
your real files at 6am needs a machine that is awake at 6am with Hermes running. If you work at
a desk machine that stays on, you may never need this folder.

**The answer.** A small rented Linux machine holding its own clone of your folder, kept in step
through a private GitHub repository, with Hermes' gateway as a system service that starts with
the machine. You can bring the repository from Chapter 18 or let the installer make a new private
one from the starter rooms. For a reader whose server is the first machine in the system, the
brief is a later chapter, so the installer asks before it puts that job on the clock.

## Start here

Log in to the machine you rented and paste this one line:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install.sh | bash
```

It first explains the ChatGPT choice. The route uses ChatGPT's included Codex allowance rather
than API billing; Plus or higher is the practical choice for work that runs every day. Then it
asks whether a repository already holds your folder. Paste its address to fetch it, or press Enter
and name a new private repository. It creates the first commit, pushes it, and checks that GitHub
reports it private. Two codes appear on any device: one signs Hermes in to ChatGPT and one signs
the machine in to GitHub. It never asks for a GitHub token or an SSH key. Its first stop is a
Telegram bot of yours: paste the token BotFather gives you, send the bot one message, and the
server learns your id from the bot's own message log; the last thing the installer does is send
you a message through it.

| File | What it is for |
|---|---|
| `install.sh` | The one line above. Covers both chapters. Root's phase, then the assistant's account. Built on the shared primitives in `kit-bootstrap`, pinned to a tag. |
| `open-the-door.sh` | The second pasted line, Chapter 33, as root, after Telegram is connected: puts the server on the reader's Tailscale network, writes the three basic-auth lines, runs `hermes dashboard` as a system service on the private address, and checks the page asks for the password. From then on Telegram and the other messengers are connected on the page's **Channels** form, and the Hermes app connects through **Settings > Gateways > Remote gateway**. `DOOR_HOST=<address>` skips Tailscale. |
| `install-watchdog.sh` | Root's watchdog step, run by `install.sh` after the gateway service and before the hand-over, and runnable alone on a server built by hand. Clones the open-source `hermes-self-devops-watchdog` at a pinned tag, fetches its hash-verified floor, makes the `watchdog` profile for the assistant's account with the conservative leash (read back, tested both ways), and writes one marked block into root's crontab: the floor every 5 minutes, the self-check every 30, the second Hermes four times a day. `install.sh` then asks that second Hermes for one word after the sign-in. |
| `create-private-repo.sh` | Creates and pushes a fresh private GitHub repository, or repairs a first push that did not finish, then verifies the branch and privacy before scheduled work is added. |
| `test-create-private-repo.sh` | Runs the repository step against real local git repositories and a local replacement for GitHub's create and privacy answers. |
| `steps/build-the-server.md` | What the installer does, step by step, for a human reading along or hunting a broken step. |
| `setup.md` | The same build by hand, for when you want to know what it did, or something broke. |
| `install-hermes.sh` | The Hermes half on its own, if you built the server by hand: the `AGENTS.md` ceiling, pointing Hermes at the folder and proving it, the gateway (a user service, unless the system service is already there), and the `morning-brief` cron job (skipped with `KB_MORNING_BRIEF=no`; the one-line installer asks). |
| `three-traps.md` | The three things that went wrong building this for real, and the fixes. |

The installer stands on `kit-bootstrap`, a small public repository that holds the install steps
shared with the other kits, so the same code is not maintained in two places:
<https://github.com/MichaelZelbel/kit-bootstrap>

## Read this before you build anything

Three findings from building it on a blank machine on 2026-07-26, and what Hermes changed.

1. **On a server, "ask me first" means "no".** With nobody there to answer a permission prompt,
   a request that waits is a stop button that presses itself. The leash has to be the walls:
   give the assistant its own user account that can reach almost nothing. Hermes ships the
   other half: a scheduled job that reaches for a dangerous command is refused, not paused.
2. **`git add -A` will commit your keys.** Keep the key file OUTSIDE the folder, in the home
   directory, and put `.env*` and `.mc-env` in `.gitignore` as a second net.
3. **A silent failure looks exactly like a quiet morning.** The job's own prompt orders it to
   say so when the recipe is missing or the brief cannot be written, `hermes cron incidents`
   keeps the record, and `hermes cron status` says in one line whether the clock will fire at
   all. Build that on day one, not after the first outage.

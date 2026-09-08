# Optional Linux server (Chapters 31 and 32)

Use `setup.md` for the reviewed reader route and `remote-desktop-setup.md` for the desktop connection. The historical setup used Ubuntu on a Hostinger KVM 2 server; verify current resources, account access and rental terms before installation.

| File | Role |
|---|---|
| `install.sh` | Server entry script, started as root. |
| `install-hermes.sh` | Hermes configuration used by the server installation. |
| `install-watchdog.sh` | Adds local service checks and an AI log-review/probe route. |
| `open-the-door.sh` | Optional private network and web-interface setup. |
| `create-private-repo.sh` | Private repository creation and checks. |
| `test-create-private-repo.sh` | Isolated checks of that repository step. |
| `steps/build-the-server.md` | Implementation notes for inspecting the scripts. |
| `three-traps.md` | Permission, credential and failure-detection limits. |

Use one reviewed version of the scripts together. A server folder copy does not move a desktop schedule. Confirm `/home/ai/hub`, the named time zone, one active schedule, its next run and output. Keep the default brief schedule off until its inputs and delivery have been checked.

The model probe requires a model response. Failure detection and Telegram alert sending do not require the model to answer, but do require the server and network. A total-server outage can silence all local checks.

The public repository remains [teach-it-once-kit](https://github.com/MichaelZelbel/teach-it-once-kit). This private review kit does not publish its changed guidance or change those public scripts.

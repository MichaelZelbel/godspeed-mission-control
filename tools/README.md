# Installed hub commands

These are program sources and launchers used by the companion installation. Copying `starter-hub/` alone does not install them. The private reader revision changed guidance and skill text, not these programs.

| Command | Purpose and limit |
|---|---|
| `hub-compile-rules` | Rebuild the compiled rule block from rules/. `--check` inspects whether it is current. See Chapter 16. |
| `hub-check-brief FILE` | Check delivery-format problems, including unsupported local-file instructions. It does not check factual truth or word count. See Chapter 21. |
| `hub-due` | Inspect the full deadline list. The daily cycle runs `hub-due check` before `hub-due today`. See Chapter 26. |
| `hub-due done NAME` | Manually close a completed task. |
| `hub-due drop NAME --yes` | Deliberately remove a task and its history. |
| `hub-check-keys` | Inspect stored versus locally available credentials and recorded expiry. It is not a successful login to every service. See Chapter 29. |
| `hub-notebook-sync --verbose` | Inspect an explicit sync run, selected uploads, downloaded records and failures. See Chapter 28. |
| `hub-prompt-archive` | Collect supported authorized local conversation text if enabled. The taught setup leaves collection off; filtering is not a complete privacy guarantee. See Chapters 18, 29 and 33. |

Use `--hub PATH` on deadline commands for disposable practice. `file-newer` checks only modification time and can close an unfinished file. Normal daily selection is capped; urgent overload includes all affected titles. Repeated same-day output is not proof of new delivery.

Inspect the installed machine job and logs before claiming automatic collection or sync works. Sync can run after a Git commit when its hook is installed, and on the hourly check, not on every editor save. Keep failed checks visible.

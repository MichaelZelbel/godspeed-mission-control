# Chapter 33: Try Your Hub With Another AI Assistant

Your files should give another assistant a useful starting point. This test checks what it can read without another long introduction. It also shows what still needs setup.

The base test uses local files only. You may skip the notebook chapters entirely and still do it.

## Prepare a second assistant

The historical test used OpenCode with a Moonshot model through OpenRouter. You can use the same route after checking the current [OpenCode documentation](https://opencode.ai/docs) and [OpenRouter model listing](https://openrouter.ai/models).

If you choose that route, install OpenCode with the command documented for your platform. The tested Node.js route was:

```
npm install -g opencode-ai
```

Node.js supplies the `npm` package command. If it is absent, use its official installer first. Creating or funding an OpenRouter account is a separate choice; check the current usage price and account limits before paying.

Save this base configuration as `opencode.json` beside `AGENTS.md`. Preserve an existing configuration and compare changes before replacing it.

```json
{
  "model": "openrouter/moonshotai/kimi-k3",
  "permission": { "edit": "ask", "bash": "ask" }
}
```

The model name identifies the earlier route. Confirm it remains available before using it, or select a current model and record the choice. The configuration includes no notebook. OpenCode merges project and user settings, so inspect the effective configuration for any connection already enabled elsewhere. [OpenCode configuration reference](https://opencode.ai/docs/config/).

## Load the provider key without writing it in chat

Ask your assistant to confirm your terminal type and prepare a masked local input method. The key should reach the program you launch, without being written in the hub or shell history.

For PowerShell, this pattern asks for the key without displaying it. Run `opencode` from that same terminal afterwards:

```powershell
$providerSecret = Read-Host 'OpenRouter API key' -AsSecureString
$env:OPENROUTER_API_KEY = [System.Net.NetworkCredential]::new('', $providerSecret).Password
opencode
Remove-Item Env:OPENROUTER_API_KEY
$providerSecret = $null
```

For a Bash terminal on macOS or Linux:

```bash
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
printf '\n'
export OPENROUTER_API_KEY
opencode
unset OPENROUTER_API_KEY
```

The value is available to the launched process while it runs. Removing it afterwards does not erase records a provider already received. Keep access limited as in Chapter 19.

## Test the local files first

Open the second assistant in your hub and ask:

```
Whose folder is this, what are the house rules you must follow here, and which file would you check for what matters most right now? Answer from what is in the folder. Do not change anything. Name the files you actually read.
```


In the 2 September 2026 test with fictional illustrator Sam's folder, the answer began:

> **1. Whose folder is this**
> Sam Okafor's, a freelance illustrator based in Bristol, UK, who draws for children's publishers and the occasional brand (from `profile/about-me.md`). This folder is Sam's "hub": the shared world of profile, rules, skills, procedures, and decisions that `AGENTS.md` says to read first every session.

It also identified Sam's project priorities. That demonstrated a useful file read in that setup. It did not prove that every instruction would be followed in every later action.

Next choose a skill you actually have. If you installed the day-planning skill, use:

```
Read skills/plan-my-day/SKILL.md. In three sentences, explain what it produces and the limits it follows. Do not execute the skill or change anything. End with exactly: Nothing modified.
```


The original test answered accurately for the older recipe and ended with “Nothing modified.” Its old recipe required the most important task first. This edition's day plan preserves fixed commitments, so use the skill in your current folder as the source of truth.

Check the folder afterwards for unexpected changes. Then test actual execution separately with a harmless input, using Chapter 16's approach. Reading a skill is not the same as selecting it automatically or running it well.

## Optional: add the notebook

Only if you completed Chapter 29, use this expanded configuration. It adds the notebook to the base example; preserve any other settings you deliberately configured.

```json
{
  "model": "openrouter/moonshotai/kimi-k3",
  "permission": { "edit": "ask", "bash": "ask" },
  "mcp": {
    "notebook": {
      "type": "remote",
      "url": "https://mcp.menerio.com",
      "headers": { "Authorization": "Bearer {env:MENERIO_API_KEY}" }
    }
  }
}
```

Load `MENERIO_API_KEY` with the same masked input pattern, substituting that variable name and your notebook key. Start OpenCode from that terminal and remove the temporary variable afterwards. The `{env:...}` reference holds the variable's name, not the secret.

Then use a note you deliberately stored in the notebook. For the fictional Nadia notes:

```
Use my notebook tools to look up who Nadia is and how she wants bad news delivered. Report what the notebook returned and identify the notes. Do not read local files for this answer. State any gap and change nothing.
```


The historical run found the same gap as Chapter 29: the notes recorded Nadia's preferences without defining her role. It used the notebook rather than silently filling that gap from Sam's profile.

## Check what did not transfer

The files transfer. The assistant's permission settings, credentials, messenger connections and schedules may not. Hermes' saved jobs remain in Hermes until you explicitly move them.

Keep the second assistant's edit and command permissions set to ask while testing. Check its documented skill discovery separately. The fact that two applications read `AGENTS.md` does not make all their behavior identical.

The historical OpenRouter test cost a few cents for three questions. That is an observation about those runs, not a price forecast. Long agent sessions may read many more tokens, the small pieces of text used for billing. Check the selected model's current rates and your account's usage.

## Try another model inside Hermes

Changing a model within Hermes is a smaller change than changing the application. Its model picker is available through:

```
hermes model
```

Inspect the current provider options and costs before choosing. Retest a task whose behavior matters to you.

Hermes also supports backup models tried in order when the first provider fails. Inspect the configured list with:

```
hermes fallback list
```

Use the current help for `hermes fallback add` when setting one up. The backup provider needs its own valid access and allowance. It can fail too, and it may charge for usage.

An earlier isolated test used simulated providers: the first returned a rate-limit error and the backup returned a distinctive word. The word came back with the backup configured; the error came back without it. That proved takeover in those test conditions, not uninterrupted service from real providers.


The practical result is modest and useful. You can change tools without rewriting your profile and skills from memory. The new tool still needs a fresh test of the work you expect it to do.

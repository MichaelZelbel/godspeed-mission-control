# Chapter 33: Try Your Hub With Another AI Assistant

Try opening your hub with another assistant. How much can it learn from the files without asking you to give the whole introduction again? This is a useful test of what you own: the background and methods you've saved, and the work still needed to make a new tool use them well.

You can do the basic test with local files alone. If you skipped the online notebook, you haven't skipped a requirement for this chapter.

## Prepare a second assistant

I used OpenCode with a Moonshot model through OpenRouter for the earlier test. To try that route, first check the current [OpenCode documentation](https://opencode.ai/docs) and [OpenRouter model listing](https://openrouter.ai/models). The example gives you a starting point, not a reason to keep using a model that no longer suits the job.

If you choose that route, install OpenCode with the command documented for your platform. The tested Node.js route was:

```
npm install -g opencode-ai
```

The `npm` command comes with Node.js. If you don't have it, use the official Node.js installer first. An OpenRouter account, and any payment to fund it, is a separate choice. Check the current usage price and limits before paying.

Save this base configuration as `opencode.json` beside `AGENTS.md`. Preserve an existing configuration and compare changes before replacing it.

```json
{
  "model": "openrouter/moonshotai/kimi-k3",
  "permission": { "edit": "ask", "bash": "ask" }
}
```

That model name belongs to the earlier test. Check that it is still available, or choose a current model and record which one you used. This example doesn't add a notebook, but OpenCode combines project settings with user settings. Inspect the combined configuration for connections enabled elsewhere. The [configuration reference](https://opencode.ai/docs/config/) explains how they fit together.

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

It also found Sam's project priorities. That was what I wanted from the first check: it could read the files and use them to answer. I would still test its actions before trusting it to follow every instruction in later work.

Next choose a skill you actually have. If you installed the day-planning skill, use:

```
Read skills/plan-my-day/SKILL.md. In three sentences, explain what it produces and the limits it follows. Do not execute the skill or change anything. End with exactly: Nothing modified.
```


In the original test it described the older recipe accurately and finished with “Nothing modified.” That recipe put the most important task first. The current one preserves fixed commitments, so compare your answer with the skill you actually have. You don't need to recreate an old planning rule to pass this test.

Look for unexpected folder changes afterwards. Then give the skill harmless input and try the work itself, as in Chapter 16. Describing a recipe and cooking from it are different tests; here we want to know both that it can find the skill and that it can use it.

## Optional: add the notebook

If you completed the notebook connection in Chapter 29, you can now try this expanded configuration. It adds the notebook to the basic example. Keep any other settings you deliberately chose when making the change.

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


It found the same gap as the notebook test in Chapter 29: Nadia's preferences were there, but her role wasn't. The answer stayed with that source instead of borrowing the missing detail from Sam's profile. That made it much easier to see what the connection had actually contributed.

## Check what did not transfer

Your files can travel without taking every application setting along. Check permissions, credentials, messenger connections and schedules in the new tool. Hermes' saved jobs are still in Hermes until you deliberately move them.

Keep the new assistant set to ask before edits and commands while you're testing. Check its own documentation for skill discovery. Two applications reading `AGENTS.md` can still behave differently with the same folder.

My three-question OpenRouter test cost a few cents. Yours may cost something different, especially during a long session that reads much more text. Providers bill in tokens, small pieces of text, so look at the model's current rates and your account's actual usage.

## Try another model inside Hermes

Changing a model within Hermes is a smaller change than changing the application. Its model picker is available through:

```
hermes model
```

Read the current provider choices and costs, then try a task you care about with the new model. A familiar application can produce noticeably different work after that change.

Hermes also supports backup models tried in order when the first provider fails. Inspect the configured list with:

```
hermes fallback list
```

Use the current help for `hermes fallback add` to set one up. Give the backup provider valid access and enough allowance too. It is another service that can fail or charge for use, even though you hope not to need it often.

I checked this in an isolated test with simulated providers. The first returned a rate-limit error; the backup returned a distinctive word. With the backup configured, I got the word. Without it, I got the error. That showed the switch working in the test. Real providers still need their own access and failure checks.


You don't have to choose a permanent winner among assistants. Keep the profile and skills you have worked on, and test a new tool against work you can judge. Changing applications should mean checking the new setup, not trying to remember everything you taught the old one.

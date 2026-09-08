# Model access and costs (Chapter 33)

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

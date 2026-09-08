# Model access and costs (Chapter 33)

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

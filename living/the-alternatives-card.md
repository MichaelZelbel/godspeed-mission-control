# Chapter 32: Try Your Hub With Another AI Assistant

After putting this much care into your files, it's worth finding out how well they work with another assistant. Choose a job you know and let a second tool try it. You'll see which background and methods it can use immediately, and which parts of the setup still need your attention.

There are two different experiments here. Changing the model inside Hermes compares the software producing the answers. Changing the whole app also tests file access, instructions and permissions. Begin with the smaller change when that answers your question.

## Try another model inside Hermes

To compare models, keep Hermes and your files in place. Give each model the same task, source material and instructions so you can judge the difference in its work. Ask Hermes to show the models available through your current access and help you select one. Its `hermes model` command opens the provider and model picker when needed. Check any new cost before choosing, then try a familiar task you care about. The app can look exactly the same while the model does noticeably different work. Knowing the task gives you something better than a first impression to judge it by.

Hermes also supports fallback models, meaning alternatives it can try when the first provider fails. This is optional. Ask it to inspect the current fallback list and propose an addition only if you want one. The alternative needs valid access and enough allowance. It may not run often, but it is still a service that can charge for use or fail when called.

I checked this in an isolated test with simulated providers. The first returned a rate-limit error; the backup returned a distinctive word. With the backup configured, I got the word. Without it, I got the error.

## Prepare a second assistant

I used OpenCode, another assistant that works with local files, with a Moonshot model supplied through OpenRouter. OpenRouter is a service that provides access to models from several makers. That was my earlier test, not a requirement to buy another account.

Ask your current assistant to prepare the second app:

```
Help me test this hub with OpenCode. Read the current official installation, configuration and provider documentation. Inspect what is already installed before adding anything.

Use a provider account and model I choose after seeing the current access requirements and cost. Do not sign me up, fund an account or copy a credential into chat.

Install the supported version for this computer if needed. Preserve existing configuration and AGENTS.md. Set permission to ask before file edits and shell commands. Inspect combined project and user settings for other active connections; do not silently enable them.

Prepare a secure local sign-in or masked token-entry step and open the assistant in this hub. Confirm the folder and configured model. Keep schedules unchanged.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-32-text-1-20260913)*

The [OpenCode installation guide](https://opencode.ai/docs/) lists the supported routes, and its [configuration guide](https://opencode.ai/docs/config/) explains how project and user settings combine. The assistant can handle the installation and settings. You choose any paid access and complete the secure sign-in.

A configuration can name a credential without containing it. The running app still needs the real value through its sign-in store or a locally supplied environment variable, a named value available to a program. Let the assistant prepare that input method for your computer. Do not paste the value into a normal conversation.

## Test the local files first

Open the second assistant in your hub and ask:

```
Whose folder is this, what are the house rules you must follow here, and which file would you check for what matters most right now? Answer from what is in the folder. Do not change anything. Name the files you actually read.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-33-box-5)*

In the 2 September 2026 test with fictional illustrator Sam's folder, the answer began:

> **1. Whose folder is this**
> Sam Okafor's, a freelance illustrator based in Bristol, UK, who draws for children's publishers and the occasional brand (from `profile/about-me.md`). This folder is Sam's "hub": the shared world of profile, rules, skills, procedures, and decisions that `AGENTS.md` says to read first every session.

It also found Sam's priorities. That was a useful first result: the new assistant had read the files and used them in its answer. I still wanted to see it do a job. Describing the house rules correctly is promising, but it isn't much of a test of behaviour.

For the next question, choose one of your saved skills. If you installed the day-planning skill, use:

```
Read skills/plan-my-day/SKILL.md. In three sentences, explain what it produces and the limits it follows. Do not execute the skill or change anything. End with exactly: Nothing modified.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-33-box-6)*

The original test described the older recipe correctly and ended with “Nothing modified.” Compare your answer with the skill file you have now, since the recipe may have changed. You're checking how accurately this assistant read your method, not how closely it repeated my result.

Ask for a check of unexpected file changes, then try the skill with harmless input you can judge. Compare its result with the actual source and the saved instructions. Now you can compare what the assistant says it will do with what it actually does. I put more weight on the second result.

## Optional: add the notebook

If you use Menerio, the optional online memory service, give this new app its own read-only connection. Ask the assistant to configure its remote MCP tools at `https://mcp.menerio.com`, preserving other settings and referring to a credential name rather than writing the value into the configuration. Enter the key through the secure local method it prepares.

Test that the connection returns tools before asking a question. If you do not use Menerio, skip this section; the local-file test is complete without it.

Then use a note you stored in the notebook. For the fictional Nadia notes:

```
Use my notebook tools to look up who Nadia is and how she wants bad news delivered. Report what the notebook returned and identify the notes. Do not read local files for this answer. State any gap and change nothing.
```

In the earlier test, the answer found Nadia's preferences in the online notes, but not her role. It didn't borrow that detail from Sam's profile. That let me see what the notebook connection had supplied, without a helpful guess covering the missing part.

## Check what did not transfer

Your files can travel farther than your app settings. Check permissions, credentials, messenger connections and schedules in the new tool. A job saved in Hermes keeps running until you pause or stop it there; it has no way to know you've developed an interest in another assistant. Opening the same folder elsewhere won't move that schedule, and creating a new one won't stop the original.

Keep the new assistant set to ask before edits and commands while you're testing. Check its own documentation for skill discovery. Two applications reading `AGENTS.md` can still behave differently with the same folder.

My three-question test through OpenRouter cost a few cents. A longer session reading many files will cost more. Providers charge in tokens, small pieces of text. Check the model's current rates and your usage after the first real job, before deciding how much work to give it.

You don't need to choose an assistant for life. Keep the files you've worked on, and give each new tool a familiar job before trusting it with more. The useful lessons are already written down. Your next experiment can begin with those.

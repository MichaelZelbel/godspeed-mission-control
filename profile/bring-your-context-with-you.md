# Bring your context with you (Chapters 1 and 3)

Your folder should not start empty. Whatever AI you have been using already knows things
about you: who you work with, what you are focused on, how you like to be helped. This gets
a short, reviewed briefing out of it, saved as `what-my-ai-knew.md`, and files it into your
mission control.

It is a briefing, not a full export. The chatbot can only use the conversations and memory
your product, account and settings let it reach.

## Step 1: ask the AI you have been using

Open ChatGPT or Claude, whichever you already use for your work, and paste:

```
Help me create a short briefing that I can give another AI assistant. Start with information available to you in this conversation, accessible earlier conversations and saved memory. Do not imply you can read material you cannot access.

Tell me what you know under exactly these five headings:
- Who I am and what I do
- The people who matter
- What I am focused on now
- How I like to be helped
- My hard limits

Mark uncertain claims with (?). Distinguish things I told you from your interpretations. Do not include passwords, access keys, payment details or other credentials.

Then list at most six short questions that would fill important gaps. List them without asking me to answer yet.
```

*[Copy prompt](https://querino.ai/prompts/about-me-extraction-step-1)*

## Step 2: correct the claims that matter

Read the five sections in the chat. Correct whatever is wrong in plain words, for example:

```
Correct my employer. I now work at Company B, not Company A.
```

- [ ] Every wrong or out-of-date line corrected.
- [ ] A question you cannot answer yet left visible.
- [ ] Anything you do not want to share removed. Passwords, access keys and full card
      numbers belong in a password manager; removing them here does not erase the earlier
      chat or the provider's records.
- [ ] The complete revised briefing shown and read, and corrected again if needed.

## Step 3: download the finished briefing

Only when you are happy with the whole revised briefing:

```
Give me this briefing as a downloadable Markdown file named what-my-ai-knew.md. Keep the uncertainties visible. If you cannot create a download, give me the exact text to save in a plain text file with that name.
```

*[Copy prompt](https://querino.ai/prompts/download-my-ai-briefing)*

Save it on your computer as `what-my-ai-knew.md`. Chapter 2 moves it into your `godspeed`
folder.

## Step 4: file it into your mission control (Chapter 3)

In your mission control, ask:

```
Read what-my-ai-knew.md and file the useful parts into profile/about-me.md, profile/projects.md and profile/voice.md, and each person into my notebook, one page each. Use the meaning of the headings, not their exact spelling. Keep unanswered questions in inbox/. Keep the original file. Add the source and today’s date to what you import. Show me what you changed; do not fill gaps by guessing.
```

*[Copy prompt](https://querino.ai/prompts/file-my-import-into-the-folders)*

Open the changed files and check where each piece went. Unanswered questions stay in `inbox/`,
and the original briefing stays as the source.

## Do it again later

If you keep using that other AI, Chapter 24 saves the Step 1 prompt, and only that prompt, in
`prompts/library/bring-your-context-with-you.md`. The weekly review then reminds you on the
first review of each month; `procedures/outside-ai-check.md` is that reminder as a file.

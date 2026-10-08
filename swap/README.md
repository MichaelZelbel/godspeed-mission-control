# Try another assistant

Chapter 37, optional. Start with `three-questions.md`. Ask the assistant to verify the current OpenCode installation and configure your chosen provider.

`opencode.json` is the example settings file from the book's test. It sets conservative permissions: OpenCode asks before it edits a file, runs a command or fetches a web page. It also names the model that test used, `openrouter/moonshotai/kimi-k3`. Choose a currently available model during setup and use its name instead; `openrouter-notes.md` says what to check first.

The same file carries two optional connections. `notebook` reaches Menerio, under the same name the connect step gives it in your other assistants, and names the key in your mission control's store, `MENERIO_API_KEY`, without containing it. `mc-mail` is the mail tool from Chapters 31 and 32, so on a computer where Gmail is connected, OpenCode uses that connection with no second sign-in. Start without the notebook: add that block only after the local file and skill tests pass.

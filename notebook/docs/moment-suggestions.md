# Timeline suggestions

The Add Moment form's suggestion button calls `draft-event`. This is a read-only extraction request, independent of notebook chat and memory search.

The request contains the latest user description, the form's current date and known people's names. It does not retrieve notes, facts, goals, media, embeddings or previous conversations. Contact details and other request properties are omitted.

One AI call returns a JSON draft with the existing timeline fields. The prompt preserves the description's language and wording, resolves relative dates against the supplied date and matches names against the supplied people. Required date, title, status, impact and confidence fields are validated before the existing form normalization runs. An incomplete answer asks the person to try again instead of making a second AI call.

A total 20-second deadline aborts the provider request and returns a retry message. Drafting skips notebook writer-lock waits because it neither reads nor saves notebook records. Other endpoints retain their existing write coordination and time budgets.

Regression checks:

```sh
cd notebook
node --test test/moment-draft.test.mjs test/provider-budget.test.mjs test/memory-tools.test.mjs
```

The tests cover request isolation, no saves, malformed and incomplete answers, field normalization, English and German extraction contracts, an HTTP request while another writer holds the notebook lock, and deadline cancellation. Actual model quality and latency require a smoke test against the installation's configured provider. A suggestion itself does not save a moment.

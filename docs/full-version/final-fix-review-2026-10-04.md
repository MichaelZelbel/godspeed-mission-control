# One scoped final fix review

Reviewed `03459f95ed63e16b12297cd43abae4145761a756..e8144fda6576793ddd801f2313254d335785c251`, including its accepted correction `576f0da18908e54e317cc88780bfa4018d20fd67`, on 4 October 2026. The intervening root documentation commit does not change reviewed behavior. This is the single requested check of the four reported issues and their fix wave, not another whole-branch review.

## Result

The four original findings are corrected in the inspected paths. The additional assistant Undo refusal discovered during this same scoped check was corrected before the check closed. No remaining Critical or Important finding is asserted within this fix-wave scope. Matching-package and installed-control verification remain parent-owned acceptance work.

### Resolved during this scoped check: assistant Undo rejected its historical receipt links

- Location: `notebook/core/assistant-mutations.mjs:18,39-42`.
- `assertAssistantLinks` treats every review receipt's `applied_targets` entry as a required currently visible record. The final commit guard checks these links against the projected post-Undo state. Undo intentionally marks its created claim removed, so the unchanged historical receipt points at a tombstone and the guard throws `Choose a visible existing record`.
- Trigger: create current home city Town A, Keep a suggestion for Town B, then invoke MCP `review_suggestions` with `action:"rollback"`, the review ID, every current `type/id` hash and all eight scopes. The review is visible, all existing records are visible, and the supplied versions are current.
- Reproduced using the actual `Store.transaction`, `Domains`, `QueryService`, `Review`, MCP and guard code with the same in-memory storage adapter described in `final-review.md`. No live or temporary file fixture was created.

Captured result:

```text
MCP review_suggestions result:
  processed: 1
  succeeded: 0
  errors: [{error: "Choose a visible existing record"}]
current home city: Town B
review status: kept

Same rollback through owner Domains.invoke:
  processed: 1
  succeeded: 1
  errors: []
current home city: Town A
```

The exact MCP request used:

```js
const expected = Object.fromEntries([...store.records.values()]
  .map(r => [r.type + '/' + r.id, r._hash]));
await mcp({id:1, method:'tools/call', params:{
  name:'review_suggestions', arguments:{action:'rollback',ids:[review.id],expected}
}}, {store,query,domains,
  scopes:['notes','profile','world','actions','contacts','collections','media','stats']});
```

Correct the distinction between historical undo evidence and active data links. Validate the complete receipt and target visibility/version against the pre-change state; allow the exact authorized tombstones in the projected state while retaining the history. Do not broadly disable hidden-record or linked-target checks. Add a real-file MCP Keep/Undo regression with complete expected hashes, plus later-edit and hidden-target refusals. The same path also participates in Never Again for an already kept suggestion.

This was an honest refusal that preserved current data, classified P2 rather than data loss. Root accepted it for correction within the same wave.

The correction in `576f0da` passes the actual MCP tool name into the guard. It exempts only unchanged targets of an existing complete Undo receipt during a supported review removal action, after pre-change visibility and version checks. A target must be a new, nonshared record with the exact current after hash, the same UUID, and an explicit tombstone in this same commit. Generic `save_record` cannot use this exception. Ordinary links and hidden-target checks remain enforced.

I reran the exact in-memory reproduction above against the corrected application code:

```text
MCP review_suggestions result:
  processed: 1
  succeeded: 1
  errors: []
current home city: Town A
review status: removed
```

Inspected the added actual-file MCP regression covering Keep and Undo with complete hashes, forged receipt rejection, later-edited target refusal without partial mutation, and hidden owning-person refusal. The worker reports that this regression failed with the same visible-record error before correction and that all 18 focused checks now pass. No further whole-branch review was opened.

## Fixes checked

- Collections: a WeakMap retains full authoritative rows and hashes outside enumerable prompt context. Mutation uses that baseline, enforces the current hash, and preserves oversized structured data. The two added collection tests cover the original competing-edit and truncated-JSON cases.
- Assistant writes: the new separate guard checks current target visibility, owning people/collections, typed and stored links, incoming structural changes, scopes and current hashes. The owner notebook query remains separate. Inspected the targeted hidden-source/unhide, omitted hash, hidden owner, hidden linked target, structural rename and successful current-hash tests.
- Owner review Undo: individual normalization and visible individual/bulk Keep use the same staged transaction. Receipts capture prior claim closures, complete slot state and after hashes. Undo preflights all targets and commits together. Legacy incomplete receipts refuse honestly. Event Undo uses append-only corrections. The direct owner reproduction restored Town A after the assistant refusal above.
- Visible review controls: individual and bulk Keep, Undo and Never Again call the actual `runReviewOperation` helper. Backend accepts `never_again`; suppression uses the same normalized subject/attribute/value key; displayed counts use saved `processed`, `succeeded` and `failed`; fact target type is `claim`; kept rows remain accessible for individual Undo. The actual page's button wiring was read, not inferred from helper tests alone.

## Evidence and limits

Read all source/UI changes in the original scoped diff, the ten original added regression tests and the worker handoff, followed by only the accepted three-file correction and its eleventh regression. The retained original focused log reports 17 passes, zero failures and zero skips; the correction's worker/root handoff reports 18 passes. I did not rerun file-writing tests under this read-only review restriction. I ran the same in-memory application reproduction before and after the correction; the parent owns full suites, generated UI, matching package builds and installed control checks.

No optional recipe, inherited feature audit, production, network, server or browser access was added. No source, index, HEAD, package or runtime state was changed. Only this ignored review report was written. Existing final-review coverage limits still apply. A third review is not requested by this report.

**Assessment: clean within the requested scoped fix review.** Original demonstrated failures and the accepted in-wave Undo regression are corrected. The inspected fixes support the bounded trial, subject to the parent's matching-package and installed-control checks. This is not exhaustive release or two-week outcome acceptance.

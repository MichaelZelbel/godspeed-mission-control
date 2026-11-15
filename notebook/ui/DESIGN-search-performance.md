Reading this as: the existing notebook search for its owner, in Operate mode, on desktop or phone. Vibe: familiar, quick, steady.

Brief: "please implement that and then we test it on our production server."

The owner should find and open a note while optional AI matching runs. Existing fonts, tokens, layout, previews and hover protection stay in place. This is a Flat app component because its job is finding a note.

Plan v1: make the existing first search pass use the word index, preserve displayed rows while AI enriches them, and cancel superseded searches. No new visual treatment.

Review: the existing component supplies every visual choice. A new search must clear obsolete rows immediately; keeping a prior query's rows would mislead the owner. Desktop and phone retain the same existing dropdown and list arrangements.

Plan v2: word matches appear first, optional AI matches follow, and existing loading feedback continues until enrichment settles. Slow responses from an earlier query cannot replace the current results.

Verification: automated dropdown interaction tests cover results appearing before AI completion, typing another query while AI is pending, emptying the input, and stable hover behavior. The production rollout additionally verifies the deployed browser bundle and interactive states.

Exact search preserves substring and compound matches: indexed words appear first, then the worker adds broader word matches under the same query. Both passes cancel together when the query changes; neither Exact pass asks AI.

# Search responsiveness

Search has two browser passes. The first returns indexed word matches, with
exact titles and title matches protected before applying the result limit.
Smart search later adds meaning matches. Exact search instead adds substring
and compound-word matches without contacting an embeddings service.

The server's main thread handles note reads and the small indexed word pass.
A worker with a read-only SQLite connection owns the meaning cache and vector
comparisons. A separate worker handles slower substring expansion, so neither
operation can hold up note reads. The configured meaning cache warms in the
background after startup; the HTTP listener does not wait for it.

Vectors are retained by document. After a committed embedding update, an
ordered message replaces only that document's vectors. Deletes remove the
document from the cache. Model changes clear the relevant cache and close the
old worker. A reply from an old embedding round cannot overwrite a newer
model's vectors. The metadata count has a covering index so it does not read
the vector blobs.

Cancelled browser requests abort their embeddings call and release their
worker request. Superseded UI responses are ignored. Embeddings calls and
worker requests retain a deadline; a timed-out worker is replaced on the next
request. Worker failure leaves indexed matches available. Shutdown cancels
pending work before waiting for HTTP connections and awaits worker termination.

Search results carry previews, which cannot be used as editable note bodies.
Opening a result waits for a complete single-note read before mounting the
editor. Search retrieval still applies current source and visibility checks.

Regression checks live in `test/meaning-worker.test.mjs` and
`test/search-progressive.test.mjs`, with UI checks for delayed AI replies,
superseded requests, Exact expansion and delayed full-note reads. Existing
meaning, model-change, privacy and word-search suites cover compatibility.

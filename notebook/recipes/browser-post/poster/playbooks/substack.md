# Substack

Status: retained historical control procedure. Verify the current visible controls and account before use; this packaged installation has no accepted live posting result.

Publication: `<publication>` below is `$SUBSTACK_PUBLICATION` from poster.env (`yourname` for
`yourname.substack.com`). Not set: open `https://substack.com/home` once, follow the profile
menu to the Dashboard, and read the subdomain from the address bar.

Payload fields used: `headline` (title), `email_preview` (subtitle), `post_text` (body),
`email_subject` (only when it differs from the title; Substack uses the title as the subject by
default), `media_url` and `thumbnail_url` exactly as given (section 3).

## 1. Open

`https://<publication>.substack.com/publish/post?type=newsletter` opens a new draft in the
editor. Signed in: the snapshot shows the editor with `textbox "title"` and
a button named after the writer (the byline). Not signed in: a page with
`button "Sign in"` and no editor. Report `needs_manual` with "the posting profile is not signed in to
Substack" in that case; do not try to sign in.

## 2. Already posted?

Open `https://<publication>.substack.com/publish/posts` (the dashboard's Posts tab). A post with
the payload's title in the Published list from the last hour means an earlier attempt landed:
open it, read its URL from the address bar, report `posted` with that URL, stop. The Drafts list
may hold a half-finished draft from a dead attempt; reuse it rather than making a second one.

## 3. Controls

Opening the editor URL creates a draft at once: the address becomes
`/publish/post/<id>`. Open it once per job, never twice.

Substack's inputs are React-controlled: a value set by `fill-by-label` shows in the field but
React does not see it (on the sign-in page it answered "Please enter a valid email"). Use real
keystrokes: `pc_browser_type` (bridge `POST /type` with a CSS `selector`) or click, then
`pc_browser_type_text`.

- `textbox "title"` (placeholder "Title"): `headline`. The top of the page also carries a
  file-settings panel with `textbox "Add a title..."` and `textbox "Add a description..."`;
  those are the SEO title and description, not the post title. Use the one named "title".
- `textbox "Add a subtitle…"`: `email_preview`.
- `textbox "Start writing..."`: the body (ProseMirror). **Paste it, never type it.** Typing
  leaves a YouTube link as plain text, because Substack turns a link into an embedded player
  only on paste; typing a long body also outlasts the bridge's HTTP timeout. One
  `pc_browser_eval` dispatches a paste of the whole `post_text` into `.ProseMirror`:
  `new Promise(res=>{const pm=document.querySelector('.ProseMirror');pm.focus();`
  `const dt=new DataTransfer();dt.setData('text/plain',TEXT);`
  `pm.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));`
  `setTimeout(()=>res({children:Array.from(pm.children).map(e=>e.tagName+':'+e.className.slice(0,30)+':'+e.innerText.slice(0,60))}),5000)})`
  with TEXT as a JSON string literal of `post_text` (blank lines between paragraphs are right
  for a paste). Write no raw `
` escape sequences into the eval source by hand: the bridge
  then sees a broken string ("Invalid or unexpected token"); build the text with
  `JSON.stringify` or `String.fromCharCode(10)`. Check the result: a YouTube link on its own
  line must come back as `DIV:youtube-wrap`, the paragraphs as `P`. Verified 2026-09-28 on a
  scratch draft (deleted). Do not type Markdown symbols; `**` would show as characters.
  Substack curls straight quotes; that is expected.
- **Media: exactly what the payload holds, nothing added, nothing dropped.** The payload is
  what the post's card in Planino shows (since 2026-09-28 Planino leaves out a thumbnail the
  card does not show). `media_url` set: put that file at the top of the post, a picture with
  `button "Insert image"` (it opens a MENU; `menuitem "Image"` is the file chooser), a video
  with `button "Insert video"` (UNVERIFIED: first run to do it corrects this line).
  `media_url` empty: no picture, no video. `thumbnail_url` set: the settings panel's Thumbnail
  "Upload" (the social card), never into the body. Never decide on taste that a file does not
  belong; if the upload fails, report `needs_manual`, do not post without it.
- Top bar: `button "Saved"` (autosave state), `button "Preview"`, `button "Continue"`.

## 4. Dialogues

1. `button "Continue"` (top right) opens `dialog "Publish"`: audience `radio "Everyone"`
   (checked), comments Everyone, `checkbox "Send via email and the Substack app"` (checked),
   `checkbox "Schedule time to email and publish"` (unchecked: leave it, Planino owns the
   timing), Scan for AI text (ignore), `button "Cancel"`, `button "Send to everyone now"`.
2. `button "Send to everyone now"` publishes and emails. The button turns into
   `button "Loading Publishing..."` for a few seconds.
3. The page then goes to `/publish/posts/detail/<id>/share-center`, NOT to the post. It holds
   one link `https://<publication>.substack.com/p/<slug>`: that is the live URL.

## 5. Read the URL back

The `a[href*="/p/"]` link on the share center after step 4.3 (`pc_browser_eval`), or the
Published list in step 2. Open it and check the title, the date and the last paragraph before
reporting that URL.

## 6. Cost baseline

UNVERIFIED for this installation. Retain actual tool calls, duration and returned provider cost after an approved run; never copy another installation result as this user’s baseline.

## Bridge notes

`pc_browser_eval` returns `{}` for a bare array; wrap results in an object
(`({links: [...]})`). The screenshot for the report is the bridge's `GET /screenshot` PNG;
it is too big to pass inline, so send the report through the poster API
(`$PLANINO_POSTER_URL/report`) with it base64-encoded.

## 7. Retained technical lessons and future corrections

- Retained source lesson: use the actual Posts dashboard tabs and current accessibility snapshot; historical control names need a fresh visible check.
- Retained source lesson: image insertion can open a menu before a file chooser. Long body typing can finish after a bridge timeout, so inspect the visible body before repeating it. Pasting may embed a video where typed text leaves a link.
- Retained source lesson: the frozen payload controls every text and media choice. Do not add a thumbnail, omit an approved image, or change video handling by taste. Verify the actual delivered body against the approved payload.
- Append a dated correction only after the selected installation actually observes a changed page. Preserve the original method and the observed result. No private story, prior job identity or personal incident is bundled.

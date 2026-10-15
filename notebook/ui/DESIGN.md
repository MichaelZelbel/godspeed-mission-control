Reading this as: Michael's personal notebook, in Operate mode, on Windows and his server. Vibe: familiar, calm, practical.

Brief: "Looks completely broken, not like Menerio."
This is a port correction. Restore the existing Menerio sidebar, search header, creation menu, theme control, dashboard cards and chat panel. Reuse its components, fonts and tokens. Keep installation controls under Settings, with the notebook as the starting page. Flat layout because this is an app for everyday tasks. Data shown comes from the installed file workspace. No personal data migration.

# Server login design

Reading this as: account setup and login for the owner of a personal VPS, in Operate mode, on desktop or phone. Vibe: familiar, welcoming, calm, precise.

## Brief
“Please implement it. And please make the dialogue look pretty, like the rest of the Godspeed pages.”
The owner must know this is their Godspeed Mission Control and how to enter safely. The next action is Sign in, Create account, or Reset password according to the state. Existing G logo, favicon, local fonts and application colour tokens are the design system. Account recovery uses a saved code; no email delivery exists. Public setup requires a private invitation. No personal knowledge or AI credentials are changed.

## Plan v1
Flat: this is a frequently used form, so motion and a marketing hero would obstruct the task. A compact brand header, one spacious form surface, and an understated bottom line about their own server. Reuse background, card, foreground, muted-foreground, primary, and primary-foreground roles from index.css; DM Sans headings and Plus Jakarta Sans body are already the application fonts. Logo is the bold visual move. No decorative new illustrations.

Desktop: centred 460px form, generous vertical space; brand above it, server identity below.
Phone390: 20px gutters, 100% remaining width; smaller heading and card padding, buttons full width. No pinned footer or competing panel.

```
desktop                      phone
     [G] Godspeed...          [G] Godspeed...
     [ Welcome back  ]        [ Welcome back     ]
     [ username      ]        [ username         ]
     [ password Show ]        [ password    Show ]
     [ remember      ]        [ remember         ]
     [ Sign in       ]        [ Sign in          ]
     [ Forgot?       ]        [ Forgot?          ]
        Your server              Your server
```

## Review
An interaction unit earns a card, but no nested cards or generic feature grid. DM Sans and Plus Jakarta Sans remain because they belong to the application. The small footer identifies the server rather than making unsupported privacy promises. Distinct heading sizes avoid the oversized wordmark from the old page. Errors state the fix. Setup, recovery and saved-code confirmation share the same form shell.

## Plan v2
Use the compact brand and form composition above. Show the server hostname as a real link identity detail. First-use copy explains that a setup code is entered during installation, or a private setup link is provided by the installer. A recovery code is shown once with Copy and Download actions and an explicit saved-code checkbox before entering the application. Remember-me is optional, unchecked, 30 days. A session-expired notice preserves the requested page. All requests distinguish bad credentials from connection trouble; no credentials go in query strings.

## Claims to confirm

## Note chat and Menerio import

Reading this as: existing server app changes for a person opening a note or bringing their old account across, in Operate mode. Vibe: familiar, clear, calm.

Brief: keep Godspeed chat left and note right, but move its trigger to the top-left of the note. Provide an import screen with preview before copying and preserve existing content and the AI connection.

Plan v1: a visible labelled chat toggle above the note formatting toolbar, left arrow on desktop. Hide the competing floating trigger on note pages. A dedicated settings import page reuses the application's card, button, input, success and muted tokens. The copy preview shows four real counts, existing items retained and archived unsupported data. Explicit add-content checkbox before import. Progress reports work without a fabricated percentage.

Review and Plan v2: the left arrow reflects the actual desktop destination and is omitted on mobile, where chat is above the note. The import page uses a single card and no new palette or decorative hero because this is an application task. A saved verified copy avoids asking Michael for credentials. A separate account connection form can prepare other source accounts. Keys are transient, password fields and never saved in knowledge. Existing-item matching preserves current edits. Completion gives one link to open notes.

Desktop: back to settings, modest heading, one import card with generous spacing; preview counts in four columns. Phone390: same order, 16px or larger gutters, counts in two columns, wrapped labels and 44px action targets. No horizontal scrolling or hidden primary action.

Follow-up: optional remembered sessions last 30 days. Setup and recovery show a 4px password-length bar directly below the password field. It fills against the 12-character minimum, uses the existing primary colour while incomplete and the success colour at 12 characters. Text states progress without implying password strength; deleting characters reverses the bar. The ordinary sign-in form has no length indicator.
Fresh-eyes review: compact the empty embedded phone chat so the note remains reachable below it, and hide the global floating action on the import screen so it cannot cover preview or confirmation. Both applied. Final live desktop, 390px and 360px phone, and reduced-motion screenshots inspected; automated layout and contrast checks report zero failures. Import confirmation remains readable when disabled.
Hostinger's generic deployment supports environment-variable inputs, but a custom copy-key button and completion-link integration have not been verified. Do not claim they exist. The template asks the owner to choose a setup code before deployment, avoiding terminal retrieval. Catalog-native generation remains an integration requirement.

## Compact note navigation and editor toolbar

Reading this as: Michael's everyday note workspace, in Operate mode, at desktop and narrow window widths. Vibe: familiar, compact, readable.

Brief: "slick and nicely designed in a single row" above the tree; "a small blue button with a chat icon on the left side of the toolbar" that stays visible at narrow widths. The next action is opening or editing a note, with chat immediately available. Existing app fonts, background, foreground, muted-foreground, primary and primary-foreground tokens remain the design system. Flat composition because this is a frequently used editing tool.

Plan v1: replace the stacked Notes heading with an inline document icon and real note count. Keep collapse, filtering, sort, folder, tags, search and creation in one row. Show the sort direction as an icon, with its full field and direction in the accessible name and tooltip. Move the chat toggle into the editor toolbar's far left and retain the existing formatting overflow popover.

Review: a text chat label and decorative arrow compete with the note and waste a full row. Remove both visible elements. Keep the existing primary blue button as the one accent; avoid introducing a new palette, font, card or animation. Navigation controls need accessible names after removing text. At very narrow editor widths, the chat must sit outside the scrolling controls so scrolling cannot hide it. No new claims or product copy.

Plan v2: desktop tree header is one 40px row: [collapse] [document count] [filter] [sort] [folder] [tags] [search] [new]. Compact 28px-wide controls fit the existing 288px panel. On 390px and 360px phones the collapse control is absent and the five action targets are 44px; folder creation remains in the New menu to fit the app's inset phone panel. Editor is [blue chat] [formatting and note controls]; formatting groups still collapse into More formatting, with horizontal scrolling only when the remaining controls cannot fit. The chat remains fixed at the left and has an inset pressed ring when open. Source and external-note action bars share the same pinned action. Trash actions retain their existing behavior.

Desktop: [document count | filter sort folder tags search new] [chat | formatting | note actions]
Phone390: [document count | filter sort folder tags search new], or selected note [chat | formatting | note actions]

Verification: local production build passes. A real browser rendered the application against intercepted fictional note data at 1440px, 800px, 390px and 360px, plus reduced motion. Both header rows remain single-line, with no page overflow or runtime errors. A forced 150px toolbar and scroll-to-end leave the 32px chat control visible. Phone navigation retains 44px actions. Opening and closing chat updates its pressed state; source mode retains the pinned chat. Personal notes were not accessed. An independent review found no blockers. Its optional overflow-edge fade is deferred because the existing formatting overflow and keyboard/touch scrolling remain available. Type checking reports existing errors in unrelated files and missing PowerSync modules; no changed component is reported. A real phone, Safari and the deployed application still need separate verification.

## App icon

Brief (14 October 2026): the installed app's icon was the G on a near-black square (#0e121b), which Windows shows in the taskbar and Start menu as a cut-out tile. The G now stands on a transparent background.

The set, all in `public/`: `icon-192.png` and `icon-512.png` (manifest "any") and the tab icons `favicon.ico` (16, 32, 48) and `favicon-96.png` are the G with a thin violet outline on transparency; the tab icons' outline is a little stronger so the G holds at 16px. `icon-maskable-512.png` keeps the G on #0e121b inside Android's 80% safe circle, because Android crops a maskable icon to its own shape. `apple-touch-icon.png` keeps its dark background, because iPhones paint a transparent home-screen icon black. The in-app logo (`src/assets/godspeed-logo.png`) is unchanged.

To cut the set again, start from `icon-source/godspeed-g-transparent-master.png` (712px, transparent). `notebook/test/app-icons.test.mjs` checks that the "any" and tab icons stay transparent and the maskable and iPhone icons stay opaque.

## Godspeed's brain (the Identity page until 16 October 2026)

Brief (16 October 2026, Michael on the production notebook): the page was confusing and partly broken. A rule could not be saved with only "Read before every job" switched ("Keep the rule's name short", because its long description stood in for its name); "It must / It must never / How things work here" read as three names for one thing; about sixty rules sat under one heading with no numbers; "Your manual: 18,805 of 20,000 characters" under "Who it is" described another file in a word he does not use; nine profile pages looked like everything it knows; "recipes" and "Identity" with a fingerprint (his own identity) were the wrong words; the round chat button covered the rule being edited and opened the general chat; and the yellow box about the assistant program's own identity file was a mystery file.

Plan v2:
- Name: "Godspeed's brain" with lucide `Brain`, at `/dashboard/brain` (the old address redirects, keeping the part after #). Menu label, command palette, heading, browser title, icon and links all read `src/lib/brain-page.ts`; the server never names the page.
- Order: Who it is, Extra instructions, Rules, What it knows about you, Skills. A sticky row at the top of the page's own scroll area holds the chat switch at the far left (as on Notes) and a way to each part.
- Who it is: the paragraphs in a readable column (65 characters, text-base, leading-7), one paragraph per blank line. No size line under it.
- Extra instructions (`assistant/extra-instructions.md`): what the assistant's program reads right after "Who it is", in Telegram, the notebook's chat and routines; SOUL.md is the two together (core/assistant-soul.mjs). When SOUL.md is its owner's own text, the card says plainly that Hermes also reads a text the page does not hold yet, with "Show it" (the whole text) and "Bring it here".
- Rules: one section. Numbered tiles: a big bold number, the short name as the headline (never cut off), a small outline tag for the kind ("Must", "Never", "How it works"), the sentence below in smaller muted text clamped to three lines (a rule without a sentence shows its description). The rules read before every job come first, numbered as AGENTS.md numbers them (the server's numbers, from the compiler); the rest sit in one section closed by default, "Read only when their subject comes up (N)", grouped by where they are read, numbered on. The tile grid fills the page's own width, so it stays readable beside the open chat.
- What it knows about you: numbered profile pages, then "And everything in your notebook" with real counts and links (notes, people, facts, timeline events, places and things, collections), and one sentence on what is read every time and what is searched.
- Skills: numbered, "Step-by-step instructions for one job each".
- Text the owner wrote for the assistant ("Who it is", the extra instructions, their earlier versions, the text Hermes reads that the page does not hold) is shown as the Markdown it is (`components/brain/PageMarkdown.tsx`: react-markdown with GFM as the chat uses, set for reading a page): headings under the part's own, lists, bold, code blocks that scroll sideways, and tables that keep readable columns (at least 34rem) and scroll sideways in their own box on a phone. A text longer than 1,200 characters shows its first part with a fade and "Show all" / "Show less". Editors hold the text exactly as written; only plain prose paragraphs of "Who it is" are joined for editing on a phone, never a block with a list, heading, table or code. Tile previews show Markdown as plain words. (16 October 2026: on production the extra instructions, 9,236 characters of Markdown, were shown reflowed into one blob.)
- Sizes: a note under an editor only when a change gets near or over a limit, saying what it counts and why (AGENTS.md read in full before every job; "Who it is" and the extra instructions read first).
- Chat: the notebook's chat docked beside the page as on Notes (left, beside the content; above it on a phone), its own conversation, told the page's numbers with each message; a change it makes refreshes the page.

Checked on 16 October 2026 in a real browser at 1440px and 390px against a throwaway copy of the owner's rules, profile, skills, notebook and AGENTS.md (never his folder itself), with a stand-in assistant that changed rule 12 through the real path from the chat.

The 15 October design, kept for its reasons:

Reading this as: a book reader looking at, and changing, what makes their mission control behave the way it does, in Operate mode, on desktop and phone. Vibe: familiar, calm, trustworthy.

Brief (15 October 2026, approved by Michael): Meta Muse's Identity screen (Identity, Soul, Memory, each with Edit, also changeable in chat), plus the one thing Muse lacks: history and undo. Muse's only way back is a full reset.

Plan: a page under System, next to My Profile, and in the command palette. Four sections in the order the book teaches them, each a heading with an icon tile, one plain sentence and its action: Who it is (the persona paragraph as one flowing paragraph, Edit), What it may and may not do (rules grouped as the manual's list groups them, "Add a rule", and below them the instructions for connected AI apps that My Profile used to hold), What it knows about you (profile pages), How it does its jobs (recipes, each saying whether updates keep it up to date or it is the reader's own). Cards reuse the Trackers shelf's card: title, two or three lines of text, a small note. One editor dialog per part with two views, Edit and Earlier versions; Earlier versions has "Undo last change" on top and "Show" and "Restore this version" per version, newest first, each dated in the reader's own clock and saying who changed it. The manual's size is shown the way the book asks it: "Short enough for you to read all of it?", in the warning colour from 19,000 characters, and Save is disabled where a change would pass the 20,000 the assistant's program reads.

Review: no jargon on the page (no markdown, commit, repository or persona); the file a part lives in is named once, in small print, because the book teaches the folder. A rule's sentence says which list heading it is read after. Nothing is deleted without a way back: a removed rule or instruction stays among its earlier versions. The persona is shown reflowed, because the file's fixed line width means nothing on a phone, and unchanged words are no change however the file wraps them.

Phone 390: one column, 16px gutters from the page, section actions wrap under their heading, every action 44px high, the editor dialog scrolls within 92% of the screen height. Checked in a real browser at 1366px and 390px against a fictional starter workspace (no personal data).

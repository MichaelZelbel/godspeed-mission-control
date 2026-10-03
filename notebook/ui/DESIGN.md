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

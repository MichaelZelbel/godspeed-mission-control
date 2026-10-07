# Godspeed Mission Control server access

The web application has one owner account. Username and password are chosen in the browser. No email address or external account service is required. The recovery screen uses a code downloaded or copied during setup, replaces it after every recovery, and revokes previous sign-ins. Passwords use salted scrypt hashes. Recovery codes, session cookies and invitations are stored as hashes in the device-private workspace `.godspeed/web-auth.json`, outside knowledge sync and assistant context.

## Installation handover

The packaged installer prints a private `/setup#invite=...` link when the server is ready. The link lasts 24 hours, is used once, and never sends its secret in the URL request or referrer. Opening it lets the owner choose credentials and save their recovery code. A new setup invitation invalidates older invitations. After an account exists, the installation code cannot sign in or create another owner.

For a custom Hostinger Docker deployment, set `GODSPEED_SETUP_CODE` in the deployment environment before launching. Choose a long, private random value and save it while the deployment form is open. The Compose file maps it to the server's setup secret. After deployment, open the application's HTTPS address and enter that same code once in **Your first visit**. The user needs no SSH access, container shell or file retrieval. On return visits they use their chosen username and password.

This integration uses Hostinger's ordinary environment-variable form, not a catalog-specific credential button. The custom Godspeed template's actual checkout, variable form, public image availability, certificate provisioning and completion link must be verified on a fresh Hostinger deployment before advertising a working one-click installation. An OpenClaw-specific key button cannot be assumed to appear for a custom Compose file.

The test installation already has its installation proof. Its owner receives a private setup link directly, so no server terminal or setup-code retrieval is needed.

## Sessions

Normal sign-in lasts eight hours; optional remember-me lasts 30 days. Sessions survive application and Docker restarts, expire on the server, and are removed on logout. Cookies are HttpOnly, Secure for VPS use, SameSite=Lax so saved external links work, and scoped to this server. Authentication failures return to the sign-in form at the original URL. Recovery revokes all existing browser sessions.

If both the password and recovery code are lost, there is no email reset. Restoration requires control of the hosting account. Do not expose a public reset endpoint, print permanent credentials into container logs, or enable unrestricted first-visitor registration.

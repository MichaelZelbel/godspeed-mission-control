# Godspeed Mission Control on Hostinger

This deployment is for a fresh Docker VPS. It uses the complete tested application,
keeps its data and certificates in persistent Docker volumes, and limits container
logs to 30 MB per service. It requires no local configuration files or terminal commands.

Hostinger's supported purchase link is:

`https://www.hostinger.com/docker-hosting?compose_url=PUBLIC_RAW_COMPOSE_URL`

Current purchase and install link, including Michael's saved Hostinger referral:

[Install Godspeed Mission Control on Hostinger](https://www.hostinger.com/docker-hosting?compose_url=https%3A%2F%2Fraw.githubusercontent.com%2FMichaelZelbel%2Fgodspeed-mission-control%2Ff8e285dbbe1f9c42139a2839eacc0966bd045167%2Fdocker%2Fhostinger%2Fcompose.yaml&REFERRALCODE=GHNMICHAEJC8#pricing)

The link names the commit whose `compose.yaml` pins the current image
(`v2-sha-c2ce006`, digest `bafaadb2…`, since the Identity page release of 15 October 2026; before that `v2-sha-02f4ecb`, digest `60df0c65…`, from the notebook label correction of 14 October 2026, then `v2-sha-377124c`, digest `5a154b6d…`, from 13 October 2026, then `v2-sha-d023277`, digest `8682ddd5…`, from the second release of 12 October, then `v2-sha-d457ded`, digest `4dc94340…`, from the first release of 12 October, then `v2-sha-da2098e`, digest `a67da492…`, from 10 October, then `v2-sha-c83b399`, digest `13232a90…`,
from 9 October, the book's second edition, then
`v2-sha-b327fe0`, digest `c3706e1c…`, from 7 October, and `v2-sha-20cdd7b`, digest `351e8a16…`). Until 6 October 2026 it named `a759dc8`, an
older file with an older image, so the button installed a version this page no longer
described. Whenever `compose.yaml` pins a new image, point this link at the commit that
made that change.

The `#pricing` anchor opens the plan selection section, where Hostinger displays
the project name `godspeed-mission-control` and a `Referral code applied` badge.
Both were verified in the actual browser on 3 October 2026. Hostinger still owns
the generic main heading; this is not a fully branded Godspeed purchase page.
For a public launch, use a Godspeed installation page explaining what happens
after purchase, with this referral-aware link as its deployment button.

Use the public raw URL of `compose.yaml` at the release commit. The file pins the
complete tested image by digest, so unrelated changes to `latest` cannot replace it.

After checkout, Hostinger opens Docker Manager with the installation ready to deploy.
Fill `GODSPEED_HOST` with the VPS hostname shown by Hostinger, without `https://`,
and choose a private `GODSPEED_SETUP_CODE` of at least 32 random letters and digits (let
your password manager make it). Save that code there. A shorter code is refused once the
server runs an image with that check, because whoever enters it first owns the server.
Deploy, then open `https://YOUR_VPS_HOSTNAME`. Enter the setup code, create your
username and password, and save the recovery code. Later visits use your account.

## Telegram, connected after the account

Right after the recovery code, Godspeed shows **Connect Telegram** (later: Settings, Telegram).
It explains in two sentences why: you can talk to your mission control from any phone or
computer, and it can message you. Make a bot with Telegram's BotFather (`/newbot`), paste the
key BotFather gives you, and press **Check and connect**. The server checks the key with
Telegram itself; a wrong key is said at once. Then the page shows **Open @yourbot in
Telegram**, and a QR code for a phone. That link carries a one-time code: only the person who
opens the bot from it becomes its owner, so a stranger who finds the bot in Telegram's search
gets nothing. A bot you have chatted with before shows no Start button; the page also shows
the message to send it instead (`/start` and the same code), with a Copy button. Press
**Start**, and setup goes on as a chat in two steps. First an AI to think with (ChatGPT by a
sign-in code, or another provider by its key). Then a few questions: whether this is your
first Godspeed Mission Control, your city (only for your time zone; the button offers the time
zone of the browser you connected the bot from, and you can type any city), a few sentences
about yourself or the book's `what-my-ai-knew.md` as a file, and what you want help with
first. The last two have a Skip button. What you tell it about yourself is added to
`profile/about-me.md`, which your assistant reads before it helps, and shows on the Identity
page with Undo. Only "No, bring in the one I have on GitHub" signs in to GitHub: you send its
address, the server connects it the way Settings' **Connect record sync** does, brings its
pages in, and asks only for your city. A first Mission Control never needs GitHub; you can
connect it later in Settings with **Connect record sync**. Right after your last answer the
bot says it is setting everything up and shows it is typing until it is done (about a minute,
mostly the assistant making its first routines). Then the bot belongs to your assistant, and
its last message says where to reach it: here in Telegram, and in your notebook at this
server's address, where you sign in with the username and password you chose.

- **The key stays on this server.** It goes from your browser to your server only, is kept in
  the data volume at `/opt/data/full-candidate/telegram` (readable only by the assistant's
  account, outside your folder, so the GitHub backup never carries it) and in the assistant's
  own settings, and it is never shown again or written to a log. The installation coordinator
  and the website never see it.
- **No redeploy, no terminal.** The container notices a saved key within two seconds and starts
  the chat; when the chat is done, it starts the assistant's Telegram connection instead.
- **Skipping is fine.** Without Telegram the web app works as before; connect an AI in Settings.
- **Another bot, or none:** Settings, Telegram, **Use a different bot** or **Disconnect
  Telegram**. A key renewed in BotFather (`/revoke`) is pasted the same way and keeps the owner.

What runs where: `notebook/server/telegram-connect.mjs` (the page's key check and the link),
`docker/full-candidate/telegram-runner.mjs` (the chat, then the gateway, never both), and
`docker/rootfs/usr/local/bin/godspeed-telegram-setup` with `GODSPEED_TG_FLOW=notebook` (the chat,
the same program the plain Docker image uses). `GODSPEED_TELEGRAM=off` in the environment
switches all of it off; `on` keeps an operator's bot set by environment instead.

The hostname must resolve to this VPS and incoming ports 80 and 443 must be available.
The bundled HTTPS service obtains and renews the public certificate automatically.
Do not install this project over an existing project using those ports or volumes.
Without Telegram, connect an AI provider in Godspeed Mission Control's Settings.

Verification runs on a disposable GitHub runner using this exact Compose file and
the published image. Local test certificates verify the HTTPS wiring; issuance of a
public certificate and the paid Hostinger handoff require a real fresh VPS test.

The same installation on any other Linux server, from any host, is one line:
`curl -fsSL https://teachitonce.com/server | bash` (`docker/server/install.sh`, described in
`../README.md`, "Any Linux server, one line"); it uses this `compose.yaml`.

Official Hostinger flow: https://www.hostinger.com/support/deploy-on-hostinger-button/
